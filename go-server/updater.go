package main

// Delta update protocol: a release publishes a small SHA-256 manifest plus
// independently downloadable assets. The full ZIP is only for first installs.
// A copied helper executable installs staged files after the server stops.
import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

var appVersion = "v2.1.0" // Overridden by -ldflags at release build time.
const latestManifestURL = "https://github.com/Cryosimorgh/HLSL-Docs/releases/latest/download/sunder-update-manifest.json"
const releaseBaseURL = "https://github.com/Cryosimorgh/HLSL-Docs/releases/download/"
const maxManifestBytes = 2 << 20
const maxUpdateFileBytes int64 = 128 << 20

var versionRe = regexp.MustCompile(`^v(\d+)\.(\d+)\.(\d+)$`)
var assetRe = regexp.MustCompile(`^delta-[0-9a-f]{16}\.bin$`)
var shaRe = regexp.MustCompile(`^[0-9a-f]{64}$`)

type updateFile struct {
	Path   string `json:"path"`
	Asset  string `json:"asset"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}
type updateManifest struct {
	Version string       `json:"version"`
	Files   []updateFile `json:"files"`
}
type updatePlan struct {
	Available     bool         `json:"available"`
	Current       string       `json:"current"`
	Version       string       `json:"version"`
	Changed       []updateFile `json:"changed"`
	DownloadBytes int64        `json:"downloadBytes"`
	Ready         bool         `json:"ready"`
	Message       string       `json:"message,omitempty"`
}
type updateState struct {
	mu      sync.Mutex
	staged  string
	version string
	pending []updateFile
}

func versionNewer(remote, current string) bool {
	a, b := versionRe.FindStringSubmatch(remote), versionRe.FindStringSubmatch(current)
	if a == nil || b == nil {
		return false
	}
	for i := 1; i <= 3; i++ {
		x, _ := strconv.Atoi(a[i])
		y, _ := strconv.Atoi(b[i])
		if x > y {
			return true
		}
		if x < y {
			return false
		}
	}
	return false
}
func validUpdatePath(path string) bool {
	if path == "HLSLWorkbench.exe" || path == "Start-HLSL-Workbench.cmd" || path == "Stop-HLSL-Workbench.cmd" || path == "Install-File-Association.cmd" || path == "Uninstall-File-Association.cmd" || path == "README-GO-RELEASE.md" {
		return true
	}
	if strings.Contains(path, "\\") || strings.Contains(path, "..") || strings.HasPrefix(path, "/") || strings.Contains(path, ":") || len(path) > 180 {
		return false
	}
	if strings.HasPrefix(path, "playground/") {
		if strings.HasPrefix(path, "playground/vendor/codemirror/") {
			base := strings.TrimPrefix(path, "playground/vendor/codemirror/")
			switch base {
			case "LICENSE", "codemirror.js", "codemirror.css", "clike.js", "foldcode.js", "foldgutter.js", "foldgutter.css", "show-hint.js", "show-hint.css":
				return true
			}
			return false
		}
		name := strings.TrimPrefix(path, "playground/")
		if strings.Contains(name, "/") || name == "" {
			return false
		}
		for _, ext := range []string{".js", ".css", ".html", ".hlsl", ".svg", ".ico"} {
			if strings.HasSuffix(name, ext) {
				return true
			}
		}
	}
	if strings.HasPrefix(path, "tools/dxc/") {
		switch strings.TrimPrefix(path, "tools/dxc/") {
		case "dxc.exe", "dxcompiler.dll", "dxil.dll":
			return true
		}
	}
	return path == "tools/naga/naga.exe"
}
func validateManifest(m updateManifest) error {
	if !versionRe.MatchString(m.Version) || len(m.Files) == 0 || len(m.Files) > 100 {
		return errors.New("invalid release version or file count")
	}
	seen := make(map[string]bool)
	for _, f := range m.Files {
		if !validUpdatePath(f.Path) || !assetRe.MatchString(f.Asset) || !shaRe.MatchString(f.SHA256) || f.Size < 1 || f.Size > maxUpdateFileBytes || seen[f.Path] {
			return fmt.Errorf("unsafe or duplicate update entry: %q", f.Path)
		}
		seen[f.Path] = true
	}
	return nil
}
func updateHTTPClient() *http.Client {
	return &http.Client{Timeout: 3 * time.Minute, CheckRedirect: func(r *http.Request, via []*http.Request) error {
		if len(via) > 5 || r.URL.Scheme != "https" {
			return errors.New("unsafe update redirect")
		}
		// GitHub serves release assets via objects.githubusercontent.com and release-assets.githubusercontent.com.
		host := strings.ToLower(r.URL.Hostname())
		if host != "github.com" && !strings.HasSuffix(host, ".githubusercontent.com") {
			return errors.New("unexpected update host")
		}
		return nil
	}}
}
func fetchManifest(ctx context.Context) (updateManifest, error) {
	var m updateManifest
	req, e := http.NewRequestWithContext(ctx, "GET", latestManifestURL, nil)
	if e != nil {
		return m, e
	}
	response, e := updateHTTPClient().Do(req)
	if e != nil {
		return m, e
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return m, fmt.Errorf("update manifest HTTP %d", response.StatusCode)
	}
	data, e := io.ReadAll(io.LimitReader(response.Body, maxManifestBytes+1))
	if e != nil {
		return m, e
	}
	if len(data) > maxManifestBytes {
		return m, errors.New("update manifest too large")
	}
	if e = json.Unmarshal(data, &m); e != nil {
		return m, e
	}
	return m, validateManifest(m)
}
func fileHash(path string) (string, error) {
	f, e := os.Open(path)
	if e != nil {
		return "", e
	}
	defer f.Close()
	h := sha256.New()
	_, e = io.Copy(h, f)
	if e != nil {
		return "", e
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
func compareManifest(root string, m updateManifest) (updatePlan, error) {
	if e := validateManifest(m); e != nil {
		return updatePlan{}, e
	}
	result := updatePlan{Current: appVersion, Version: m.Version, Changed: []updateFile{}}
	if !versionNewer(m.Version, appVersion) {
		result.Message = "Already at the latest available version"
		return result, nil
	}
	result.Available = true
	for _, f := range m.Files {
		target := filepath.Join(root, filepath.FromSlash(f.Path))
		hash, e := fileHash(target)
		if e == nil && hash == f.SHA256 {
			continue
		}
		if e != nil && !os.IsNotExist(e) {
			return updatePlan{}, e
		}
		result.Changed = append(result.Changed, f)
		result.DownloadBytes += f.Size
	}
	if len(result.Changed) == 0 {
		result.Message = "All release files already match"
	}
	return result, nil
}
func updateStageDir() (string, error) {
	root, e := os.UserCacheDir()
	if e != nil {
		return "", e
	}
	root = filepath.Join(root, "Sunder", "HLSLWorkbench", "updates")
	if e = os.MkdirAll(root, 0700); e != nil {
		return "", e
	}
	return os.MkdirTemp(root, "staged-")
}
func downloadChanges(ctx context.Context, m updateManifest, plan updatePlan) (string, error) {
	stage, e := updateStageDir()
	if e != nil {
		return "", e
	}
	cleanup := true
	defer func() {
		if cleanup {
			os.RemoveAll(stage)
		}
	}()
	for _, f := range plan.Changed {
		url := releaseBaseURL + m.Version + "/" + f.Asset
		req, e := http.NewRequestWithContext(ctx, "GET", url, nil)
		if e != nil {
			return "", e
		}
		res, e := updateHTTPClient().Do(req)
		if e != nil {
			return "", e
		}
		if res.StatusCode != 200 {
			res.Body.Close()
			return "", fmt.Errorf("asset %s: HTTP %d", f.Asset, res.StatusCode)
		}
		out, e := os.OpenFile(filepath.Join(stage, f.Asset), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			res.Body.Close()
			return "", e
		}
		hasher := sha256.New()
		n, e := io.Copy(io.MultiWriter(out, hasher), io.LimitReader(res.Body, f.Size+1))
		closeErr := out.Close()
		res.Body.Close()
		if e != nil {
			return "", e
		}
		if closeErr != nil {
			return "", closeErr
		}
		if n != f.Size || hex.EncodeToString(hasher.Sum(nil)) != f.SHA256 {
			return "", fmt.Errorf("checksum/size mismatch: %s", f.Path)
		}
	}
	pending := updateManifest{Version: m.Version, Files: plan.Changed}
	data, e := json.Marshal(pending)
	if e != nil {
		return "", e
	}
	if e = os.WriteFile(filepath.Join(stage, "pending.json"), data, 0600); e != nil {
		return "", e
	}
	cleanup = false
	return stage, nil
}
func safeManagedTarget(root, rel string) (string, error) {
	if !validUpdatePath(rel) {
		return "", errors.New("unsafe update path")
	}
	target := filepath.Join(root, filepath.FromSlash(rel))
	// Reject symlinked parent directories or target files before touching them.
	for p := filepath.Dir(target); ; p = filepath.Dir(p) {
		info, e := os.Lstat(p)
		if e == nil && info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("symlink update parent: %s", p)
		}
		if p == root || p == filepath.Dir(p) {
			break
		}
	}
	if info, e := os.Lstat(target); e == nil && info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("refusing to update symlink")
	}
	return target, nil
}
func applyStaged(root, stage string) error {
	data, e := os.ReadFile(filepath.Join(stage, "pending.json"))
	if e != nil {
		return e
	}
	var m updateManifest
	if e = json.Unmarshal(data, &m); e != nil {
		return e
	}
	if e = validateManifest(m); e != nil {
		return e
	}
	// Verify EVERY source and target before any replacement.
	for _, f := range m.Files {
		if _, e = safeManagedTarget(root, f.Path); e != nil {
			return e
		}
		info, e := os.Stat(filepath.Join(stage, f.Asset))
		if e != nil || info.Size() != f.Size {
			return fmt.Errorf("missing staged update: %s", f.Path)
		}
		hash, e := fileHash(filepath.Join(stage, f.Asset))
		if e != nil || hash != f.SHA256 {
			return fmt.Errorf("invalid staged SHA-256: %s", f.Path)
		}
	}
	type saved struct {
		target, backup string
		hadOriginal    bool
	}
	completed := []saved{}
	rollback := func() {
		for i := len(completed) - 1; i >= 0; i-- {
			f := completed[i]
			_ = os.Remove(f.target)
			if f.hadOriginal {
				_ = os.Rename(f.backup, f.target)
			}
		}
	}
	for _, f := range m.Files {
		target, _ := safeManagedTarget(root, f.Path)
		if e = os.MkdirAll(filepath.Dir(target), 0755); e != nil {
			rollback()
			return e
		}
		next := target + ".sunder-update-next"
		backup := target + ".sunder-update-old"
		if _, e = os.Stat(next); e == nil {
			rollback()
			return fmt.Errorf("stale update temp file: %s", next)
		}
		if _, e = os.Stat(backup); e == nil {
			rollback()
			return fmt.Errorf("stale update backup file: %s", backup)
		}
		src, e := os.Open(filepath.Join(stage, f.Asset))
		if e != nil {
			rollback()
			return e
		}
		dst, e := os.OpenFile(next, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0755)
		if e != nil {
			src.Close()
			rollback()
			return e
		}
		_, e = io.Copy(dst, src)
		src.Close()
		if se := dst.Sync(); e == nil {
			e = se
		}
		if ce := dst.Close(); e == nil {
			e = ce
		}
		if e != nil {
			os.Remove(next)
			rollback()
			return e
		}
		hadOriginal := false
		if _, e = os.Stat(target); e == nil {
			hadOriginal = true
			if e = os.Rename(target, backup); e != nil {
				os.Remove(next)
				rollback()
				return e
			}
		}
		completed = append(completed, saved{target, backup, hadOriginal})
		if e = os.Rename(next, target); e != nil {
			os.Remove(next)
			rollback()
			return e
		}
	}
	for _, f := range completed {
		if f.hadOriginal {
			_ = os.Remove(f.backup)
		}
	}
	return nil
}
func runUpdateHelper(stage, target string, pid int) error {
	// A separate copy of the EXE survives replacement of the installed EXE.
	original := filepath.Join(target, "HLSLWorkbench.exe")
	helper := filepath.Join(stage, "sunder-updater-helper.exe")
	src, e := os.Open(original)
	if e != nil {
		return e
	}
	defer src.Close()
	dst, e := os.OpenFile(helper, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0700)
	if e != nil {
		return e
	}
	_, e = io.Copy(dst, src)
	if se := dst.Sync(); e == nil {
		e = se
	}
	if ce := dst.Close(); e == nil {
		e = ce
	}
	if e != nil {
		return e
	}
	cmd := exec.Command(helper, "--apply-update", stage, "--target", target, "--parent-pid", strconv.Itoa(pid))
	cmd.Dir = target
	if e = cmd.Start(); e != nil {
		return e
	}
	return cmd.Process.Release()
}
func applyUpdateHelper(stage, target string, pid int) error {
	if !filepath.IsAbs(stage) || !filepath.IsAbs(target) || pid < 1 {
		return errors.New("invalid staged update arguments")
	}
	// Wait for the old server process to exit, not merely for its TCP port to close.
	if err := waitForProcessExit(pid, 25*time.Second); err != nil {
		return err
	}
	original := filepath.Join(target, "HLSLWorkbench.exe")
	for attempt := 0; attempt < 100; attempt++ {
		if attempt > 0 {
			time.Sleep(250 * time.Millisecond)
		}
		// A short retry strategy accommodates Windows executable sharing locks.
		// Real applyStaged performs the actual rename and will return errors if still locked.
		if e := applyStaged(target, stage); e == nil {
			_ = os.RemoveAll(stage)
			cmd := exec.Command(original)
			cmd.Dir = target
			return cmd.Start()
		} else if attempt >= 99 {
			return e
		}
	}
	return errors.New("update timed out")
}
func (a *application) updateRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/update/check", a.secure(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			jsonError(w, 405, "Method not allowed")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 40*time.Second)
		defer cancel()
		m, e := fetchManifest(ctx)
		if e != nil {
			jsonError(w, 502, e.Error())
			return
		}
		plan, e := compareManifest(a.root, m)
		if e != nil {
			jsonError(w, 500, e.Error())
			return
		}
		a.updates.mu.Lock()
		plan.Ready = a.updates.staged != "" && a.updates.version == m.Version
		a.updates.mu.Unlock()
		jsonReply(w, 200, plan)
	}))
	mux.HandleFunc("/api/update/download", a.secure(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			jsonError(w, 405, "Method not allowed")
			return
		}
		a.updates.mu.Lock()
		defer a.updates.mu.Unlock()
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
		defer cancel()
		m, e := fetchManifest(ctx)
		if e != nil {
			jsonError(w, 502, e.Error())
			return
		}
		plan, e := compareManifest(a.root, m)
		if e != nil {
			jsonError(w, 500, e.Error())
			return
		}
		if !plan.Available {
			jsonReply(w, 200, plan)
			return
		}
		if a.updates.staged != "" {
			os.RemoveAll(a.updates.staged)
			a.updates.staged = ""
		}
		stage, e := downloadChanges(ctx, m, plan)
		if e != nil {
			jsonError(w, 502, e.Error())
			return
		}
		a.updates.staged = stage
		a.updates.version = m.Version
		a.updates.pending = plan.Changed
		plan.Ready = true
		jsonReply(w, 200, plan)
	}))
	mux.HandleFunc("/api/update/install", a.secure(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			jsonError(w, 405, "Method not allowed")
			return
		}
		a.updates.mu.Lock()
		defer a.updates.mu.Unlock()
		stage := a.updates.staged
		if stage == "" {
			jsonError(w, 409, "Download changes before installing")
			return
		}
		if e := runUpdateHelper(stage, a.root, os.Getpid()); e != nil {
			jsonError(w, 500, e.Error())
			return
		}
		a.updates.staged = ""
		jsonReply(w, 200, map[string]any{"installing": true, "message": "Server will restart after applying verified changes"})
		go func() {
			time.Sleep(250 * time.Millisecond)
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_ = a.server.Shutdown(ctx)
		}()
	}))
}
