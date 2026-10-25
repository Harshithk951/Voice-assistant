import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export function launchDesktopCapsule(port = 3710) {
  const url = `http://localhost:${port}/capsule`;
  const platform = process.platform;

  if (platform === 'darwin') {
    // macOS: Launch dedicated borderless app window via Chrome/Brave/Edge or open command
    const browsers = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    ];

    const binary = browsers.find(b => fs.existsSync(b));
    if (binary) {
      const args = [
        `--app=${url}`,
        '--window-size=410,50',
        '--window-position=515,8',
        '--user-data-dir=/tmp/siri_capsule_profile'
      ];
      try {
        const child = spawn(binary, args, { detached: true, stdio: 'ignore' });
        child.unref();
        return { ok: true, platform: 'darwin', method: 'app_window' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    // Fallback: system open
    try {
      const child = spawn('/usr/bin/open', ['-na', 'Safari', url], { detached: true, stdio: 'ignore' });
      child.unref();
      return { ok: true, platform: 'darwin', method: 'safari_open' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  } else if (platform === 'win32') {
    // Windows: Launch borderless app window via Chrome/Edge or PowerShell
    const winBrowsers = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    const binary = winBrowsers.find(b => fs.existsSync(b));
    if (binary) {
      const args = [
        `--app=${url}`,
        '--window-size=410,50',
        '--window-position=515,8',
        '--user-data-dir=%TEMP%\\siri_capsule_profile'
      ];
      try {
        const child = spawn(binary, args, { detached: true, stdio: 'ignore' });
        child.unref();
        return { ok: true, platform: 'win32', method: 'app_window' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
    // Windows fallback: start URL
    try {
      const child = spawn('cmd.exe', ['/c', 'start', url], { detached: true, stdio: 'ignore' });
      child.unref();
      return { ok: true, platform: 'win32', method: 'cmd_start' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  return { ok: false, error: `Platform ${platform} not supported for native capsule window` };
}

// Allow CLI execution: `node desktop_capsule.js`
if (process.argv[1] && process.argv[1].endsWith('desktop_capsule.js')) {
  const result = launchDesktopCapsule();
  console.log('Desktop Capsule Launch Result:', result);
}
