// Builds a distributable: tests -> release build -> Windows: portable zip; Linux: AppImage with AppStream metadata.
import { execSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, statSync, chmodSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseReadme } from './release-readme.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tauriConf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(join(root, 'src-tauri', 'Cargo.toml'), 'utf8'))[1];
if (tauriConf.version !== version || cargoVersion !== version) {
  throw new Error(`Version mismatch: package.json ${version}, tauri.conf.json ${tauriConf.version}, Cargo.toml ${cargoVersion}`);
}

const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
run('npm test');

let artifact;
if (process.platform === 'win32') {
  run('npx tauri build --no-bundle');
  const name = `NivalisSaveEditor-v${version}`;
  const outDir = join(root, 'release', 'out');
  const stage = join(outDir, name);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  copyFileSync(join(root, 'src-tauri', 'target', 'release', 'nivalis-save-editor.exe'), join(stage, 'NivalisSaveEditor.exe'));
  writeFileSync(join(stage, 'README.txt'), releaseReadme(root, version));
  // Ship the license text and copyright notice with every copy (CC BY-NC 4.0 attribution).
  writeFileSync(join(stage, 'LICENSE.txt'), readFileSync(join(root, 'LICENSE.txt'), 'utf8').replace(/\r?\n/g, '\r\n'));

  artifact = join(outDir, `${name}.zip`);
  rmSync(artifact, { force: true });
  // Windows' bundled bsdtar writes zip archives with -a; Git Bash's GNU tar cannot.
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-a', '-c', '-f', artifact, '-C', outDir, name], { stdio: 'inherit' });
} else {
  run('npx tauri build');
  // Add AppStream metadata (name/icon/version), the license and the README to the AppImage.
  run('node scripts/add-appstream.mjs');
  const bundleDir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'appimage');
  const built = readdirSync(bundleDir).filter((f) => f.endsWith('.AppImage')).map((f) => join(bundleDir, f)).sort().pop();
  if (!built) throw new Error('AppImage not found');
  const outDir = join(root, 'release', 'out');
  mkdirSync(outDir, { recursive: true });
  artifact = join(outDir, `NivalisSaveEditor-${version}-x86_64.AppImage`);
  copyFileSync(built, artifact);
  chmodSync(artifact, 0o755);
}

const sha256 = createHash('sha256').update(readFileSync(artifact)).digest('hex');
console.log(`\nRelease ready: ${artifact}`);
console.log(`Size:   ${(statSync(artifact).size / 1024 / 1024).toFixed(2)} MB`);
console.log(`SHA256: ${sha256}`);
