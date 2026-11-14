// HLSL Workbench: persistent, loopback-only Windows desktop host.
// The Go process owns the compiler server; closing browser tabs never ends it.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	defaultPort    = 38457
	maxSourceBytes = 65536
	maxOutputBytes = 524288
	maxBodyBytes   = 131072
	appSignature   = "Sunder-HLSL-Workbench-Go/1"
)

type compilation struct {
	WGSL      string         `json:"wgsl"`
	Log       string         `json:"log"`
	Toolchain string         `json:"toolchain"`
	Mapping   map[string]int `json:"mapping"`
	CacheHit  bool           `json:"cacheHit"`
	CompileMs int64          `json:"compileMs"`
	DxcMs     int64          `json:"dxcMs"`
	NagaMs    int64          `json:"nagaMs"`
}
type compileRequest struct {
	Source string `json:"source"`
	Entry  string `json:"entry"`
	Mode   string `json:"mode,omitempty"`
}
type document struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Source   string `json:"source"`
	Baseline string `json:"baseline"`
	Path     string `json:"-"`
}
type application struct {
	root       string
	site       string
	origin     string
	port       int
	secret     string
	cacheFile  string
	cacheMu    sync.Mutex
	cache      map[string]compilation
	cacheOrder []string
	docsMu     sync.Mutex
	docs       map[string]*document
	docOrder   []string
	server     *http.Server
	updates    updateState
}

