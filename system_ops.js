// system_ops.js — Cross-Platform System Control Bridge
// Fully compatible with Linux (Fedora, Ubuntu/Debian, Arch), Windows 10/11, macOS Intel (x64) and Apple Silicon (arm64).

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFile, exec, spawn } from 'node:child_process';

export const PLATFORM = process.platform; // 'darwin', 'win32', 'linux'
export const ARCH = process.arch; // 'arm64', 'x64', etc.

export const IS_MAC = PLATFORM === 'darwin';
export const IS_WIN = PLATFORM === 'win32';
export const IS_LINUX = PLATFORM === 'linux';
export const IS_MAC_SILICON = IS_MAC && ARCH === 'arm64';
export const IS_MAC_INTEL = IS_MAC && ARCH === 'x64';

// Linux Distribution Detection (Fedora, Ubuntu, Debian, Arch, etc.)
export function getLinuxDistro() {
  if (!IS_LINUX) return null;
  try {
    if (fs.existsSync('/etc/os-release')) {
      const content = fs.readFileSync('/etc/os-release', 'utf8');
      const idMatch = content.match(/^ID=(?:")?([a-zA-Z0-9_-]+)(?:")?/m);
      const nameMatch = content.match(/^PRETTY_NAME=(?:")?([^"\n]+)(?:")?/m);
      return {
        id: idMatch ? idMatch[1].toLowerCase() : 'linux',
        prettyName: nameMatch ? nameMatch[1] : 'Linux',
        isFedora: idMatch ? idMatch[1].includes('fedora') : false,
        isUbuntu: idMatch ? idMatch[1].includes('ubuntu') : false,
        isDebian: idMatch ? idMatch[1].includes('debian') : false,
        isArch: idMatch ? idMatch[1].includes('arch') : false
      };
    }
  } catch {}
  return { id: 'linux', prettyName: 'Linux', isFedora: false, isUbuntu: false, isDebian: false, isArch: false };
}

// Helper to execute commands safely
function runCmd(file, args = [], timeout = 8000) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: String(stdout || '').trim(),
        stderr: String(stderr || '').trim(),
        code: err?.code ?? 0
      });
    });
  });
}

function runShell(cmd, timeout = 8000) {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true, timeout }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: String(stdout || '').trim(),
        stderr: String(stderr || '').trim(),
        code: err?.code ?? 0
      });
    });
  });
}

/**
 * 1. System Restart
 * Cross-platform graceful restart.
 */
export async function restartSystem({ simulate = false } = {}) {
  if (simulate) {
    return { ok: true, platform: PLATFORM, arch: ARCH, action: 'restart', simulated: true };
  }

  if (IS_MAC) {
    // Tier 1: AppleScript graceful restart
    const res1 = await runCmd('osascript', ['-e', 'tell application "System Events" to restart']);
    if (res1.ok) return { ok: true, platform: 'darwin', method: 'osascript' };
    // Tier 2: shutdown command fallback
    const res2 = await runShell('sudo shutdown -r now || shutdown -r now');
    return { ok: res2.ok, platform: 'darwin', method: 'shutdown' };
  }

  if (IS_WIN) {
    // Windows restart with 5s delay allowing Siri to deliver spoken confirmation
    const res = await runCmd('shutdown.exe', ['/r', '/t', '5', '/c', 'Restart initiated by Voice Assistant']);
    return { ok: res.ok, platform: 'win32', method: 'shutdown.exe' };
  }

  if (IS_LINUX) {
    // Tier 1: systemd systemctl
    const res1 = await runCmd('systemctl', ['reboot']);
    if (res1.ok) return { ok: true, platform: 'linux', method: 'systemctl' };
    // Tier 2: shutdown command
    const res2 = await runShell('shutdown -r now || reboot');
    return { ok: res2.ok, platform: 'linux', method: 'shutdown' };
  }

  return { ok: false, error: 'Unsupported platform' };
}

/**
 * 2. System Shutdown
 * Cross-platform graceful shutdown.
 */
export async function shutdownSystem({ simulate = false } = {}) {
  if (simulate) {
    return { ok: true, platform: PLATFORM, arch: ARCH, action: 'shutdown', simulated: true };
  }

  if (IS_MAC) {
    // Tier 1: AppleScript graceful shutdown
    const res1 = await runCmd('osascript', ['-e', 'tell application "System Events" to shut down']);
    if (res1.ok) return { ok: true, platform: 'darwin', method: 'osascript' };
    // Tier 2: shutdown command fallback
    const res2 = await runShell('sudo shutdown -h now || shutdown -h now');
    return { ok: res2.ok, platform: 'darwin', method: 'shutdown' };
  }

  if (IS_WIN) {
    // Windows shutdown with 5s delay
    const res = await runCmd('shutdown.exe', ['/s', '/t', '5', '/c', 'Shutdown initiated by Voice Assistant']);
    return { ok: res.ok, platform: 'win32', method: 'shutdown.exe' };
  }

  if (IS_LINUX) {
    // Tier 1: systemd poweroff
    const res1 = await runCmd('systemctl', ['poweroff']);
    if (res1.ok) return { ok: true, platform: 'linux', method: 'systemctl' };
    // Tier 2: shutdown command
    const res2 = await runShell('shutdown -h now || poweroff');
    return { ok: res2.ok, platform: 'linux', method: 'shutdown' };
  }

  return { ok: false, error: 'Unsupported platform' };
}

/**
 * 3. Screenshot Capture
 * Saves to user's Pictures/Siri directory across macOS, Windows, and Linux.
 */
