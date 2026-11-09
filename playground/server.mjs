/**
 * Local-only HLSL -> SPIR-V -> WGSL compiler bridge for the browser playground.
 * Prerequisites: Node.js >= 20, DXC with SPIR-V backend, naga-cli.
 *
 * IMPORTANT: This bridge COMPILES shader source; the browser WebGPU device
 * RUNS the resulting WGSL compute kernel with user-specified buffer bindings.
 * It does not make all Direct3D features executable in a browser.
 */
import http from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const host = "127.0.0.1";
const port = Number(process.env.HLSL_PORT || 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("HLSL_PORT must be a port in [1024, 65535].");
}
const origin = "http://" + host + ":" + port;
const maxPostBytes = 128 * 1024;
const maxShaderChars = 64 * 1024;
const maxLogChars = 8000;
let busy = false;

// Each browser tab owns one short-lived lease. pagehide sends a best-effort
// close request; if the browser is killed, missed heartbeats expire the lease.
// Never stop a server while another active tab still owns a lease.
const leases = new Map();
const compileChildren = new Set();
const launchedAt = Date.now();
const startupGraceMs = Number(process.env.HLSL_STARTUP_GRACE_MS || 90000);
const leaseTimeoutMs = Number(process.env.HLSL_LEASE_TIMEOUT_MS || 45000);
const exitDelayMs = Number(process.env.HLSL_EXIT_DELAY_MS || 1200);
const readyFile = process.env.HLSL_READY_FILE || null;
if (![startupGraceMs, leaseTimeoutMs, exitDelayMs].every(n => Number.isFinite(n) && n >= 200 && n <= 600000)) {
    throw new Error("Invalid lifecycle time settings.");
}
let everLeased = false;
let lastClientGone = launchedAt;
let closing = false;
let interval;
function expireLeases(now = Date.now()) {
    for (const [token, lastSeen] of leases) {
        if (now - lastSeen > leaseTimeoutMs) leases.delete(token);
    }
}
async function shutdown(reason) {
    if (closing) return;
    closing = true;
    console.log("Closing local HLSL compiler server: " + reason);
    if (interval) clearInterval(interval);
    for (const child of compileChildren) child.kill();
    server.close();
    if (readyFile) await unlink(readyFile).catch(() => {});
    // Any open compiler stdout handles / keepalive connections are bounded.
    setTimeout(() => process.exit(0), 2000).unref();
}
function checkIdle() {
    const now = Date.now();
    expireLeases(now);
    if (leases.size) {
        lastClientGone = now;
        return;
    }
    // Allow time for initial launch, but stop promptly after the last tab
    // closes. An abandoned launcher also exits after a short grace period.
    if (!everLeased && now - launchedAt < startupGraceMs) return;
    if (everLeased && now - lastClientGone < exitDelayMs) return;
    void shutdown("no active playground tabs");
}
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT", () => { void shutdown("SIGINT"); });

const dxc = process.env.DXC_PATH || "dxc";
const naga = process.env.NAGA_PATH || "naga";
const allowedFiles = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/index.html", ["index.html", "text/html; charset=utf-8"]],
    ["/live-runner.js", ["live-runner.js", "text/javascript; charset=utf-8"]],
    ["/particle-step.hlsl", ["particle-step.hlsl", "text/plain; charset=utf-8"]],
    ["/README.md", ["README.md", "text/plain; charset=utf-8"]]
]);

function send(res, status, object) {
    const data = JSON.stringify(object);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin"
    });
    res.end(data);
}

function run(executable, args, cwd) {
    return new Promise((ok, reject) => {
        const proc = spawn(executable, args, {
            cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
        });
        compileChildren.add(proc);
        let stdout = "", stderr = "", finished = false;
        const timer = setTimeout(() => {
            proc.kill();
            if (!finished) {
                finished = true;
                reject(new Error(executable + " exceeded the 15-second compile limit."));
            }
        }, 15000);
        for (const [stream, key] of [[proc.stdout, "out"], [proc.stderr, "err"]]) {
            stream.setEncoding("utf8");
            stream.on("data", chunk => {
                if (key === "out") stdout = (stdout + chunk).slice(-maxLogChars);
                else stderr = (stderr + chunk).slice(-maxLogChars);
            });
        }
        proc.on("error", error => {
            clearTimeout(timer);
            compileChildren.delete(proc);
            if (finished) return;
            finished = true;
            reject(new Error(executable + ": " + error.message));
        });
        proc.on("close", code => {
            clearTimeout(timer);
            if (finished) return;
            finished = true;
            if (code !== 0) {
                reject(new Error(executable + " exited " + code + ":\n" + (stderr || stdout)));
            } else {
                ok((stderr + "\n" + stdout).trim().slice(-maxLogChars));
            }
        });
    });
}

