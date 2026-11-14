package main

// Persist successful WGSL translations across browser and server restarts.
// Keys include source, entry, build contract and tool binaries' timestamps/sizes.
// No raw HLSL source is stored in this cache.
import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

func compilerKey(root, source, entry string) string {
	h := sha256.New()
	fmt.Fprintf(h, "sunder-dxc-naga-cache-v3\x00%s\x00%s\x00", entry, source)
	for _, name := range []string{"tools/dxc/dxc.exe", "tools/dxc/dxcompiler.dll", "tools/dxc/dxil.dll", "tools/naga/naga.exe"} {
		stat, err := os.Stat(filepath.Join(root, filepath.FromSlash(name)))
		if err != nil {
			fmt.Fprintf(h, "%s:missing:%s\x00", name, err)
			continue
		}
		fmt.Fprintf(h, "%s:%d:%d\x00", name, stat.Size(), stat.ModTime().UnixNano())
	}
	return hex.EncodeToString(h.Sum(nil))
}
func compilerCachePath(root, key string) (string, error) {
	dir, e := os.UserCacheDir()
	if e != nil {
		return "", e
	}
	rootID := sha256.Sum256([]byte(filepath.Clean(root)))
	dir = filepath.Join(dir, "Sunder", "HLSLWorkbench", "compiled", hex.EncodeToString(rootID[:8]))
	if e = os.MkdirAll(dir, 0700); e != nil {
		return "", e
	}
	return filepath.Join(dir, key+".json"), nil
}
func loadCompilerCache(root, key string) (compilation, bool) {
	path, e := compilerCachePath(root, key)
	if e != nil {
		return compilation{}, false
	}
	stat, e := os.Stat(path)
	if e != nil || stat.Size() > maxOutputBytes+32768 || stat.Size() < 20 {
		return compilation{}, false
	}
	data, e := os.ReadFile(path)
	if e != nil {
		return compilation{}, false
	}
	var cached struct {
		Key      string      `json:"key"`
		Compiled compilation `json:"compiled"`
	}
	if json.Unmarshal(data, &cached) != nil || cached.Key != key || len(cached.Compiled.WGSL) == 0 || len(cached.Compiled.WGSL) > maxOutputBytes {
		return compilation{}, false
	}
	cached.Compiled.CacheHit = true
	cached.Compiled.CompileMs = 0
	cached.Compiled.DxcMs = 0
	cached.Compiled.NagaMs = 0
	return cached.Compiled, true
}
func saveCompilerCache(root, key string, c compilation) {
	path, e := compilerCachePath(root, key)
	if e != nil {
		return
	}
	data, e := json.Marshal(struct {
		Key      string      `json:"key"`
		Compiled compilation `json:"compiled"`
	}{key, c})
	if e != nil {
		return
	}
	temp := path + ".tmp"
	if e = os.WriteFile(temp, data, 0600); e != nil {
		return
	}
	if os.Rename(temp, path) != nil {
		_ = os.Remove(temp)
		return
	}
	// Keep the bounded local compiled cache small; stale entries expire naturally.
	files, e := os.ReadDir(filepath.Dir(path))
	if e != nil {
		return
	}
	if len(files) <= 16 {
		return
	}
	cutoff := time.Now().Add(-14 * 24 * time.Hour)
	for _, file := range files {
		if file.IsDir() {
			continue
		}
		name := filepath.Join(filepath.Dir(path), file.Name())
		if info, e := file.Info(); e == nil && info.ModTime().Before(cutoff) {
			_ = os.Remove(name)
		}
	}
}