export async function captureScreenshot(outputFile) {
  const dir = outputFile ? path.dirname(outputFile) : path.join(os.homedir(), 'Pictures', 'Siri');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  
  const targetFile = outputFile || path.join(dir, `screenshot-${Date.now()}.png`);

  if (IS_MAC) {
    const res = await runCmd('screencapture', ['-x', targetFile]);
    const ok = res.ok && fs.existsSync(targetFile);
    return { ok, file: targetFile, platform: 'darwin' };
  }

  if (IS_WIN) {
    // PowerShell .NET GDI screenshot
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms,System.Drawing;
      $b = [System.Windows.Forms.SystemInformation]::VirtualScreen;
      $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height;
      $g = [System.Drawing.Graphics]::FromImage($bmp);
      $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size);
      $bmp.Save($env:SS_PATH);
    `;
    const res = await new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript], {
        windowsHide: true,
        timeout: 10000,
        env: { ...process.env, SS_PATH: targetFile }
      }, (err) => resolve(!err));
    });
    const ok = res && fs.existsSync(targetFile);
    return { ok, file: targetFile, platform: 'win32' };
  }

  if (IS_LINUX) {
    // Tier 1: gnome-screenshot (Standard GNOME on Fedora/Ubuntu)
    let res = await runCmd('gnome-screenshot', ['-f', targetFile]);
    if (res.ok && fs.existsSync(targetFile)) return { ok: true, file: targetFile, platform: 'linux', method: 'gnome-screenshot' };

    // Tier 2: scrot (X11 / Debian / Lightweight)
    res = await runCmd('scrot', [targetFile]);
    if (res.ok && fs.existsSync(targetFile)) return { ok: true, file: targetFile, platform: 'linux', method: 'scrot' };

    // Tier 3: grim (Wayland / Fedora / Sway)
    res = await runCmd('grim', [targetFile]);
    if (res.ok && fs.existsSync(targetFile)) return { ok: true, file: targetFile, platform: 'linux', method: 'grim' };

    // Tier 4: ImageMagick import
    res = await runCmd('import', ['-window', 'root', targetFile]);
    if (res.ok && fs.existsSync(targetFile)) return { ok: true, file: targetFile, platform: 'linux', method: 'import' };

    return { ok: false, file: targetFile, platform: 'linux', error: 'No screenshot utility found (tried gnome-screenshot, scrot, grim, import)' };
  }

  return { ok: false, error: 'Unsupported platform' };
}

/**
 * 4. Lock Workstation Screen
 */
export async function lockScreen() {
  if (IS_MAC) {
    const res = await runCmd('pmset', ['displaysleepnow']);
    return { ok: res.ok, platform: 'darwin' };
  }

  if (IS_WIN) {
    const res = await runCmd('rundll32.exe', ['user32.dll,LockWorkStation']);
    return { ok: res.ok, platform: 'win32' };
  }

  if (IS_LINUX) {
    // Tier 1: loginctl
    let res = await runCmd('loginctl', ['lock-session']);
    if (res.ok) return { ok: true, platform: 'linux', method: 'loginctl' };

    // Tier 2: gnome-screensaver
    res = await runCmd('gnome-screensaver-command', ['-l']);
    if (res.ok) return { ok: true, platform: 'linux', method: 'gnome-screensaver' };

    // Tier 3: xdg-screensaver
    res = await runCmd('xdg-screensaver', ['lock']);
    return { ok: res.ok, platform: 'linux', method: 'xdg-screensaver' };
  }

  return { ok: false, error: 'Unsupported platform' };
}

/**
 * 5. Text-To-Speech Output
 */
export async function speakText(text, voice = '') {
  if (!text) return false;

  if (IS_MAC) {
    const args = voice ? ['-v', voice, text] : [text];
    const res = await runCmd('say', args);
    return res.ok;
  }

  if (IS_WIN) {
    const psScript = `
      Add-Type -AssemblyName System.Speech;
      $s = New-Object System.Speech.Synthesis.SpeechSynthesizer;
      $s.Rate = 0;
      $s.Speak($env:SPEAK_TEXT);
    `;
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript], {
        windowsHide: true,
        timeout: 12000,
        env: { ...process.env, SPEAK_TEXT: text }
      }, (err) => resolve(!err));
    });
  }

  if (IS_LINUX) {
    // Try spd-say, then espeak-ng, then festival
    let res = await runCmd('spd-say', [text]);
    if (res.ok) return true;
    res = await runCmd('espeak-ng', [text]);
    if (res.ok) return true;
    res = await runCmd('espeak', [text]);
    return res.ok;
  }

  return false;
}

/**
 * 6. Detailed System Hardware Telemetry
 */
export function getSystemTelemetry() {
  const cpus = os.cpus() || [];
  const totalMem = Math.round(os.totalmem() / (1024 * 1024 * 1024));
  const freeMem = Math.round(os.freemem() / (1024 * 1024 * 1024));
  const uptimeHours = (os.uptime() / 3600).toFixed(1);

  return {
    platform: PLATFORM,
    arch: ARCH,
    isSilicon: IS_MAC_SILICON,
    isIntel: IS_MAC_INTEL,
    distro: getLinuxDistro(),
    cpuModel: cpus[0]?.model || 'Unknown CPU',
    cpuCores: cpus.length,
    totalMemoryGB: totalMem,
    freeMemoryGB: freeMem,
    uptimeHours,
    hostname: os.hostname()
  };
}