function parseRequest(req) {
    return new Promise((ok, reject) => {
        let length = 0;
        const chunks = [];
        req.on("data", chunk => {
            length += chunk.length;
            if (length > maxPostBytes) {
                reject(new Error("Request exceeds 128 KiB."));
                req.destroy();
            } else {
                chunks.push(chunk);
            }
        });
        req.on("end", () => {
            try { ok(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
            catch { reject(new Error("Expected valid JSON request body.")); }
        });
        req.on("error", reject);
    });
}

async function compile(payload) {
    const source = payload && payload.source;
    const entry = payload && payload.entry;
    if (typeof source !== "string" || source.length < 1 || source.length > maxShaderChars) {
        throw new Error("HLSL source must contain 1–65536 characters.");
    }
    if (typeof entry !== "string" || !/^[A-Za-z_]\w{0,63}$/.test(entry)) {
        throw new Error("Entry point must be a simple HLSL identifier.");
    }
    // Prevent local file reads through the shader preprocessor.
    if (/^\s*#\s*(include|include_next|import)\b/m.test(source)) {
        throw new Error("Includes are disabled in the local playground. Paste dependencies into the editor.");
    }
    if (source.includes("\0")) throw new Error("NUL bytes are not allowed.");

    const { writeFile } = await import("node:fs/promises");
    const directory = await mkdtemp(join(tmpdir(), "hlsl-playground-"));
    try {
        const input = join(directory, "input.hlsl");
        const spirv = join(directory, "output.spv");
        const wgsl = join(directory, "output.wgsl");
        await writeFile(input, source, "utf8");
        // Distinct shifts for t/u/b/s avoid b0/t0/u0 binding collisions.
        // t0 -> @group(0) @binding(0)
        // u0 -> @group(0) @binding(16)
        // b0 -> @group(0) @binding(32)
        // s0 -> @group(0) @binding(48)
        const compilerLog = await run(dxc, [
            "-spirv", "-fspv-target-env=vulkan1.1", "-T", "cs_6_0",
            "-E", entry, "-Fo", spirv,
            "-fvk-t-shift", "0", "0",
            "-fvk-u-shift", "16", "0",
            "-fvk-b-shift", "32", "0",
            "-fvk-s-shift", "48", "0",
            input
        ], directory);
        const nagaLog = await run(naga, [spirv, wgsl], directory);
        const converted = await readFile(wgsl, "utf8");
        if (!converted || converted.length > 512 * 1024) {
            throw new Error("Translated WGSL is empty or exceeds the 512 KiB limit.");
        }
        return {
            wgsl: converted,
            log: [compilerLog, nagaLog].filter(Boolean).join("\n").slice(-maxLogChars),
            toolchain: "DXC SPIR-V → Naga WGSL",
            mapping: { t0: 0, u0: 16, b0: 32, s0: 48 }
        };
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

const server = http.createServer(async (req, res) => {
    const target = (req.url || "").split("?")[0];
    const originHeader = req.headers.origin;
    if (originHeader && originHeader !== origin) {
        send(res, 403, { error: "Cross-origin requests are forbidden." });
        return;
    }
    if (req.method === "GET" && target === "/api/health") {
        send(res, 200, { ready: true, activeTabs: leases.size });
        return;
    }
    if (req.method === "POST" && target.startsWith("/api/session/")) {
        if ((req.headers["content-type"] || "").split(";")[0] !== "application/json") {
            send(res, 415, { error: "Session requests require JSON." });
            return;
        }
        try {
            const operation = target.slice("/api/session/".length);
            if (operation === "open") {
                if (closing) { send(res, 503, { error: "Server is closing." }); return; }
                const token = randomUUID();
                leases.set(token, Date.now());
                everLeased = true;
                lastClientGone = Date.now();
                send(res, 200, { token, heartbeatMs: 5000, fallbackTimeoutMs: leaseTimeoutMs });
                return;
            }
            if (operation !== "ping" && operation !== "close") {
                send(res, 404, { error: "Unknown session operation." });
                return;
            }
            const body = await parseRequest(req);
            const token = body?.token;
            if (typeof token !== "string" || !leases.has(token)) {
                send(res, 404, { error: "Session expired or unknown." });
                return;
            }
            if (operation === "close") {
                leases.delete(token);
                if (!leases.size) lastClientGone = Date.now();
            } else {
                leases.set(token, Date.now());
            }
            send(res, 200, { ok: true, activeTabs: leases.size });
        } catch (error) {
            if (!res.destroyed) send(res, 400, { error: String(error.message || error) });
        }
        return;
    }
    if (req.method === "POST" && target === "/api/compile") {
        if ((req.headers["content-type"] || "").split(";")[0] !== "application/json") {
            send(res, 415, { error: "Content-Type must be application/json." });
            return;
        }
        if (busy) { send(res, 429, { error: "Another compile is in progress." }); return; }
        busy = true;
        try {
            const payload = await parseRequest(req);
            const result = await compile(payload);
            send(res, 200, result);
        } catch (error) {
            if (!res.destroyed) send(res, 400, { error: String(error.message || error).slice(0, maxLogChars) });
        } finally {
            busy = false;
        }
        return;
    }
    if (req.method !== "GET" || !allowedFiles.has(target)) {
        send(res, 404, { error: "Not found." });
        return;
    }
    try {
        const [name, mime] = allowedFiles.get(target);
        const data = await readFile(join(root, name));
        res.writeHead(200, {
            "Content-Type": mime, "Content-Length": data.length,
            "X-Content-Type-Options": "nosniff",
            "Cross-Origin-Resource-Policy": "same-origin",
            "Cache-Control": "no-store",
            "Content-Security-Policy":
                "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'"
        });
        res.end(data);
    } catch (error) {
        send(res, 500, { error: error.message });
    }
});

server.listen(port, host, async () => {
    console.log("HLSL playground: " + origin);
    console.log("Compiler tools: " + dxc + " / " + naga);
    if (readyFile) {
        await writeFile(readyFile, JSON.stringify({ pid: process.pid, url: origin }) + "\n", "utf8")
            .catch(e => console.error("Cannot write launcher ready file:", e.message));
    }
    interval = setInterval(checkIdle, 1000);
    interval.unref();
});
