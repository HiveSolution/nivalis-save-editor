// Injects AppStream metadata into the AppImage so AppImage managers
// can show the correct name, icon and version. Tauri's bundler does not
// support metainfo directly, so we repack with appimagetool. The license
// and the release README go in as well (usr/share/doc/nivalis-save-editor).
//
//   node scripts/add-appstream.mjs [path-to.AppImage]
//
// Requires an appimagetool AppImage extracted at tools/appimagetool (see README).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseReadme } from './release-readme.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const bundleDir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'appimage');
const appimage = process.argv[2]
  ?? readdirSync(bundleDir).filter((f) => f.endsWith('.AppImage')).map((f) => join(bundleDir, f)).sort().pop();
if (!appimage) throw new Error('No AppImage found');

const toolsDir = join(root, 'tools');
if (!existsSync(join(toolsDir, 'appimagetool', 'usr', 'bin', 'appimagetool'))) throw new Error('tools/appimagetool not found');
const appimagetool = join(toolsDir, 'appimagetool', 'usr', 'bin', 'appimagetool');

const outDir = join(root, 'release', 'out');
mkdirSync(outDir, { recursive: true });
rmSync(join(outDir, 'squashfs-root'), { recursive: true, force: true });
execFileSync(appimage, ['--appimage-extract'], { cwd: outDir, stdio: 'inherit' });
const appDir = join(outDir, 'squashfs-root');
const metainfoDir = join(appDir, 'usr', 'share', 'metainfo');
mkdirSync(metainfoDir, { recursive: true });
const metainfo = readFileSync(join(root, 'src-tauri', 'com.renokk.nivalis-save-editor.appdata.xml'), 'utf8')
  .replaceAll('{{VERSION}}', version)
  .replaceAll('{{DATE}}', new Date().toISOString().slice(0, 10));
writeFileSync(join(metainfoDir, 'com.renokk.nivalis-save-editor.appdata.xml'), metainfo);
// Ship the license text and copyright notice with every copy (CC BY-NC 4.0 attribution).
const docDir = join(appDir, 'usr', 'share', 'doc', 'nivalis-save-editor');
mkdirSync(docDir, { recursive: true });
copyFileSync(join(root, 'LICENSE.txt'), join(docDir, 'LICENSE.txt'));
writeFileSync(join(docDir, 'README.txt'), releaseReadme(root, version, 'linux'));
// The Tauri-generated desktop file is "Nivalis Save Editor.desktop"; rename it so it
// matches the <launchable> id and AppStream validation accepts the pair.
const appDirRoot = appDir;
const oldDesktop = join(appDirRoot, 'Nivalis Save Editor.desktop');
const newDesktop = join(appDirRoot, 'nivalis-save-editor.desktop');
if (existsSync(oldDesktop)) {
  const desktop = readFileSync(oldDesktop, 'utf8');
  writeFileSync(newDesktop, desktop);
  rmSync(oldDesktop);
  const pixDir = join(appDirRoot, 'usr', 'share', 'applications');
  const oldPix = join(pixDir, 'Nivalis Save Editor.desktop');
  if (existsSync(oldPix)) rmSync(oldPix);
  writeFileSync(join(pixDir, 'nivalis-save-editor.desktop'), desktop);
}
execFileSync(appimagetool, [appDir, appimage], { stdio: 'inherit', env: { ...process.env, ARCH: 'x86_64' } });
rmSync(join(outDir, 'squashfs-root'), { recursive: true, force: true });
console.log('Added AppStream metadata to', appimage);
