//! HLSL Playground backend written in Zig 0.13.0.
 //! Compile route: DXC (HLSL -> SPIR-V) + prebuilt Naga CLI (SPIR-V -> WGSL).
 //! Runs on 127.0.0.1 only. Browser WebGPU runs converted WGSL independently.
const std = @import("std");
const A = std.heap.page_allocator;
const Header = std.http.Header;
const Request = std.http.Server.Request;
const eql = std.mem.eql;
const max_body = 128 * 1024;
const max_source = 64 * 1024;
const max_shader_result = 512 * 1024;
const max_output = 20 * 1024;

var lock: std.Thread.Mutex = .{};
var sessions: std.StringHashMap(i64) = std.StringHashMap(i64).init(A);
var started_ms: i64 = 0;
var last_empty_ms: i64 = 0;
var ever_opened = false;
var compilations: usize = 0;
var root_dir: []const u8 = "";
var origin: []const u8 = "";
var dxc_path: []const u8 = "";
var naga_path: []const u8 = "";
var ready_file: ?[]const u8 = null;
var startup_grace_ms: i64 = 90_000;
var lease_timeout_ms: i64 = 45_000;
var close_delay_ms: i64 = 1_200;

fn env(name: []const u8, fallback: []const u8) []const u8 {
    return std.process.getEnvVarOwned(A, name) catch fallback;
}
fn timeMs() i64 {
    return std.time.milliTimestamp();
}
fn envMs(name: []const u8, fallback: i64) i64 {
    const parsed = std.fmt.parseInt(i64, env(name, ""), 10) catch return fallback;
    return if (parsed >= 200 and parsed <= 600_000) parsed else fallback;
}
fn randomToken() ![]const u8 {
    var b: [16]u8 = undefined;
    std.crypto.random.bytes(&b);
    const token = try A.alloc(u8, 32);
    _ = std.fmt.bytesToHex(b, .lower);
    const hex = std.fmt.bytesToHex(b, .lower);
    @memcpy(token, &hex);
    return token;
}
fn jsonResponse(req: *Request, status: std.http.Status, value: anytype) void {
    const body = std.json.stringifyAlloc(A, value, .{}) catch return;
    defer A.free(body);
    req.respond(body, .{
        .status = status,
        .keep_alive = false,
        .extra_headers = &.{
            Header{ .name = "content-type", .value = "application/json; charset=utf-8" },
            Header{ .name = "cache-control", .value = "no-store" },
            Header{ .name = "x-content-type-options", .value = "nosniff" },
        },
    }) catch {};
}
fn failure(req: *Request, status: std.http.Status, msg: []const u8) void {
    jsonResponse(req, status, .{ .@"error" = msg });
}
fn serveFile(req: *Request, name: []const u8, content_type: []const u8) void {
    const full = std.fs.path.join(A, &.{ root_dir, name }) catch return;
    defer A.free(full);
    const bytes = std.fs.cwd().readFileAlloc(A, full, 512 * 1024) catch {
        failure(req, .not_found, "Static file is missing.");
        return;
    };
    defer A.free(bytes);
    req.respond(bytes, .{
        .keep_alive = false,
        .extra_headers = &.{
            Header{ .name = "content-type", .value = content_type },
            Header{ .name = "cache-control", .value = "no-store" },
            Header{ .name = "x-content-type-options", .value = "nosniff" },
        },
    }) catch {};
}
fn readBody(req: *Request) ![]u8 {
    if ((req.head.content_length orelse 0) > max_body) return error.RequestTooLarge;
    var reader = try req.reader();
    return try reader.readAllAlloc(A, max_body);
}
fn objectString(v: std.json.Value, key: []const u8) ?[]const u8 {
    if (v != .object) return null;
    const value = v.object.get(key) orelse return null;
    return if (value == .string) value.string else null;
}
fn validEntry(entry: []const u8) bool {
    if (entry.len == 0 or entry.len > 64) return false;
    for (entry, 0..) |c, i| {
        if (std.ascii.isAlphabetic(c) or c == '_') continue;
        if (i > 0 and std.ascii.isDigit(c)) continue;
        return false;
    }
    return true;
}
fn checkOrigin(req: *Request) bool {
    // std.http.Server has no general header lookup; inspect the parsed head.
    // Restrict both Host and Origin against DNS rebinding/CSRF to loopback.
    var host_ok = false;
    var origin_ok = true;
    const head = req.server.read_buffer[0..req.head_end];
    var lines = std.mem.splitSequence(u8, head, "\r\n");
    _ = lines.next();
    while (lines.next()) |line| {
        const colon = std.mem.indexOfScalar(u8, line, ':') orelse continue;
        const name = std.mem.trim(u8, line[0..colon], " \t");
        const value = std.mem.trim(u8, line[colon + 1 ..], " \t");
        if (std.ascii.eqlIgnoreCase(name, "host")) {
            host_ok = eql(u8, value, origin["http://".len..]);
        } else if (std.ascii.eqlIgnoreCase(name, "origin")) {
            origin_ok = eql(u8, value, origin);
        }
    }
    return host_ok and origin_ok;
}
fn sessionEndpoint(req: *Request, action: []const u8) void {
    const body = readBody(req) catch {
        failure(req, .bad_request, "Invalid session body."); return;
    };
    defer A.free(body);
    const parsed = std.json.parseFromSlice(std.json.Value, A, body, .{ .allocate = .alloc_always }) catch {
        failure(req, .bad_request, "Invalid JSON."); return;
    };
    defer parsed.deinit();

    if (eql(u8, action, "open")) {
        const token = randomToken() catch { failure(req, .internal_server_error, "Cannot create session."); return; };
        lock.lock();
        sessions.put(token, timeMs()) catch {};
        ever_opened = true;
        last_empty_ms = timeMs();
        lock.unlock();
        jsonResponse(req, .ok, .{ .token = token, .heartbeatMs = 5000, .fallbackTimeoutMs = lease_timeout_ms });
        return;
    }
    if (!eql(u8, action, "ping") and !eql(u8, action, "close")) {
        failure(req, .not_found, "Unknown session operation."); return;
    }
    const token = objectString(parsed.value, "token") orelse {
        failure(req, .bad_request, "Missing session token."); return;
    };
    lock.lock();
    const known = sessions.contains(token);
    if (known) {
        if (eql(u8, action, "close")) {
            if (sessions.fetchRemove(token)) |kv| A.free(kv.key);
            if (sessions.count() == 0) last_empty_ms = timeMs();
        } else {
            if (sessions.getPtr(token)) |ptr| ptr.* = timeMs();
        }
    }
    const count = sessions.count();
    lock.unlock();
    if (!known) { failure(req, .not_found, "Unknown or expired session."); return; }
    jsonResponse(req, .ok, .{ .ok = true, .activeTabs = count });
}
// Ensure an invalid/untrusted shader cannot keep the service occupied forever.
// The watchdog terminates only its own DXC/Naga child after 15 seconds.
fn childWatch(child: *std.process.Child, finished: *std.atomic.Value(bool)) void {
    var ticks: usize = 0;
    while (ticks < 60) : (ticks += 1) {
        if (finished.load(.acquire)) return;
        std.time.sleep(250 * std.time.ns_per_ms);
    }
    if (!finished.load(.acquire)) {
        _ = child.kill() catch {};
    }
}
fn cappedRun(argv: []const []const u8) !std.process.Child.RunResult {
    var child = std.process.Child.init(argv, A);
    child.stdin_behavior = .Ignore;
    child.stdout_behavior = .Pipe;
    child.stderr_behavior = .Pipe;
    try child.spawn();
    var finished = std.atomic.Value(bool).init(false);
    const watcher = try std.Thread.spawn(.{}, childWatch, .{ &child, &finished });
    var joined = false;
    var out = std.ArrayList(u8).init(A);
    var err = std.ArrayList(u8).init(A);
    defer {
        finished.store(true, .release);
        if (!joined) watcher.join();
    }
    errdefer out.deinit();
    errdefer err.deinit();
    child.collectOutput(&out, &err, max_output) catch |e| {
        finished.store(true, .release);
        _ = child.kill() catch {};
        return e;
    };
    // Join before reading/waiting on child state because watchdog may have
    // already killed/reaped the child when the timeout was reached.
    finished.store(true, .release);
    watcher.join();
    joined = true;
    return .{
        .term = try child.wait(),
        .stdout = try out.toOwnedSlice(),
        .stderr = try err.toOwnedSlice(),
    };
}
fn childSucceeded(result: std.process.Child.RunResult) bool {
    return switch (result.term) { .Exited => |code| code == 0, else => false };
}
fn compileHlsl(req: *Request) void {
    const body = readBody(req) catch {
        failure(req, .bad_request, "Request exceeds 128 KiB."); return;
    };
    defer A.free(body);
    const parsed = std.json.parseFromSlice(std.json.Value, A, body, .{ .allocate = .alloc_always }) catch {
        failure(req, .bad_request, "Invalid JSON."); return;
    };
    defer parsed.deinit();
    const source = objectString(parsed.value, "source") orelse {
        failure(req, .bad_request, "Missing source."); return;
    };
    const entry = objectString(parsed.value, "entry") orelse {
        failure(req, .bad_request, "Missing entry."); return;
    };
    if (source.len == 0 or source.len > max_source or !validEntry(entry) or
        std.mem.indexOfScalar(u8, source, 0) != null)
    {
        failure(req, .bad_request, "Invalid source or entry."); return;
    }
    var iter = std.mem.splitScalar(u8, source, '\n');
    while (iter.next()) |line| {
        const trim = std.mem.trim(u8, line, " \t\r");
        if (std.mem.startsWith(u8, trim, "#")) {
            const rest = std.mem.trimLeft(u8, trim[1..], " \t");
            if (std.mem.startsWith(u8, rest, "include") or std.mem.startsWith(u8, rest, "import")) {
                failure(req, .bad_request, "Includes/imports are disabled; paste dependencies inline."); return;
            }
        }
    }

    lock.lock();
    if (compilations != 0) {
        lock.unlock();
        failure(req, .too_many_requests, "Another compilation is running."); return;
    }
    compilations += 1;
    lock.unlock();
    defer {
        lock.lock(); compilations -= 1; lock.unlock();
    }

    const tmp = env(if (@import("builtin").os.tag == .windows) "TEMP" else "TMPDIR", ".");
    const token = randomToken() catch { failure(req, .internal_server_error, "No temporary path."); return; };
    defer A.free(token);
    const work = std.fs.path.join(A, &.{ tmp, token }) catch return;
    defer A.free(work);
    std.fs.cwd().makePath(work) catch {
        failure(req, .internal_server_error, "Cannot create temporary directory."); return;
    };
    defer std.fs.cwd().deleteTree(work) catch {};
    const input = std.fs.path.join(A, &.{ work, "source.hlsl" }) catch return;
    defer A.free(input);
    const spirv = std.fs.path.join(A, &.{ work, "shader.spv" }) catch return;
    defer A.free(spirv);
    const wgsl = std.fs.path.join(A, &.{ work, "shader.wgsl" }) catch return;
    defer A.free(wgsl);
    {
        var file = std.fs.cwd().createFile(input, .{ .truncate = true }) catch {
            failure(req, .internal_server_error, "Cannot write shader source."); return;
        };
        defer file.close();
        file.writeAll(source) catch { failure(req, .internal_server_error, "Cannot write shader source."); return; };
    }

    const dxc_args = [_][]const u8{
        dxc_path, "-spirv", "-fspv-target-env=vulkan1.1", "-T", "cs_6_0",
        "-E", entry, "-Fo", spirv,
        "-fvk-t-shift", "0", "0", "-fvk-u-shift", "16", "0",
        "-fvk-b-shift", "32", "0", "-fvk-s-shift", "48", "0", input,
    };
    const dxc = cappedRun(&dxc_args) catch |err| {
        const diagnostic = std.fmt.allocPrint(A, "DXC could not run: {s}", .{@errorName(err)}) catch "DXC failed.";
        failure(req, .bad_request, diagnostic); return;
    };
    defer A.free(dxc.stdout);
    defer A.free(dxc.stderr);
    if (!childSucceeded(dxc)) {
        failure(req, .bad_request, if (dxc.stderr.len > 0) dxc.stderr else "DXC compilation failed."); return;
    }

    const naga_args = [_][]const u8{ naga_path, spirv, wgsl };
    const naga = cappedRun(&naga_args) catch |err| {
        const diagnostic = std.fmt.allocPrint(A, "Naga could not run: {s}", .{@errorName(err)}) catch "Naga failed.";
        failure(req, .bad_request, diagnostic); return;
    };
    defer A.free(naga.stdout);
    defer A.free(naga.stderr);
    if (!childSucceeded(naga)) {
        failure(req, .bad_request, if (naga.stderr.len > 0) naga.stderr else "SPIR-V to WGSL conversion failed."); return;
    }
    const output = std.fs.cwd().readFileAlloc(A, wgsl, max_shader_result) catch {
        failure(req, .bad_request, "No valid WGSL output."); return;
    };
    defer A.free(output);
    if (output.len == 0) { failure(req, .bad_request, "Empty WGSL output."); return; }
    jsonResponse(req, .ok, .{
        .wgsl = output,
        .log = if (naga.stderr.len > 0) naga.stderr else dxc.stderr,
        .toolchain = "Zig + DXC SPIR-V + prebuilt Naga WGSL",
        .mapping = .{ .t0 = 0, .u0 = 16, .b0 = 32, .s0 = 48 },
    });
}
fn dispatch(req: *Request) void {
    if (!checkOrigin(req)) { failure(req, .forbidden, "Invalid Host or Origin."); return; }
    const target = if (std.mem.indexOfScalar(u8, req.head.target, '?')) |i|
        req.head.target[0..i] else req.head.target;
    const post = req.head.method == .POST;
    if (post and std.mem.startsWith(u8, target, "/api/session/")) {
        sessionEndpoint(req, target["/api/session/".len..]); return;
    }
    if (post and eql(u8, target, "/api/compile")) { compileHlsl(req); return; }
    if (req.head.method != .GET) { failure(req, .method_not_allowed, "Unsupported method."); return; }
    if (eql(u8, target, "/api/health")) {
        lock.lock();
        const count = sessions.count();
        lock.unlock();
        jsonResponse(req, .ok, .{ .ready = true, .activeTabs = count, .backend = "zig" }); return;
    }
    if (eql(u8, target, "/") or eql(u8, target, "/index.html"))
        return serveFile(req, "index.html", "text/html; charset=utf-8");
    if (eql(u8, target, "/live-runner.js"))
        return serveFile(req, "live-runner.js", "text/javascript; charset=utf-8");
    if (eql(u8, target, "/particle-step.hlsl"))
        return serveFile(req, "particle-step.hlsl", "text/plain; charset=utf-8");
    if (eql(u8, target, "/README.md"))
        return serveFile(req, "README.md", "text/plain; charset=utf-8");
    failure(req, .not_found, "Not found.");
}
fn serveConnection(connection: std.net.Server.Connection) void {
    defer connection.stream.close();
    var headers: [16 * 1024]u8 = undefined;
    var http_server = std.http.Server.init(connection, &headers);
    var req = http_server.receiveHead() catch return;
    dispatch(&req);
}
fn idleMonitor() void {
    while (true) {
        std.time.sleep(1000 * std.time.ns_per_ms);
        const now = timeMs();
        lock.lock();
        var expired = std.ArrayList([]const u8).init(A);
        defer expired.deinit();
        var it = sessions.iterator();
        while (it.next()) |kv| {
            if (now - kv.value_ptr.* > lease_timeout_ms)
                expired.append(kv.key_ptr.*) catch {};
        }
        for (expired.items) |key| {
            if (sessions.fetchRemove(key)) |kv| A.free(kv.key);
        }
        const n = sessions.count();
        if (n != 0) last_empty_ms = now;
        const should_stop = n == 0 and compilations == 0 and
            ((ever_opened and now - last_empty_ms >= close_delay_ms) or
            (!ever_opened and now - started_ms >= startup_grace_ms));
        lock.unlock();
        if (should_stop) {
            if (ready_file) |path| std.fs.cwd().deleteFile(path) catch {};
            std.process.exit(0);
        }
    }
}
pub fn main() !void {
    started_ms = timeMs();
    last_empty_ms = started_ms;
    startup_grace_ms = envMs("HLSL_STARTUP_GRACE_MS", startup_grace_ms);
    lease_timeout_ms = envMs("HLSL_LEASE_TIMEOUT_MS", lease_timeout_ms);
    close_delay_ms = envMs("HLSL_EXIT_DELAY_MS", close_delay_ms);
    const port = std.fmt.parseInt(u16, env("HLSL_PORT", "4173"), 10) catch return error.InvalidPort;
    if (port < 1024) return error.InvalidPort;
    origin = try std.fmt.allocPrint(A, "http://127.0.0.1:{d}", .{port});
    const exe = try std.fs.selfExePathAlloc(A);
    root_dir = std.fs.path.dirname(exe) orelse return error.InvalidExecutablePath;
    dxc_path = env("DXC_PATH", "dxc");
    naga_path = env("NAGA_PATH", "naga");
    ready_file = std.process.getEnvVarOwned(A, "HLSL_READY_FILE") catch null;

    const address = try std.net.Address.parseIp4("127.0.0.1", port);
    var server = try address.listen(.{ .reuse_address = false });
    defer server.deinit();
    std.debug.print("HLSL Playground Zig backend listening at {s}\n", .{origin});
    if (ready_file) |path| {
        var file = try std.fs.cwd().createFile(path, .{ .truncate = true });
        defer file.close();
        const ready = try std.json.stringifyAlloc(A, .{
            .pid = std.os.windows.GetCurrentProcessId(), .url = origin,
        }, .{});
        defer A.free(ready);
        try file.writeAll(ready);
    }
    const monitor = try std.Thread.spawn(.{}, idleMonitor, .{});
    monitor.detach();
    while (true) {
        const c = server.accept() catch continue;
        const thread = std.Thread.spawn(.{}, serveConnection, .{c}) catch {
            c.stream.close();
            continue;
        };
        thread.detach();
    }
}
