package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testApp(t *testing.T) *application {
	t.Helper()
	root := t.TempDir()
	site := filepath.Join(root, "playground")
	if err := os.Mkdir(site, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(site, "index.html"), []byte("hello"), 0600); err != nil {
		t.Fatal(err)
	}
	return &application{root: root, site: site, origin: "http://127.0.0.1:38457", secret: strings.Repeat("a", 64), cache: make(map[string]compilation), docs: make(map[string]*document)}
}
func post(a *application, route string, v any, token bool) *httptest.ResponseRecorder {
	data, _ := json.Marshal(v)
	req := httptest.NewRequest("POST", "http://127.0.0.1:38457"+route, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	if token {
		req.Header.Set("X-Workbench-Token", a.secret)
	} else {
		req.Header.Set("Origin", a.origin)
	}
	rr := httptest.NewRecorder()
	a.routes().ServeHTTP(rr, req)
	return rr
}
func TestPersistentServerAndHostSecurity(t *testing.T) {
	a := testApp(t)
	for _, path := range []string{"/api/session/open", "/api/session/close", "/api/session/ping"} {
		if rr := post(a, path, map[string]any{}, false); rr.Code != 200 {
			t.Fatalf("%s: %d %s", path, rr.Code, rr.Body)
		}
	}
	req := httptest.NewRequest("GET", "http://127.0.0.1:38457/api/health", nil)
	rr := httptest.NewRecorder()
	a.routes().ServeHTTP(rr, req)
	if rr.Code != 200 || !strings.Contains(rr.Body.String(), `"persistent":true`) {
		t.Fatal(rr.Code, rr.Body)
	}
	req = httptest.NewRequest("GET", "http://bad.example:38457/index.html", nil)
	rr = httptest.NewRecorder()
	a.routes().ServeHTTP(rr, req)
	if rr.Code != 403 {
		t.Fatal("Host-header rebinding not rejected")
	}
	req = httptest.NewRequest("POST", "http://127.0.0.1:38457/api/server/stop", strings.NewReader("{}"))
	req.Header.Set("Origin", "http://other.example")
	rr = httptest.NewRecorder()
	a.routes().ServeHTTP(rr, req)
	if rr.Code != 403 {
		t.Fatal("Cross-origin shutdown not rejected")
	}
}
func TestOpenSaveAndConflicts(t *testing.T) {
	a := testApp(t)
	path := filepath.Join(t.TempDir(), "shader.hlsl")
	if err := os.WriteFile(path, []byte("float4 CSMain() { return 0; }"), 0600); err != nil {
		t.Fatal(err)
	}
	if rr := post(a, "/api/desktop/open", map[string]string{"path": path}, false); rr.Code != 403 {
		t.Fatal("Unauthorized desktop open:", rr.Code)
	}
	rr := post(a, "/api/desktop/open", map[string]string{"path": path}, true)
	if rr.Code != 200 {
		t.Fatal(rr.Code, rr.Body)
	}
	var opened struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &opened)
	req := httptest.NewRequest("GET", a.origin+"/api/documents/"+opened.ID, nil)
	r := httptest.NewRecorder()
	a.routes().ServeHTTP(r, req)
	if r.Code != 200 || strings.Contains(r.Body.String(), path) {
		t.Fatal("Path leaked or GET failed", r.Code, r.Body)
	}
	var doc document
	_ = json.Unmarshal(r.Body.Bytes(), &doc)
	req = httptest.NewRequest("PUT", a.origin+"/api/documents/"+opened.ID, strings.NewReader(`{"source":"fixed","baseline":"`+doc.Baseline+`"}`))
	req.Header.Set("Origin", a.origin)
	req.Header.Set("Content-Type", "application/json")
	r = httptest.NewRecorder()
	a.routes().ServeHTTP(r, req)
	if r.Code != 200 {
		t.Fatal("Save failed", r.Code, r.Body)
	}
	saved, _ := os.ReadFile(path)
	if string(saved) != "fixed" {
		t.Fatalf("file not updated: %q", saved)
	}
	if rr := post(a, "/api/desktop/open", map[string]string{"path": path}, true); rr.Code != 200 {
		t.Fatal(rr.Code, rr.Body)
	}
	if err := os.WriteFile(path, []byte("external edit"), 0600); err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest("PUT", a.origin+"/api/documents/"+opened.ID, strings.NewReader(`{"source":"bad overwrite","baseline":"`+doc.Baseline+`"}`))
	req.Header.Set("Origin", a.origin)
	req.Header.Set("Content-Type", "application/json")
	r = httptest.NewRecorder()
	a.routes().ServeHTTP(r, req)
	if r.Code != 409 {
		t.Fatal("stale writer not rejected", r.Code, r.Body)
	}
	final, _ := os.ReadFile(path)
	if string(final) != "external edit" {
		t.Fatal("external edit overwritten")
	}
}
func TestCompilerCacheAndValidation(t *testing.T) {
	a := testApp(t)
	for _, name := range []string{"dxc", "naga"} {
		if err := os.MkdirAll(filepath.Join(a.root, "tools", name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	dxc := `#!/bin/sh
while [ "$1" != "-Fo" ]; do shift; done
shift
printf 'fake spirv' > "$1"
`
	naga := `#!/bin/sh
printf '@compute @workgroup_size(8,8,1) fn main() {}' > "$2"
`
	if err := os.WriteFile(filepath.Join(a.root, "tools", "dxc", "dxc.exe"), []byte(dxc), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(a.root, "tools", "naga", "naga.exe"), []byte(naga), 0700); err != nil {
		t.Fatal(err)
	}
	req := compileRequest{Source: "[numthreads(8,8,1)] void CSMain() {}", Entry: "CSMain"}
	got, err := a.compile(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if got.CacheHit || !strings.Contains(got.WGSL, "@compute") {
		t.Fatal("first compile", got)
	}
	got, err = a.compile(context.Background(), req)
	if err != nil || !got.CacheHit {
		t.Fatal("cache miss", err, got)
	}
	// A new Go host process must hit the per-user disk cache as well.
	fresh := &application{root: a.root, cache: map[string]compilation{}}
	got, err = fresh.compile(context.Background(), req)
	if err != nil || !got.CacheHit {
		t.Fatal("persistent compiler cache miss", err, got)
	}
	for _, text := range []string{"#include <evil.hlsl>\nvoid CSMain() {}", "//x\n#import \"x\""} {
		if _, err := a.compile(context.Background(), compileRequest{Source: text, Entry: "CSMain"}); err == nil {
			t.Fatal("included source accepted")
		}
	}
	req.Entry = "wrong entry;"
	if _, err := a.compile(context.Background(), req); err == nil {
		t.Fatal("invalid entry accepted")
	}
	hash := sha256.Sum256([]byte("fixed"))
	if hex.EncodeToString(hash[:]) == "" {
		t.Fatal("hash failed")
	}
}