func secretString() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
func jsonReply(w http.ResponseWriter, code int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(value)
}
func jsonError(w http.ResponseWriter, code int, message string) {
	jsonReply(w, code, map[string]string{"error": message})
}
func decode(r *http.Request, out any) error {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		return errors.New("expected application/json")
	}
	dec := json.NewDecoder(io.LimitReader(r.Body, maxBodyBytes+1))
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return errors.New("unexpected extra JSON input")
	}
	return nil
}
func safeHost(r *http.Request, origin string) bool {
	if r.Host != strings.TrimPrefix(origin, "http://") {
		return false
	}
	if v := r.Header.Get("Origin"); v != "" && v != origin {
		return false
	}
	if v := r.Header.Get("Sec-Fetch-Site"); v != "" && v != "same-origin" && v != "none" {
		return false
	}
	return true
}
func (a *application) isDesktop(r *http.Request) bool {
	token := r.Header.Get("X-Workbench-Token")
	return len(token) == len(a.secret) && subtle.ConstantTimeCompare([]byte(token), []byte(a.secret)) == 1
}
func (a *application) secure(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !safeHost(r, a.origin) {
			jsonError(w, 403, "Invalid Host or Origin")
			return
		}
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		if r.Method == http.MethodPost || r.Method == http.MethodPut {
			r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
			if !a.isDesktop(r) && r.Header.Get("Origin") != a.origin {
				jsonError(w, 403, "Same-origin request required")
				return
			}
		}
		next(w, r)
	}
}
func (a *application) routes() http.Handler {
	mux := http.NewServeMux()
	a.updateRoutes(mux)
	mux.HandleFunc("/api/health", a.secure(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			jsonError(w, 405, "Method not allowed")
			return
		}
		w.Header().Set("X-HLSL-Workbench", appSignature)
		jsonReply(w, 200, map[string]any{"ready": true, "backend": "go", "persistent": true, "signature": appSignature, "root": a.root})
	}))
	mux.HandleFunc("/api/session/", a.secure(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			jsonError(w, 405, "Method not allowed")
			return
		}
		switch strings.TrimPrefix(r.URL.Path, "/api/session/") {
		case "open":
			jsonReply(w, 200, map[string]any{"token": "go-persistent", "heartbeatMs": 30000, "persistent": true})
		case "ping", "close":
			jsonReply(w, 200, map[string]any{"ok": true, "persistent": true})
		default:
			jsonError(w, 404, "Unknown session action")
		}
	}))
	mux.HandleFunc("/api/compile", a.secure(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			jsonError(w, 405, "Method not allowed")
			return
		}
		var req compileRequest
		if err := decode(r, &req); err != nil {
			jsonError(w, 400, err.Error())
			return
		}
		result, err := a.compile(r.Context(), req)
		if err != nil {
			jsonError(w, 400, "Compile error: "+err.Error())
			return
		}
		jsonReply(w, 200, result)
	}))
	mux.HandleFunc("/api/desktop/open", a.secure(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			jsonError(w, 405, "Method not allowed")
			return
		}
		if !a.isDesktop(r) {
			jsonError(w, 403, "Desktop authorization required")
			return
		}
		var req struct {
			Path string `json:"path"`
		}
		if err := decode(r, &req); err != nil {
			jsonError(w, 400, err.Error())
			return
		}
		doc, err := a.openDocument(req.Path)
		if err != nil {
			jsonError(w, 400, err.Error())
			return
		}
		jsonReply(w, 200, map[string]string{"id": doc.ID})
	}))
	mux.HandleFunc("/api/documents/", a.secure(a.documentAPI))
	mux.HandleFunc("/api/server/stop", a.secure(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			jsonError(w, 405, "Method not allowed")
			return
		}
		if !a.isDesktop(r) && r.Header.Get("Origin") != a.origin {
			jsonError(w, 403, "Not authorized")
			return
		}
		jsonReply(w, 200, map[string]bool{"stopping": true})
		go func() {
			time.Sleep(125 * time.Millisecond)
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_ = a.server.Shutdown(ctx)
		}()
	}))
	// Allow only known app assets. No arbitrary filesystem browsing.
	assets := map[string]string{
		"/": "index.html", "/index.html": "index.html", "/favicon.ico": "favicon.ico", "/sunder-mark.svg": "sunder-mark.svg",
	}
	for _, file := range []string{"live-runner.js", "animation-runner.js", "desktop-files.js", "sunder-ide.js", "sunder-ide.css", "julia-loop.hlsl", "julia-rgba.hlsl", "particles-rgba.hlsl", "browser-gpu.js", "gpu-visualizer.js", "hlsl-highlight.js", "hlsl-fold-docs.js", "hlsl-intellisense.js", "hlsl-docs-data.js", "hlsl-reference.js", "hlsl-reference.html", "workbench.css", "circle-mask.hlsl", "particle-step.hlsl", "README.md", "vendor/codemirror/codemirror.js", "vendor/codemirror/codemirror.css", "vendor/codemirror/clike.js", "vendor/codemirror/foldcode.js", "vendor/codemirror/foldgutter.js", "vendor/codemirror/foldgutter.css", "vendor/codemirror/show-hint.js", "vendor/codemirror/show-hint.css"} {
		assets["/"+file] = file
	}
	mux.HandleFunc("/", a.secure(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" {
			jsonError(w, 405, "Method not allowed")
			return
		}
		file, ok := assets[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		full := filepath.Join(a.site, filepath.FromSlash(file))
		data, err := os.ReadFile(full)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if len(data) > 2*1024*1024 {
			http.Error(w, "Asset too large", 413)
			return
		}
		contentType := mime.TypeByExtension(filepath.Ext(file))
		switch filepath.Ext(file) {
		case ".js":
			contentType = "text/javascript; charset=utf-8"
		case ".hlsl", ".md":
			contentType = "text/plain; charset=utf-8"
		case ".ico":
			contentType = "image/x-icon"
		}
		if contentType != "" {
			w.Header().Set("Content-Type", contentType)
		}
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(data)
	}))
	return mux
}
func validShader(source, entry string) error {
	if len(source) < 1 || len(source) > maxSourceBytes || strings.ContainsRune(source, '\x00') {
		return errors.New("invalid HLSL source length or NUL byte")
	}
	if len(entry) < 1 || len(entry) > 64 {
		return errors.New("invalid entry point")
	}
	for i, r := range entry {
		if !((r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || r == '_' || (i > 0 && r >= '0' && r <= '9')) {
			return errors.New("invalid entry point")
		}
	}
	for _, ln := range strings.Split(source, "\n") {
		l := strings.TrimLeft(ln, " \t\r")
		if strings.HasPrefix(l, "#") {
			l = strings.ToLower(strings.TrimSpace(l[1:]))
			for _, directive := range []string{"include", "include_next", "import"} {
				if strings.HasPrefix(l, directive) && (len(l) == len(directive) || l[len(directive)] == ' ' || l[len(directive)] == '\t' || l[len(directive)] == '<') {
					return errors.New("#include and #import are disabled")
				}
			}
		}
	}
	return nil
}
func runTool(ctx context.Context, exe string, args ...string) (string, error) {
	toolCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(toolCtx, exe, args...)
	cmd.Dir = filepath.Dir(args[len(args)-1]) // Last parameter is always output or input file in temp directory.
	var stdout, stderr limitedBuffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	output := strings.TrimSpace(stderr.String() + "\n" + stdout.String())
	if toolCtx.Err() == context.DeadlineExceeded {
		return output, errors.New("compiler exceeded 15-second timeout")
	}
	if err != nil {
		return output, fmt.Errorf("%w: %s", err, output)
	}
	return output, nil
}

type limitedBuffer struct{ bytes.Buffer }

func (b *limitedBuffer) Write(p []byte) (int, error) {
	n := len(p)
	if b.Len() < 8192 {
		_, _ = b.Buffer.Write(p[:min(n, 8192-b.Len())])
	}
	return n, nil
}
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
func (a *application) compile(ctx context.Context, req compileRequest) (compilation, error) {
	if err := validShader(req.Source, req.Entry); err != nil {
		return compilation{}, err
	}
	mode := req.Mode
	if mode == "" {
		mode = "fast"
	}
	if mode != "fast" && mode != "optimized" {
		return compilation{}, errors.New("invalid compiler optimization mode")
	}
	hash := compilerKey(a.root, req.Source, req.Entry+":"+mode)
	a.cacheMu.Lock()
	defer a.cacheMu.Unlock() // Serialize bounded compiler jobs and avoid duplicate concurrent work.
	if c, ok := a.cache[hash]; ok {
		c.CacheHit = true
		c.CompileMs = 0
		c.DxcMs = 0
		c.NagaMs = 0
		return c, nil
	}
	if c, ok := loadCompilerCache(a.root, hash); ok {
		a.cache[hash] = c
		return c, nil
	}
	temp, err := os.MkdirTemp("", "sunder-hlsl-")
	if err != nil {
		return compilation{}, err
	}
	defer os.RemoveAll(temp)
	in := filepath.Join(temp, "shader.hlsl")
	spv := filepath.Join(temp, "shader.spv")
	wgslPath := filepath.Join(temp, "shader.wgsl")
	if err = os.WriteFile(in, []byte(req.Source), 0600); err != nil {
		return compilation{}, err
	}
	start := time.Now()
	dxc := filepath.Join(a.root, "tools", "dxc", "dxc.exe")
	naga := filepath.Join(a.root, "tools", "naga", "naga.exe")
	optFlag := "-O1" // Shorter DXC passes for interactive editing; browser GPU still validates WGSL.
	if mode == "optimized" {
		optFlag = "-O3"
	}
	dxcLog, err := runTool(ctx, dxc, optFlag, "-spirv", "-fspv-target-env=vulkan1.1", "-T", "cs_6_0", "-E", req.Entry, "-Fo", spv, "-fvk-t-shift", "0", "0", "-fvk-u-shift", "16", "0", "-fvk-b-shift", "32", "0", "-fvk-s-shift", "48", "0", in)
	if err != nil {
		return compilation{}, fmt.Errorf("DXC: %w", err)
	}
	dxcTime := time.Since(start).Milliseconds()
	if info, e := os.Stat(spv); e != nil || info.Size() == 0 {
		return compilation{}, errors.New("DXC produced no SPIR-V")
	}
	nagaLog, err := runTool(ctx, naga, spv, wgslPath)
	if err != nil {
		return compilation{}, fmt.Errorf("Naga: %w", err)
	}
	info, err := os.Stat(wgslPath)
	if err != nil || info.Size() == 0 || info.Size() > maxOutputBytes {
		return compilation{}, errors.New("Naga produced missing or oversized WGSL")
	}
	wgsl, err := os.ReadFile(wgslPath)
	if err != nil {
		return compilation{}, err
	}
	ms := time.Since(start).Milliseconds()
	c := compilation{WGSL: string(wgsl), Log: strings.TrimSpace(dxcLog + "\n" + nagaLog), Toolchain: "Go / Microsoft DXC / Naga / WebGPU", Mapping: map[string]int{"t0": 0, "u0": 16, "b0": 32, "s0": 48}, CacheHit: false, CompileMs: ms, DxcMs: dxcTime, NagaMs: ms - dxcTime}
	a.cache[hash] = c
	saveCompilerCache(a.root, hash, c)
	a.cacheOrder = append(a.cacheOrder, hash)
	if len(a.cacheOrder) > 8 {
		delete(a.cache, a.cacheOrder[0])
		a.cacheOrder = a.cacheOrder[1:]
	}
	return c, nil
}
func (a *application) openDocument(path string) (*document, error) {
	if strings.ToLower(filepath.Ext(path)) != ".hlsl" && strings.ToLower(filepath.Ext(path)) != ".hlsli" {
		return nil, errors.New("only .hlsl and .hlsli files can be opened")
	}
	full, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(full)
	if err != nil {
		return nil, err
	}
	if info.IsDir() || info.Size() > maxSourceBytes {
		return nil, errors.New("shader file must be at most 64 KiB")
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return nil, err
	}
	if bytes.IndexByte(data, 0) != -1 {
		return nil, errors.New("shader file contains binary data")
	}
	s, err := secretString()
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(data)
	doc := &document{ID: s[:24], Name: filepath.Base(full), Path: full, Source: string(data), Baseline: hex.EncodeToString(hash[:])}
	a.docsMu.Lock()
	defer a.docsMu.Unlock()
	a.docs[doc.ID] = doc
	a.docOrder = append(a.docOrder, doc.ID)
	if len(a.docOrder) > 64 {
		delete(a.docs, a.docOrder[0])
		a.docOrder = a.docOrder[1:]
	}
	return doc, nil
}
func (a *application) documentAPI(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/documents/")
	if len(id) != 24 || strings.Contains(id, "/") {
		jsonError(w, 404, "Unknown document")
		return
	}
	a.docsMu.Lock()
	defer a.docsMu.Unlock()
	doc, ok := a.docs[id]
	if !ok {
		jsonError(w, 404, "Unknown document")
		return
	}
	switch r.Method {
	case "GET":
		jsonReply(w, 200, doc)
	case "PUT":
		var req struct {
			Source   string `json:"source"`
			Baseline string `json:"baseline"`
		}
		if err := decode(r, &req); err != nil {
			jsonError(w, 400, err.Error())
			return
		}
		if len(req.Source) > maxSourceBytes || strings.ContainsRune(req.Source, '\x00') {
			jsonError(w, 400, "Invalid shader data")
			return
		}
		if req.Baseline != doc.Baseline {
			jsonError(w, 409, "File was saved from another editor tab; reload before saving")
			return
		}
		existing, err := os.ReadFile(doc.Path)
		if err != nil {
			jsonError(w, 409, "Source file no longer exists")
			return
		}
		hash := sha256.Sum256(existing)
		if hex.EncodeToString(hash[:]) != doc.Baseline {
			jsonError(w, 409, "File changed on disk; use Save .hlsl to export without overwriting")
			return
		}
		// Rewrite the known-opened file only. Browser never supplies a filesystem path.
		if err := os.WriteFile(doc.Path, []byte(req.Source), 0600); err != nil {
			jsonError(w, 500, err.Error())
			return
		}
		next := sha256.Sum256([]byte(req.Source))
		doc.Baseline = hex.EncodeToString(next[:])
		doc.Source = req.Source
		jsonReply(w, 200, map[string]string{"baseline": doc.Baseline, "name": doc.Name})
	default:
		jsonError(w, 405, "Method not allowed")
	}
}
func saveAtomically(path string, data []byte) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".hlsl-workbench-save-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err = tmp.Chmod(info.Mode().Perm()); err != nil {
		tmp.Close()
		return err
	}
	if _, err = tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}

