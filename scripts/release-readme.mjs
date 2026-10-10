// Fills release/README.txt for one platform; shared by release.mjs (Windows zip) and
// add-appstream.mjs (docs inside the Linux AppImage).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PLATFORMS = {
  win32: {
    BINARY: 'NivalisSaveEditor.exe',
    SAVES_DIR: '%USERPROFILE%\\AppData\\LocalLow\\ION LANDS\\Nivalis Nights',
    BACKUP_DIR: '%LOCALAPPDATA%\\Nivalis Save Editor\\Backups',
    REQUIREMENTS: 'Windows 10 or 11 with the Microsoft Edge WebView2 Runtime (included in\nWindows 11 and most up-to-date Windows 10 PCs). Windows 10 LTSC and IoT\neditions don\'t include it. If the editor says "Could not find the WebView2\nRuntime" or the window stays blank, install the "Evergreen Standalone\nInstaller (x64)" from https://developer.microsoft.com/microsoft-edge/webview2/\nThe Edge browser alone is not enough.',
    PLATFORM_NOTE: 'WINDOWS SMARTSCREEN\nThe exe is not code-signed, so Windows may show "Windows protected your PC".\nClick "More info" -> "Run anyway".',
    eol: '\r\n',
  },
  linux: {
    BINARY: 'the AppImage (make it executable first: chmod +x NivalisSaveEditor-*.AppImage)',
    SAVES_DIR: '<Steam library>/steamapps/compatdata/1488490/pfx/drive_c/users/steamuser/\n  AppData/LocalLow/ION LANDS/Nivalis Nights',
    BACKUP_DIR: '~/.local/share/nivalis-save-editor/backups',
    REQUIREMENTS: '64-bit Linux with Nivalis Nights installed through Steam (Proton).',
    PLATFORM_NOTE: 'WAYLAND\nThe editor runs through XWayland by default, because its web view crashes on\nsome Wayland compositors. Set GDK_BACKEND=wayland to use Wayland anyway.',
    eol: '\n',
  },
};

export function releaseReadme(root, version, platform = process.platform) {
  const { eol, ...fields } = PLATFORMS[platform] ?? PLATFORMS.linux;
  let text = readFileSync(join(root, 'release', 'README.txt'), 'utf8').replaceAll('{{VERSION}}', version);
  for (const [key, value] of Object.entries(fields)) text = text.replaceAll(`{{${key}}}`, value);
  const left = /\{\{[A-Z_]+\}\}/.exec(text);
  if (left) throw new Error(`release/README.txt has an unknown placeholder ${left[0]}`);
  return text.replace(/\r?\n/g, eol);
}
