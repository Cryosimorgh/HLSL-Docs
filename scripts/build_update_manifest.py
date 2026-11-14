#!/usr/bin/env python3
"""Build verified independent update assets from the portable Windows release tree.

The first install uses the complete ZIP. Subsequent updates download only changed
files listed by this manifest; user shader files outside the managed app tree
are never included. Stdlib only, runs on Windows GitHub Actions.
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

VERSION = __import__('re').compile(r'^v\d+\.\d+\.\d+$')
ROOT_FILES = {'HLSLWorkbench.exe', 'Start-HLSL-Workbench.cmd',
              'Stop-HLSL-Workbench.cmd', 'Install-File-Association.cmd',
              'Uninstall-File-Association.cmd', 'README-GO-RELEASE.md'}
VENDOR_FILES = {'LICENSE', 'codemirror.js', 'codemirror.css', 'clike.js',
                'foldcode.js', 'foldgutter.js', 'foldgutter.css',
                'show-hint.js', 'show-hint.css'}
TOOL_FILES = {'tools/dxc/dxc.exe', 'tools/dxc/dxcompiler.dll',
              'tools/dxc/dxil.dll', 'tools/naga/naga.exe'}


def managed(path):
    if path in ROOT_FILES or path in TOOL_FILES:
        return True
    if path.startswith('playground/vendor/codemirror/'):
        return path.split('/')[-1] in VENDOR_FILES
    if path.startswith('playground/') and path.count('/') == 1:
        return Path(path).suffix.lower() in {'.js', '.css', '.html', '.hlsl', '.svg', '.ico'}
    return False


def write_manifest(stage: Path, version: str, output: Path):
    if not VERSION.fullmatch(version):
        raise ValueError('Version must be vMAJOR.MINOR.PATCH')
    output.mkdir(parents=True, exist_ok=True)
    files = []
    for path in sorted(stage.rglob('*')):
        if not path.is_file() or path.is_symlink():
            continue
        rel = path.relative_to(stage).as_posix()
        if not managed(rel):
            continue
        length = path.stat().st_size
        if length < 1 or length > 128 * 1024 * 1024:
            raise ValueError(f'Unexpected file size: {rel}')
        name = 'delta-' + hashlib.sha256(rel.encode()).hexdigest()[:16] + '.bin'
        data = path.read_bytes()
        shutil.copy2(path, output / name)
        files.append({'path': rel, 'asset': name,
                      'sha256': hashlib.sha256(data).hexdigest(), 'size': length})
    if not files or not any(f['path'] == 'HLSLWorkbench.exe' for f in files):
        raise ValueError('Release is missing the Windows executable')
    dest = output / 'sunder-update-manifest.json'
    dest.write_text(json.dumps({'version': version, 'files': files},
                               indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'{version}: {len(files)} individually hashed app assets -> {dest}')
    return dest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('stage', type=Path)
    parser.add_argument('version')
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    write_manifest(args.stage, args.version, args.output)
