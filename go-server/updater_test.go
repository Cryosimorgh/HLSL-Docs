package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func sum(value string) string { s := sha256.Sum256([]byte(value)); return hex.EncodeToString(s[:]) }
func TestUpdaterValidation(t *testing.T) {
	good := updateManifest{Version: "v2.2.0", Files: []updateFile{{Path: "playground/sunder-ide.css", Asset: "delta-0123456789abcdef.bin", SHA256: sum("good"), Size: 4}}}
	if e := validateManifest(good); e != nil {
		t.Fatal(e)
	}
	if !versionNewer("v2.2.0", "v2.1.0") || versionNewer("v2.1.0", "v2.1.0") || versionNewer("v2.0.9", "v2.1.0") {
		t.Fatal("semver compare")
	}
	badPaths := []string{"../foo", "tools/dxc/../../evil", "playground/../../Documents/shader.hlsl", "C:/Windows/system32/a.exe", "playground/vendor/codemirror/not-allowed.js", "personal.hlsl", "playground/subpath/other.js", "playground/hello\\evil.js"}
	for _, path := range badPaths {
		m := good
		m.Files = append([]updateFile(nil), good.Files...)
		m.Files[0].Path = path
		if validateManifest(m) == nil {
			t.Errorf("unsafe path accepted: %q", path)
		}
	}
	m := good
	m.Files = append(m.Files, m.Files[0])
	if validateManifest(m) == nil {
		t.Fatal("duplicate path accepted")
	}
	m = good
	m.Files[0].Asset = "https://evil.example/a"
	if validateManifest(m) == nil {
		t.Fatal("external URL accepted")
	}
}
func TestUpdaterCompareAndApply(t *testing.T) {
	root := t.TempDir()
	stage := t.TempDir()
	target := filepath.Join(root, "playground", "sunder-ide.css")
	if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	asset := "delta-0123456789abcdef.bin"
	file := updateFile{Path: "playground/sunder-ide.css", Asset: asset, SHA256: sum("new content"), Size: int64(len("new content"))}
	m := updateManifest{Version: "v2.2.0", Files: []updateFile{file}}
	plan, e := compareManifest(root, m)
	if e != nil || !plan.Available || len(plan.Changed) != 1 {
		t.Fatalf("bad plan %+v %v", plan, e)
	}
	if e = os.WriteFile(filepath.Join(stage, asset), []byte("tampered"), 0600); e != nil {
		t.Fatal(e)
	}
	data, _ := json.Marshal(m)
	_ = os.WriteFile(filepath.Join(stage, "pending.json"), data, 0600)
	if applyStaged(root, stage) == nil {
		t.Fatal("invalid staged hash accepted")
	}
	initial, _ := os.ReadFile(target)
	if string(initial) != "old" {
		t.Fatal("tamper damaged installation")
	}
	_ = os.WriteFile(filepath.Join(stage, asset), []byte("new content"), 0600)
	if e = applyStaged(root, stage); e != nil {
		t.Fatal(e)
	}
	updated, _ := os.ReadFile(target)
	if string(updated) != "new content" {
		t.Fatal("update failed")
	}
	plan, e = compareManifest(root, m)
	if e != nil || len(plan.Changed) != 0 {
		t.Fatal("unchanged file offered for download")
	}
}
func TestUpdaterRejectsSymlink(t *testing.T) {
	root := t.TempDir()
	external := t.TempDir()
	_ = os.Symlink(external, filepath.Join(root, "playground"))
	_, e := safeManagedTarget(root, "playground/sunder-ide.css")
	if e == nil && strings.ToLower(os.Getenv("OS")) != "windows_nt" {
		t.Fatal("symlink path accepted")
	}
}