func cacheLocation(port int) (string, error) {
	dir, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	folder := filepath.Join(dir, "Sunder", "HLSLWorkbench")
	if err = os.MkdirAll(folder, 0700); err != nil {
		return "", err
	}
	return filepath.Join(folder, fmt.Sprintf("server-%d.json", port)), nil
}

type serverMarker struct {
	Token string `json:"token"`
	Root  string `json:"root"`
}

func markerRead(path string) (serverMarker, error) {
	var m serverMarker
	data, err := os.ReadFile(path)
	if err != nil {
		return m, err
	}
	err = json.Unmarshal(data, &m)
	return m, err
}
func (a *application) saveMarker() error {
	data, _ := json.Marshal(serverMarker{Token: a.secret, Root: a.root})
	return os.WriteFile(a.cacheFile, data, 0600)
}
func runClient(port int, root string, openFile string, stop bool) (string, error) {
	endpoint := fmt.Sprintf("http://127.0.0.1:%d", port)
	client := &http.Client{Timeout: 3 * time.Second}
	request, err := http.NewRequest("GET", endpoint+"/api/health", nil)
	if err != nil {
		return "", err
	}
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	var health struct {
		Root      string `json:"root"`
		Signature string `json:"signature"`
	}
	err = json.NewDecoder(response.Body).Decode(&health)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 || health.Signature != appSignature {
		return "", errors.New("port is occupied by another application")
	}
	if !strings.EqualFold(filepath.Clean(health.Root), filepath.Clean(root)) {
		return "", errors.New("another HLSL Workbench installation already uses this port")
	}
	if openFile == "" && !stop {
		return endpoint + "/", nil
	}
	markerPath, err := cacheLocation(port)
	if err != nil {
		return "", err
	}
	marker, err := markerRead(markerPath)
	if err != nil {
		return "", fmt.Errorf("cannot authenticate running server: %w", err)
	}
	if !strings.EqualFold(filepath.Clean(marker.Root), filepath.Clean(root)) {
		return "", errors.New("server authentication belongs to another installation")
	}
	route := "/api/desktop/open"
	body := map[string]string{"path": openFile}
	if stop {
		route = "/api/server/stop"
		body = map[string]string{}
	}
	payload, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", endpoint+route, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Workbench-Token", marker.Token)
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		data, _ := io.ReadAll(io.LimitReader(res.Body, 1000))
		return "", fmt.Errorf("running server rejected request: %s", data)
	}
	if stop {
		return "", nil
	}
	var doc struct {
		ID string `json:"id"`
	}
	if err = json.NewDecoder(res.Body).Decode(&doc); err != nil {
		return "", err
	}
	return endpoint + "/?document=" + doc.ID, nil
}
func openBrowser(url string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		return exec.Command("open", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}
func installAssociation(root string, uninstall bool) error {
	if runtime.GOOS != "windows" {
		return errors.New("file associations supported only on Windows")
	}
	exe := filepath.Join(root, "HLSLWorkbench.exe")
	reg := func(args ...string) error {
		cmd := exec.Command("reg.exe", args...)
		out, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("reg %s: %v: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
		}
		return nil
	}
	prog := `HKCU\Software\Classes\Sunder.HLSL.Workbench`
	app := `HKCU\Software\Classes\Applications\HLSLWorkbench.exe`
	caps := `HKCU\Software\Sunder\HLSLWorkbench\Capabilities`
	registered := `HKCU\Software\RegisteredApplications`
	if uninstall {
		for _, key := range []string{prog, app, caps} {
			_ = reg("delete", key, "/f")
		}
		_ = reg("delete", registered, "/v", "Sunder HLSL Workbench", "/f")
		_ = reg("delete", `HKCU\Software\Classes\.hlsl\OpenWithProgids`, "/v", "Sunder.HLSL.Workbench", "/f")
		_ = reg("delete", `HKCU\Software\Classes\.hlsli\OpenWithProgids`, "/v", "Sunder.HLSL.Workbench", "/f")
		for _, ext := range []string{".hlsl", ".hlsli"} {
			_ = reg("delete", `HKCU\Software\Classes\`+ext+`\OpenWithList\HLSLWorkbench.exe`, "/f")
		}
		return nil
	}
	add := func(key, value string) error { return reg("add", key, "/ve", "/t", "REG_SZ", "/d", value, "/f") }
	if err := add(prog, "Sunder HLSL Workbench shader"); err != nil {
		return err
	}
	if err := add(prog+`\DefaultIcon`, exe+",0"); err != nil {
		return err
	}
	if err := add(prog+`\shell\open\command`, `"`+exe+`" --open "%1"`); err != nil {
		return err
	}
	if err := add(app+`\shell\open\command`, `"`+exe+`" --open "%1"`); err != nil {
		return err
	}
	if err := reg("add", app+`\SupportedTypes`, "/v", ".hlsl", "/t", "REG_SZ", "/d", "", "/f"); err != nil {
		return err
	}
	if err := reg("add", app+`\SupportedTypes`, "/v", ".hlsli", "/t", "REG_SZ", "/d", "", "/f"); err != nil {
		return err
	}
	for _, ext := range []string{".hlsl", ".hlsli"} {
		if err := reg("add", `HKCU\Software\Classes\`+ext+`\OpenWithProgids`, "/v", "Sunder.HLSL.Workbench", "/t", "REG_NONE", "/f"); err != nil {
			return err
		}
		if err := reg("add", `HKCU\Software\Classes\`+ext+`\OpenWithList\HLSLWorkbench.exe`, "/f"); err != nil {
			return err
		}
		if err := reg("add", caps+`\FileAssociations`, "/v", ext, "/t", "REG_SZ", "/d", "Sunder.HLSL.Workbench", "/f"); err != nil {
			return err
		}
	}
	if err := reg("add", caps, "/v", "ApplicationName", "/t", "REG_SZ", "/d", "Sunder HLSL Workbench", "/f"); err != nil {
		return err
	}
	if err := reg("add", caps, "/v", "ApplicationDescription", "/t", "REG_SZ", "/d", "Offline HLSL editor and local Go shader compiler server", "/f"); err != nil {
		return err
	}
	return reg("add", registered, "/v", "Sunder HLSL Workbench", "/t", "REG_SZ", "/d", `Software\Sunder\HLSLWorkbench\Capabilities`, "/f")
}
func run() error {
	var openFile string
	var noBrowser, stop, register, unregister bool
	var port int
	var applyUpdate, updateTarget string
	var parentPID int
	flag.StringVar(&applyUpdate, "apply-update", "", "Apply a verified staged delta update")
	flag.StringVar(&updateTarget, "target", "", "Update target installation path")
	flag.IntVar(&parentPID, "parent-pid", 0, "Process being updated")
	flag.StringVar(&openFile, "open", "", "Open an existing .hlsl or .hlsli file in a browser tab")
	flag.BoolVar(&noBrowser, "no-browser", false, "Do not launch a browser")
	flag.BoolVar(&stop, "stop", false, "Stop the running persistent server")
	flag.BoolVar(&register, "register", false, "Register HLSL Open With integration for the current Windows user")
	flag.BoolVar(&unregister, "unregister", false, "Unregister file association")
	flag.IntVar(&port, "port", defaultPort, "Localhost TCP port")
	flag.Parse()
	if applyUpdate != "" {
		return applyUpdateHelper(applyUpdate, updateTarget, parentPID)
	}
	if port < 1024 || port > 65535 {
		return errors.New("invalid port")
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	root := filepath.Dir(exe)
	if register || unregister {
		return installAssociation(root, unregister)
	}
	if openFile == "" && len(flag.Args()) > 0 {
		openFile = flag.Args()[0]
	}
	if openFile != "" {
		openFile, err = filepath.Abs(openFile)
		if err != nil {
			return err
		}
		if info, e := os.Stat(openFile); e != nil || info.IsDir() {
			return fmt.Errorf("HLSL file not found: %s", openFile)
		}
	}
	markerPath, err := cacheLocation(port)
	if err != nil {
		return err
	}
	origin := fmt.Sprintf("http://127.0.0.1:%d", port)
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		url, otherErr := runClient(port, root, openFile, stop)
		if otherErr != nil {
			return fmt.Errorf("could not start or connect to server: %w", otherErr)
		}
		if !stop && !noBrowser {
			return openBrowser(url)
		}
		fmt.Println(url)
		return nil
	}
	defer listener.Close()
	if stop {
		return errors.New("no running server to stop")
	}
	for _, tool := range []string{"tools/dxc/dxc.exe", "tools/dxc/dxcompiler.dll", "tools/naga/naga.exe"} {
		if _, err = os.Stat(filepath.Join(root, filepath.FromSlash(tool))); err != nil {
			return fmt.Errorf("missing compiler file %s: %w", tool, err)
		}
	}
	secret, err := secretString()
	if err != nil {
		return err
	}
	a := &application{root: root, site: filepath.Join(root, "playground"), origin: origin, port: port, secret: secret, cacheFile: markerPath, cache: make(map[string]compilation), docs: make(map[string]*document)}
	if err = a.saveMarker(); err != nil {
		return err
	}
	defer os.Remove(markerPath)
	docURL := origin + "/"
	if openFile != "" {
		doc, err := a.openDocument(openFile)
		if err != nil {
			return err
		}
		docURL = origin + "/?document=" + doc.ID
	}
	a.server = &http.Server{Addr: listener.Addr().String(), Handler: a.routes(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 40 * time.Second, WriteTimeout: 50 * time.Second, IdleTimeout: 75 * time.Second}
	fmt.Println("Persistent HLSL Workbench server running at", origin)
	if !noBrowser {
		go func() {
			time.Sleep(180 * time.Millisecond)
			if err := openBrowser(docURL); err != nil {
				log.Println("browser:", err)
			}
		}()
	}
	err = a.server.Serve(listener)
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
func main() {
	logFile, err := appLog()
	if err == nil {
		defer logFile.Close()
		log.SetOutput(io.MultiWriter(os.Stderr, logFile))
	}
	if err := run(); err != nil {
		log.Println("HLSL Workbench:", err)
		showError("HLSL Workbench could not start:\n" + err.Error())
		os.Exit(1)
	}
}
func appLog() (*os.File, error) {
	dir, err := os.UserCacheDir()
	if err != nil {
		return nil, err
	}
	dir = filepath.Join(dir, "Sunder", "HLSLWorkbench")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	return os.OpenFile(filepath.Join(dir, "workbench.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
}
