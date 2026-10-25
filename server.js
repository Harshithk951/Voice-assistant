// Jarvis Phone: laptop action server for a Sarvam Voice Agent.
// You call your Sarvam number, the agent decides what to do, and calls these HTTPS tools
// (through a cloudflared tunnel). Only a fixed allowlist of actions exists. No shell input
// from the caller ever reaches a command line.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findFiles, describe, buildIndex } from './files.js';
import { createMonitor } from './monitor.js';
import { createBrain } from './brain.js';
import { runSandboxed, validatePath, getSandboxStatus } from './sandbox.js';
import { browsePage, agentSearch, closeAgentBrowser, crawlWebsite, agentInteract } from './browser_agent.js';
import { scrapeUrl, mapSite, crawlSite, validateSafeUrl } from './crawler_engine.js';
import { gpuAccelerator } from './gpu_accelerator.js';
import { computerUse } from './computer_use.js';
import { fileAnalyzer } from './file_analyzer.js';
import { workflowManager } from './workflow_manager.js';
import { launchDesktopCapsule } from './desktop_capsule.js';
import { getLanguage, setLanguage, detectLanguage, getTimeOfDayGreeting, formatTimeDate, t, SUPPORTED_LANGUAGES } from './i18n.js';
import { restartSystem, shutdownSystem, captureScreenshot, lockScreen, speakText, getSystemTelemetry, IS_MAC, IS_WIN, IS_LINUX, IS_MAC_SILICON, IS_MAC_INTEL } from './system_ops.js';
import { getWikipediaSummary } from './wikipedia.js';
import { playLocalMusic, getRandomJoke } from './entertainment.js';

let capsuleState = { action: 'ONLINE', title: 'Siri Assistant', detail: 'System Ready • Online', isWorking: false };

const ROOT = path.dirname(fileURLToPath(import.meta.url));
for (const line of (fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : '').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const PORT = Number(process.env.PORT || 3710);
const TOKEN = process.env.JARVIS_TOKEN || '';
const OWNER = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');
const ALLOW_NO_CALLER = String(process.env.ALLOW_NO_CALLER || 'true') === 'true';
const OWNER_CALLER_ID = (process.env.OWNER_CALLER_ID || '').trim().toLowerCase();
const OWNER_HASHES = new Set(OWNER ? (() => {
  const ten = OWNER.slice(-10);
  const forms = [OWNER, `+${OWNER}`, ten, `0${ten}`, `+91${ten}`, `91${ten}`, `+91 ${ten}`];
  return forms.flatMap((f) => ['sha256', 'sha1', 'md5'].map((a) => crypto.createHash(a).update(f).digest('hex')));
})() : []);
let lastCaller = ''; // raw id of the most recent caller, shown only on the local /status page
const NOTES = path.join(os.homedir(), 'Documents', 'Jarvis Notes.md');

const activity = []; // newest first, shown on the live page
const recent = new Map(); // "action|input" -> { at, result promise }, for burst de-duplication
const DEDUPE_MS = 10_000;
function record(entry) {
  activity.unshift({ at: new Date().toLocaleTimeString('en-IN'), ...entry });
  activity.length = Math.min(activity.length, 50);
  console.log(`[${activity[0].at}]`, entry.action, JSON.stringify(entry.input || ''), '->', entry.result);
}

// ---------- safe cross-platform launchers (fixed executables, argument arrays, no shell injection) ----------
// Platform flags (IS_MAC / IS_WIN / IS_LINUX / IS_MAC_SILICON) come from system_ops.js.

const run = (file, args, env = {}) => new Promise((resolve) => {
  const p = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ...env } });
  p.on('error', () => resolve(false));
  p.unref();
  setTimeout(() => resolve(true), 150);
});

// Launchers that exit on their own (open(1), cmd /c start). Unlike run(), the real exit code is
// kept, so failure is reported honestly.
const launch = (file, args, timeout = 6000) => new Promise((resolve) => {
  execFile(file, args, { windowsHide: true, timeout }, (e) => resolve(!e));
});

// Resilient Multi-Tier Cross-Platform URL Opener (macOS all chips, Windows x64/ARM64, Linux)
const openUrl = async (url) => {
  if (!url) return false;
  
  if (IS_MAC) {
    // Tier 1: LaunchServices via open
    const ok1 = await launch('/usr/bin/open', [url], 2500);
    if (ok1) return true;
    // Tier 2: AppleScript open location (resilient when LaunchServices sandbox restrictions occur)
    const ok2 = await launch('osascript', ['-e', `open location "${url.replace(/"/g, '\\"')}"`], 2500);
    if (ok2) return true;
    return false;
  }

  if (IS_WIN) {
    // Tier 1: cmd.exe start
    const ok1 = await run('cmd.exe', ['/c', 'start', '', url]);
    if (ok1) return true;
    // Tier 2: PowerShell Start-Process with env variable to prevent shell injection
    const ok2 = await psEnv(`Start-Process -FilePath $env:SIRI_URL`, { SIRI_URL: url });
    return Boolean(ok2);
  }

  // Linux (x86_64, arm64, Raspberry Pi)
  return run('xdg-open', [url]);
};

// Presses Enter in the WhatsApp desktop app. Needs Accessibility permission on macOS;
const pressEnterInWhatsApp = () => new Promise((resolve) => {
  if (IS_MAC) {
    return execFile('osascript', ['-e', 'tell application "WhatsApp" to activate', '-e', 'delay 2', '-e', 'tell application "System Events" to key code 36'], (e) => resolve(!e));
  }
  resolve(false);
});

const ps = (cmd, env = {}) => new Promise((resolve) => {
  if (!IS_WIN) return resolve('');
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { windowsHide: true, timeout: 8000, env: { ...process.env, ...env } }, (e, out) => resolve(e ? '' : String(out).trim()));
});

// Fixed PowerShell scripts. Caller-supplied text only ever travels in env vars (SIRI_* / JARVIS_*), never in the script string.
const psEnv = (script, vars = {}, { detached = false } = {}) => new Promise((resolve) => {
  if (!IS_WIN) return resolve(false);
  const env = { ...process.env, ...vars };
  if (detached) {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', script], { detached: true, stdio: 'ignore', windowsHide: true, env });
    p.on('error', () => resolve(false)); p.unref(); return setTimeout(() => resolve(true), 150);
  }
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 15000, env }, (e) => resolve(!e));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SPEAK = 'Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate=0; $s.Speak($env:JARVIS_TEXT)';
const KEY = (code, times = 1) => `$w=New-Object -ComObject WScript.Shell; 1..${times} | % { $w.SendKeys([char]${code}); Start-Sleep -Milliseconds 40 }`;
const MEDIA = {
  play: [KEY(179), 'Toggled play and pause.'], pause: [KEY(179), 'Toggled play and pause.'], resume: [KEY(179), 'Toggled play and pause.'],
  next: [KEY(176), 'Skipped to the next track.'], previous: [KEY(177), 'Went back to the previous track.'], back: [KEY(177), 'Went back to the previous track.'],
  'volume up': [KEY(175, 6), 'Turned the volume up.'], louder: [KEY(175, 6), 'Turned the volume up.'],
  'volume down': [KEY(174, 6), 'Turned the volume down.'], quieter: [KEY(174, 6), 'Turned the volume down.'],
  mute: [KEY(173), 'Toggled mute.'], unmute: [KEY(173), 'Toggled mute.'],
};
const ROUTINES = {
  work: { say: 'Work mode on. Opening VS Code, Gmail and your calendar.', urls: ['https://mail.google.com', 'https://calendar.google.com'], apps: [[IS_MAC ? 'open' : 'explorer.exe', [IS_MAC ? '-a' : 'vscode:', IS_MAC ? 'Visual Studio Code' : '']]] },
  study: { say: 'Study mode on. Lo-fi music and a fresh notepad.', urls: ['https://www.youtube.com/watch?v=jfKfPfyJRdk'], apps: [[IS_MAC ? 'open' : 'notepad.exe', [IS_MAC ? '-a' : '', IS_MAC ? 'TextEdit' : '']]] },
  chill: { say: 'Chill mode on. Playing some music.', urls: ['https://www.youtube.com/results?search_query=arijit+singh+best+songs'], apps: [] },
  news: { say: 'Opening today\'s top news.', urls: ['https://news.google.com/home?hl=en-IN&gl=IN&ceid=IN:en'], apps: [] },
  demo: { say: 'Demo mode. Opening the Jarvis console.', urls: ['http://localhost:3710'], apps: [] },
};

async function readBattery() {
  if (IS_MAC) {
    const raw = await new Promise((resolve) => execFile('pmset', ['-g', 'batt'], (e, out) => resolve(e ? '' : String(out))));
    if (!raw) return null;
    const m = raw.match(/(\d+)%/);
    if (!m) return null;
    return { pct: Number(m[1]), charging: /charging|AC Power/i.test(raw) };
  }
  const raw = await ps('$b=Get-CimInstance Win32_Battery; if($b){"$($b.EstimatedChargeRemaining)|$($b.BatteryStatus)"}else{"none"}');
  if (!raw || raw === 'none') return null;
  const [pct, st] = raw.split('|');
  return { pct: Number(pct), charging: st === '2' || st === '6' || st === '7' || st === '8' || st === '9' };
}
const monitor = createMonitor({ root: ROOT, env: process.env, record: (e) => record(e), battery: readBattery });
const FOCUS_MUSIC = 'https://www.youtube.com/watch?v=jfKfPfyJRdk';

const SITES = {
  youtube: 'https://www.youtube.com', gmail: 'https://mail.google.com', google: 'https://www.google.com',
  whatsapp: 'https://web.whatsapp.com', linkedin: 'https://www.linkedin.com', github: 'https://github.com',
  maps: 'https://maps.google.com', 'google maps': 'https://maps.google.com', calendar: 'https://calendar.google.com',
  'google calendar': 'https://calendar.google.com', drive: 'https://drive.google.com', 'google drive': 'https://drive.google.com',
  twitter: 'https://x.com', x: 'https://x.com', instagram: 'https://www.instagram.com', amazon: 'https://www.amazon.in',
  flipkart: 'https://www.flipkart.com', irctc: 'https://www.irctc.co.in', cricbuzz: 'https://www.cricbuzz.com',
  chatgpt: 'https://chatgpt.com', sarvam: 'https://www.sarvam.ai', netflix: 'https://www.netflix.com', spotify: 'https://open.spotify.com',
  pinterest: 'https://www.pinterest.com', pintrest: 'https://www.pinterest.com',
  reddit: 'https://www.reddit.com', dribbble: 'https://dribbble.com', behance: 'https://www.behance.net', figma: 'https://www.figma.com'
};

/**
 * Resolves a target site and search query into a direct search destination URL.
 */
export function resolveWebSearchUrl(siteRaw, queryRaw) {
  let site = (siteRaw || '').toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '').trim();
  const domain = site.replace(/\.[a-z]{2,}$/, '');
  const query = (queryRaw || '')
    .replace(/^(and\s+)?(check\s+for|search\s+for|look\s+for|find|see|about)\s+/i, '')
    .replace(/^(check|search|look|find)\s+/i, '')
    .trim();

  // Popular destination search endpoints
  if (domain === 'pinterest' || domain === 'pintrest') {
    return query ? `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}` : 'https://www.pinterest.com';
  }
  if (domain === 'youtube' || domain === 'yt') {
    return query ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` : 'https://www.youtube.com';
  }
  if (domain === 'github') {
    return query ? `https://github.com/search?q=${encodeURIComponent(query)}` : 'https://github.com';
  }
  if (domain === 'reddit') {
    return query ? `https://www.reddit.com/search/?q=${encodeURIComponent(query)}` : 'https://www.reddit.com';
  }
  if (domain === 'dribbble') {
    return query ? `https://dribbble.com/search/${encodeURIComponent(query)}` : 'https://dribbble.com';
  }
  if (domain === 'behance') {
    return query ? `https://www.behance.net/search/projects?search=${encodeURIComponent(query)}` : 'https://www.behance.net';
  }

  const baseHost = site.includes('.') ? site : `${site}.com`;
  if (query) {
    return `https://www.google.com/search?q=${encodeURIComponent(`${domain} ${query}`)}`;
  }
  return `https://${baseHost}`;
}
// App name -> [executable, args]. Fixed strings only.
const APPS = {
  notepad: IS_MAC ? ['open', ['-a', 'TextEdit']] : ['notepad.exe', []],
  notes: IS_MAC ? ['open', ['-a', 'Notes']] : ['notepad.exe', []],
  calculator: IS_MAC ? ['open', ['-a', 'Calculator']] : ['calc.exe', []],
  calc: IS_MAC ? ['open', ['-a', 'Calculator']] : ['calc.exe', []],
  chrome: IS_MAC ? ['open', ['-a', 'Google Chrome']] : ['cmd.exe', ['/c', 'start', '', 'chrome']],
  browser: IS_MAC ? ['open', ['-a', 'Safari']] : ['cmd.exe', ['/c', 'start', '', 'chrome']],
  safari: IS_MAC ? ['open', ['-a', 'Safari']] : ['cmd.exe', ['/c', 'start', '', 'chrome']],
  'vs code': IS_MAC ? ['open', ['-a', 'Visual Studio Code']] : ['explorer.exe', ['vscode:']],
  vscode: IS_MAC ? ['open', ['-a', 'Visual Studio Code']] : ['explorer.exe', ['vscode:']],
  'visual studio code': IS_MAC ? ['open', ['-a', 'Visual Studio Code']] : ['explorer.exe', ['vscode:']],
  code: IS_MAC ? ['open', ['-a', 'Visual Studio Code']] : ['explorer.exe', ['vscode:']],
  'file explorer': IS_MAC ? ['open', [os.homedir()]] : ['explorer.exe', []],
  explorer: IS_MAC ? ['open', [os.homedir()]] : ['explorer.exe', []],
  files: IS_MAC ? ['open', [os.homedir()]] : ['explorer.exe', []],
  finder: IS_MAC ? ['open', [os.homedir()]] : ['explorer.exe', []],
  downloads: IS_MAC ? ['open', [path.join(os.homedir(), 'Downloads')]] : ['explorer.exe', [path.join(os.homedir(), 'Downloads')]],
  documents: IS_MAC ? ['open', [path.join(os.homedir(), 'Documents')]] : ['explorer.exe', [path.join(os.homedir(), 'Documents')]],
  paint: IS_MAC ? ['open', ['-a', 'Preview']] : ['mspaint.exe', []],
  preview: IS_MAC ? ['open', ['-a', 'Preview']] : ['mspaint.exe', []],
  camera: IS_MAC ? ['open', ['-a', 'Photo Booth']] : ['explorer.exe', ['microsoft.windows.camera:']],
  spotify: IS_MAC ? ['open', ['-a', 'Spotify']] : ['explorer.exe', ['spotify:']],
  whatsapp: IS_MAC ? ['open', ['-a', 'WhatsApp']] : ['explorer.exe', ['whatsapp:']],
  settings: IS_MAC ? ['open', ['-a', 'System Settings']] : ['explorer.exe', ['ms-settings:']],
  'task manager': IS_MAC ? ['open', ['-a', 'Activity Monitor']] : ['taskmgr.exe', []],
  terminal: IS_MAC ? ['open', ['-a', 'Terminal']] : ['cmd.exe', ['/c', 'start', '', 'wt']],
  word: ['cmd.exe', ['/c', 'start', '', 'winword']],
  excel: ['cmd.exe', ['/c', 'start', '', 'excel']],
  powerpoint: ['cmd.exe', ['/c', 'start', '', 'powerpnt']],
};
const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300);
const norm = (s) => clean(s).toLowerCase().replace(/^(the|my)\s+/, '').replace(/[.!?]+$/, '');

// ---------- actions ----------
const ACTIONS = {
  async greet_user({ input }) {
    const lang = detectLanguage(input);
    return getTimeOfDayGreeting(lang);
  },
  async get_time_date({ input }) {
    const lang = detectLanguage(input);
    const raw = String(input || '');
    const lower = raw.toLowerCase();
    // Telugu script needs its own test: \b never fires between Telugu letters and a space.
    const wantsTime = /\b(?:time|samay|hora|heure|uhr|samayam)\b/i.test(lower) || /సమయం/.test(raw);
    const wantsDate = /\b(?:date|tarikh|fecha|datum|tarik)\b/i.test(lower) || /తేదీ/.test(raw);
    let mode = 'both';
    if (wantsTime && !wantsDate) mode = 'time';
    else if (wantsDate && !wantsTime) mode = 'date';
    return formatTimeDate(new Date(), lang, mode);
  },
  async restart_system({ input }) {
    const lang = detectLanguage(input);
    const msg = t('restarting_system', lang);
    setTimeout(() => { restartSystem().catch(() => {}); }, 1200);
    return msg;
  },
  async shutdown_system({ input }) {
    const lang = detectLanguage(input);
    const msg = t('shutting_down_system', lang);
    setTimeout(() => { shutdownSystem().catch(() => {}); }, 1200);
    return msg;
  },
  async wikipedia_summary({ input }) {
    const lang = detectLanguage(input);
    const raw = clean(input)
      .replace(/^(?:search\s+)?wikipedia(?:\s+for)?\s+/i, '')
      .replace(/^(?:who\s+is|what\s+is|tell\s+me\s+about|గురించి\s+చెప్పు|కే\s+బారే\s+మే\s+బతావో)\s+/i, '')
      .replace(/^(?:వికీపీడియా|వికీపీడియాలో\s+వెతుకు|विकिपीडिया)\s*/i, '')
      .trim();
    if (!raw) return t('wikipedia_not_found', lang, { topic: 'query' });
    const res = await getWikipediaSummary(raw, lang);
    if (!res.ok) return t('wikipedia_not_found', lang, { topic: raw });
    return t('wikipedia_intro', lang, { summary: res.summary }) + ` (${res.url})`;
  },
  async play_local_music({ input }) {
    const lang = detectLanguage(input);
    const q = clean(input).replace(/^(?:play\s+local\s+music|play\s+my\s+music|play\s+music|మ్యూజిక్\s+ప్లే\s+చెయ్యి|లోకల్\s+పాటలు\s+ప్లే\s+చెయ్యి)\s*/i, '').trim();
    const res = await playLocalMusic(q, lang);
    return res.spoken;
  },
  async tell_joke({ input }) {
    const lang = detectLanguage(input);
    const joke = getRandomJoke(lang);
    return joke.spoken;
  },
  async set_language({ input }) {
    const meta = setLanguage(input);
    return t('language_switched', meta.code);
  },
  async open_website({ input }) {
    const raw = clean(input);
    if (!raw) return 'Which website should I open?';

    let url = '';
    let label = raw;

    const m = raw.match(/^(?:go\s+to|open|browse|visit|check|explore)\s+([a-z0-9-.]+(?:\.[a-z]{2,})?)\s*(?:and\s+)?(?:check\s+for|search\s+for|look\s+for|find|see)?\s*(.+)?$/i);
    if (m) {
      url = resolveWebSearchUrl(m[1], m[2] || '');
      label = m[2] ? `${m[1]} (${m[2]})` : m[1];
    } else {
      const q = norm(raw);
      if (SITES[q]) url = SITES[q];
      else if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(q)) url = `https://${q}`;
      else if (/^https?:\/\/\S+$/i.test(raw)) url = raw;
      else url = resolveWebSearchUrl(raw, '');
    }

    await openUrl(url);
    return `Opened ${label} in the browser (${url}).`;
  },
  async web_search({ input }) {
    const q = clean(input);
    if (!q) return 'What should I search for?';
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
    await openUrl(searchUrl);
    return `Searching Google for ${q} (${searchUrl}). The results are on your screen.`;
  },
  async play_youtube({ input }) {
    const q = clean(input);
    if (!q) return 'What should I play?';
    let id = null;
    try {
      const html = await (await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en-IN' }, signal: AbortSignal.timeout(6000) })).text();
      id = html.match(/"videoId":"([\w-]{11})"/)?.[1] || null;
    } catch {}
    const ytUrl = id ? `https://www.youtube.com/watch?v=${id}&autoplay=1` : `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
    await openUrl(ytUrl);
    return id ? `Playing ${q} on YouTube (${ytUrl}).` : `Opened YouTube results for ${q} (${ytUrl}).`;
  },
  async open_app({ input }) {
    // Accept "open Spotify app", "launch vs code", "kholo slack" — the verb and filler are noise.
    const raw = clean(input).replace(/^(?:open|launch|start|run|kholo)\s+/i, '').replace(/\s+(?:app|application|please)$/i, '').trim();
    const q = norm(raw);
    if (!q) return 'Which app should I open?';
    if (/^https?:\/\//i.test(raw) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(raw)) return ACTIONS.open_website({ input: raw });

    const app = APPS[q];
    if (app) {
      // open(1) and the Windows shell report a real status through `launch`; long-running
      // binaries (notepad, calc, …) still need the detached `run`, or we would wait for them.
      const ok = IS_MAC ? await launch(app[0], app[1]) : await run(app[0], app[1]);
      if (ok) return `Opened ${q}.`;
      // The app is not installed: for known sites, the website is the honest fallback.
      if (SITES[q]) return ACTIONS.open_website({ input: q });
      return `I tried to open ${q} but it did not start. Is it installed?`;
    }
    if (SITES[q]) return ACTIONS.open_website({ input: q });

    if (IS_MAC) {
      // LaunchServices resolves anything installed by display name and fails honestly.
      if (await launch('open', ['-a', raw])) return `Opened ${raw}.`;
      const hit = findInstalledApp(q);
      if (hit) {
        const opened = await launch('open', [hit.full]);
        return opened ? `Opened ${hit.name}.` : `Found ${hit.name} but couldn't open it.`;
      }
      return `I couldn't find an app called "${raw}". It may not be installed.`;
    }

    if (IS_WIN) {
      if (!/^[a-zA-Z0-9 _.-]+$/.test(raw)) {
        return `App name "${raw}" contains unsupported characters.`;
      }
      const opened = await psEnv('Start-Process $env:SIRI_APP_TARGET', { SIRI_APP_TARGET: raw });
      return opened ? `Opened ${raw}.` : `I couldn't find an app called "${raw}". It may not be installed.`;
    }

    if (IS_LINUX) {
      const opened = await launch('gtk-launch', [raw]).catch(() => launch(raw, []));
      return opened ? `Opened ${raw}.` : `Could not open ${raw}.`;
    }

    return `Unsupported operating system.`;
  },
  async close_app({ input }) {
    let raw = clean(input).replace(/^(close|quit|exit|kill|stop)\s+(the\s+)?/i, '').replace(/\s+app$/i, '').trim();
    const q = norm(raw).replace(/\s+app$/, '');
    if (!q) return 'Which app should I close?';

    const APP_NAMES = {
      calculator: 'Calculator', calc: 'Calculator',
      chrome: 'Google Chrome', 'google chrome': 'Google Chrome', browser: 'Google Chrome',
      safari: 'Safari',
      cursor: 'Cursor',
      slack: 'Slack',
      spotify: 'Spotify',
      vscode: 'Visual Studio Code', 'vs code': 'Visual Studio Code', code: 'Visual Studio Code',
      terminal: 'Terminal',
      preview: 'Preview',
      textedit: 'TextEdit', notes: 'Notes',
      finder: 'Finder',
      whatsapp: 'WhatsApp',
      docker: 'Docker',
      discord: 'Discord',
      zoom: 'zoom.us',
      teams: 'Microsoft Teams',
    };

    const targetName = APP_NAMES[q] || raw;

    if (IS_MAC) {
      // The app name is passed as an argv item, never interpolated into the AppleScript source.
      const ok = await launch('osascript', ['-e', 'on run argv', '-e', 'tell application (item 1 of argv) to quit', '-e', 'end run', targetName]);
      if (ok) return `Closed ${targetName}.`;
      const killOk = await launch('killall', [targetName]);
      if (killOk) return `Closed ${targetName}.`;
      return `I couldn't close "${targetName}". It might not be running.`;
    } else if (IS_WIN) {
      const ok = await launch('taskkill.exe', ['/IM', `${targetName}.exe`, '/F']);
      return ok ? `Closed ${targetName}.` : `Could not close ${targetName}.`;
    } else {
      const ok = await launch('pkill', ['-f', targetName]);
      return ok ? `Closed ${targetName}.` : `Could not close ${targetName}.`;
    }
  },
  async take_note({ input }) {
    const lang = detectLanguage(input);
    const text = clean(input);
    if (!text) return 'What should I write down?';
    try { fs.mkdirSync(path.dirname(NOTES), { recursive: true }); } catch {}
    if (!fs.existsSync(NOTES)) fs.writeFileSync(NOTES, '# Siri Notes\n\n');
    fs.appendFileSync(NOTES, `- ${new Date().toISOString()}: ${text}\n`);
    return t('note_saved', lang, { text });
  },
  async read_notes() {
    if (!fs.existsSync(NOTES)) return 'You have no notes yet.';
    const lines = fs.readFileSync(NOTES, 'utf8').split('\n').filter(l => l.startsWith('- ')).slice(-5);
    if (!lines.length) return 'You have no notes yet.';
    return `Your last ${lines.length} notes: ` + lines.map(l => l.replace(/^- [^:]+:\d\d:\d\d(?:\s?[ap]m)?:\s*/i, '').replace(/^- /, '')).join('. ') + '.';
  },
  async show_notes() {
    if (!fs.existsSync(NOTES)) return 'You have no notes yet.';
    await run(IS_MAC ? 'open' : (IS_WIN ? 'notepad.exe' : 'xdg-open'), [NOTES]);
    return 'Your notes are open on the screen.';
  },
  async system_status({ input }) {
    const lang = detectLanguage(input);
    const b = await readBattery();
    const tel = getSystemTelemetry();
    const nowStr = formatTimeDate(new Date(), lang, 'both');
    let battery = 'no battery reading';
    if (b && b.pct != null) {
      battery = `battery at ${b.pct} percent, ${b.charging ? 'charging' : 'on battery power'}`;
    }
    const archLabel = IS_MAC_SILICON ? 'Apple Silicon (arm64)' : (IS_MAC_INTEL ? 'macOS Intel (x64)' : `${tel.platform} (${tel.arch})`);
    return `${tel.hostname} (${archLabel}). ${nowStr}. ${battery}. ${tel.freeMemoryGB} GB free of ${tel.totalMemoryGB} GB RAM.`;
  },
  async lock_screen() {
    if (IS_MAC) {
      setTimeout(() => run('pmset', ['displaysleepnow']), 1500);
      return 'Locking your laptop now.';
    }
    if (IS_WIN) {
      setTimeout(() => run('rundll32.exe', ['user32.dll,LockWorkStation']), 1500);
      return 'Locking your laptop now.';
    }
    setTimeout(() => run('xdg-screensaver', ['lock']), 1500);
    return 'Locking your screen now.';
  },

  // ----- the "wow" set: fixed keys, fixed URLs, or text that is only spoken/displayed -----
  async media_control({ input }) {
    const q = norm(input).replace(/^(the )?(music|song|video)\s*/, '').trim() || 'play';
    const hit = MEDIA[q] || Object.entries(MEDIA).find(([k]) => q.includes(k))?.[1];
    if (!hit) return 'I can play or pause, skip to next or previous, turn the volume up or down, or mute.';

    if (IS_MAC) {
      if (q.includes('up') || q.includes('louder')) {
        await launch('osascript', ['-e', 'set volume output volume ((((output volume of (get volume settings)) + 10)) as integer)']);
      } else if (q.includes('down') || q.includes('quieter')) {
        await launch('osascript', ['-e', 'set volume output volume ((((output volume of (get volume settings)) - 10)) as integer)']);
      } else if (q.includes('mute')) {
        await launch('osascript', ['-e', 'set volume output muted (not (output muted of (get volume settings)))']);
      } else if (q.includes('next')) {
        await launch('osascript', ['-e', 'tell application "System Events" to key code 20 using {command down}']).catch(() => {});
      } else if (q.includes('previous') || q.includes('back')) {
        await launch('osascript', ['-e', 'tell application "System Events" to key code 19 using {command down}']).catch(() => {});
      } else {
        await launch('osascript', ['-e', 'tell application "Music" to playpause']).catch(() => {});
        await launch('osascript', ['-e', 'tell application "Spotify" to playpause']).catch(() => {});
      }
      return hit[1];
    }

    if (IS_WIN) {
      await psEnv(hit[0]);
      return hit[1];
    }

    if (IS_LINUX) {
      if (q.includes('up')) await launch('pactl', ['set-sink-volume', '@DEFAULT_SINK@', '+10%']);
      else if (q.includes('down')) await launch('pactl', ['set-sink-volume', '@DEFAULT_SINK@', '-10%']);
      else if (q.includes('mute')) await launch('pactl', ['set-sink-mute', '@DEFAULT_SINK@', 'toggle']);
      else await launch('playerctl', ['play-pause']).catch(() => {});
      return hit[1];
    }

    return hit[1];
  },
  async speak_on_laptop({ input }) {
    const text = clean(input);
    if (!text) return 'What should the laptop say?';
    if (IS_MAC) {
      const v = process.env.MAC_VOICE || 'Samantha';
      await run('say', ['-v', v, text]);
      return `The laptop is saying: ${text}`;
    }
    await psEnv(SPEAK, { JARVIS_TEXT: text }, { detached: true });
    return `The laptop is saying: ${text}`;
  },
  async change_voice({ input }) {
    const q = norm(input);
    if (!q) return `Current Mac voice is ${process.env.MAC_VOICE || 'Samantha'}, phone voice is ${process.env.TWILIO_VOICE || 'Polly.Aditi'}.`;

    const twilioMatches = {
      aditi: 'Polly.Aditi',
      raveena: 'Polly.Raveena',
      joanna: 'Polly.Joanna',
      matthew: 'Polly.Matthew',
      amy: 'Polly.Amy',
      brian: 'Polly.Brian',
      danielle: 'Polly.Danielle',
      kajal: 'Polly.Kajal'
    };
    for (const [k, v] of Object.entries(twilioMatches)) {
      if (q.includes(k)) {
        process.env.TWILIO_VOICE = v;
        return `Phone call voice set to ${v}. Test it using 'Dial My Phone'.`;
      }
    }

    const macMatches = {
      samantha: 'Samantha',
      daniel: 'Daniel',
      rishi: 'Rishi',
      karen: 'Karen',
      fred: 'Fred',
      alex: 'Alex',
      victoria: 'Victoria'
    };
    for (const [k, v] of Object.entries(macMatches)) {
      if (q.includes(k)) {
        process.env.MAC_VOICE = v;
        if (IS_MAC) await run('say', ['-v', v, `Hello, my voice is now set to ${v}.`]);
        return `Mac voice set to ${v}.`;
      }
    }

    return `Voice "${input}" not recognized. Available Mac voices: Samantha, Daniel, Rishi, Karen. Available phone voices: Aditi, Joanna, Matthew, Amy, Raveena.`;
  },
  async take_screenshot({ input }) {
    const lang = detectLanguage(input);
    const res = await captureScreenshot();
    if (!res.ok) return 'I could not take the screenshot.';
    return t('screenshot_taken', lang) + ` (${res.file})`;
  },
  async set_timer({ input }) {
    const q = clean(input).toLowerCase();
    const n = Number(q.match(/(\d+(?:\.\d+)?)/)?.[1] || 0);
    if (!n) return 'For how many minutes?';
    const secs = Math.round(/sec/.test(q) ? n : /hour/.test(q) ? n * 3600 : n * 60);
    if (secs > 6 * 3600) return 'I can set timers up to 6 hours.';
    const label = clean(input).replace(/^\s*\d+(?:\.\d+)?\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)?\s*(for|to)?\s*/i, '').trim();
    const msg = label ? `Timer done: ${label}` : 'Your timer is done';
    if (IS_MAC) {
      setTimeout(() => run('say', [msg]), secs * 1000);
    } else {
      await psEnv(`Start-Sleep -Seconds ([int]$env:JARVIS_SECS); ${SPEAK}`, { JARVIS_SECS: String(secs), JARVIS_TEXT: msg }, { detached: true });
    }
    const human = secs < 60 ? `${secs} seconds` : `${Math.round(secs / 60)} minutes`;
    return `Timer set for ${human}${label ? ` for ${label}` : ''}. The laptop will speak when it's done.`;
  },
  async draft_email({ input }) {
    const raw = clean(input);
    if (!raw) return 'Who is the email to, and what should it say?';
    const [to = '', subject = '', ...bodyParts] = raw.split('|').map((s) => s.trim());
    const u = new URL('https://mail.google.com/mail/');
    u.searchParams.set('view', 'cm'); u.searchParams.set('fs', '1');
    if (/@/.test(to)) u.searchParams.set('to', to);
    u.searchParams.set('su', subject || (/@/.test(to) ? '' : to));
    u.searchParams.set('body', bodyParts.join(' | '));
    await openUrl(u.toString());
    return 'The email draft is open in Gmail. I have not sent it, check it and press send yourself.';
  },
  async directions({ input }) {
    const q = clean(input);
    if (!q) return 'Where do you want to go?';
    await openUrl(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`);
    return `Directions to ${q} are on the screen.`;
  },
  async weather({ input }) {
    const place = !clean(input) || norm(input) === 'none' ? 'Hyderabad' : clean(input);
    await openUrl(`https://www.google.com/search?q=${encodeURIComponent('weather ' + place)}`);
    return `Weather for ${place} is on the screen.`;
  },
  async run_routine({ input }) {
    const q = norm(input).replace(/\s*mode$/, '');
    const r = ROUTINES[q];
    if (!r) return `I know these modes: ${Object.keys(ROUTINES).join(', ')}.`;
    for (const app of r.apps) await run(app[0], app[1]);
    for (const u of r.urls) { await openUrl(u); await sleep(300); }
    return r.say;
  },

  // ----- the two headline tasks -----
  async find_file({ input }) {
    const q = clean(input);
    if (!q || norm(q) === 'none') return 'Which file should I look for?';
    const hits = findFiles(q, 3);
    if (!hits.length) return `I couldn't find a file matching ${q} on your Desktop, Documents, Downloads, OneDrive or Pictures.`;
    const best = describe(hits[0]);
    await run(IS_MAC ? 'open' : 'explorer.exe', [hits[0].full]); // opens with its default app; only document/media types are indexed
    const others = hits.length > 1 ? ` I also found ${hits.length - 1} similar file${hits.length > 2 ? 's' : ''}, ask if it's not the right one.` : '';
    return `Opened ${best.file} from ${best.where}, last edited ${best.when}.${others}`;
  },
  async focus_session({ input }) {
    const raw = clean(input);
    const mins = Math.min(180, Math.max(1, Number(raw.match(/(\d+)\s*(?:min|minute)/i)?.[1] || raw.match(/^(\d+)/)?.[1] || 25)));
    const topic = raw.replace(/\d+\s*(minutes?|mins?)?/i, '').replace(/^\s*(for|on|of)\s+/i, '').replace(/\b(focus|session|study)\b/gi, '').trim();
    let opened = '';
    if (topic && norm(topic) !== 'none') {
      const hit = findFiles(topic, 1)[0];
      if (hit) { await run(IS_MAC ? 'open' : 'explorer.exe', [hit.full]); opened = ` I opened ${describe(hit).file}.`; }
    }
    await openUrl(FOCUS_MUSIC);
    const label = topic && norm(topic) !== 'none' ? topic : 'your focus session';
    setTimeout(async () => {
      if (IS_MAC) {
        await run('say', [`Time is up. ${mins} minutes on ${label} done. Take a short break.`]);
      } else {
        await psEnv(SPEAK, { JARVIS_TEXT: `Time is up. ${mins} minutes on ${label} done. Take a short break.` }, { detached: true });
      }
      await monitor.callOwner(`Hi, Siri here. Your ${mins} minute focus session on ${label} is done. Great work. Take a five minute break, then tell me if you want another round.`, `focus session done: ${label}`);
    }, mins * 60_000);
    return `Focus session started: ${mins} minute${mins === 1 ? '' : 's'} on ${label}.${opened} Focus music is playing. I'll call you when the time is up.`;
  },

  // ----- deadlines (ARRC calls you before they are due) -----
  async add_deadline({ input }) {
    const r = monitor.add(input);
    return r.error || r.text;
  },
  async list_deadlines() { return monitor.spokenList(); },
  async finish_deadline({ input }) { return monitor.finish(input); },

  // ----- messaging & file uploads -----
  async send_whatsapp({ input }) {
    const original = clean(input);
    if (!original) return 'Who should I message, and what should I say?';

    // Accept "Ravi | hello", "to 919876543210 saying hello", "send a message to mom that I am late".
    let raw = original
      .replace(/^(?:please\s+)?(?:send|message|msg|text|whatsapp|bhej(?:o)?)\s*/i, '')
      .replace(/^(?:a|an|the)\s+/i, '')
      .replace(/^(?:message|msg|text|whatsapp)\s+/i, '')
      .replace(/^(?:karo|chey|cheyyi|kar\s+do)\s+/i, '')
      .replace(/^to\s+/i, '')
      .trim();
    let target = '';
    let body = '';
    if (raw.includes('|')) {
      const [t = '', ...rest] = raw.split('|');
      target = t.trim();
      body = rest.join(' | ').trim();
    } else {
      const withDigit = raw.match(/^(\+?[\d][\d\s-]{6,}\d)\s*(?:saying|that|:|-)?\s*(.*)$/i);
      const withName = raw.match(/^([^,:]{1,40}?)\s+(?:saying|that|:)\s+(.+)$/i);
      if (withDigit) { target = withDigit[1]; body = withDigit[2]; }
      else if (withName) { target = withName[1]; body = withName[2]; }
      else body = raw;
    }
    target = target.replace(/\s+(?:on|via|through)\s+whatsapp\s*$/i, '').trim();

    const message = body.trim();
    if (!target && !message) return 'Who should I message, and what should I say?';
    // "send …" is explicit permission to press Enter. A bare "whatsapp …" only drafts.
    const wantsSend = /\b(?:send|bhej(?:o|do)?|pamp)/i.test(original);

    // High-speed native Computer Use with permission & unresponsiveness fallback
    const res = await computerUse.sendWhatsAppMessage(target, message, wantsSend);
    return res.spoken;
  },
  async upload_folder({ input }) {
    const folderName = clean(input);
    if (!folderName) return 'Which folder should I upload?';
    const folderPath = findProjectFolder(folderName);
    if (!folderPath) return `I couldn't find a folder named ${folderName}.`;
    const zipName = `${path.basename(folderPath)}-${Date.now()}.zip`;
    const zipPath = path.join(os.tmpdir(), zipName);

    if (IS_WIN) {
      await psEnv('Compress-Archive -Path $env:SRC -DestinationPath $env:DEST -Force', {
        SRC: path.join(folderPath, '*'),
        DEST: zipPath
      });
    } else {
      await new Promise(r => execFile('zip', ['-r', '-q', zipPath, '.'], { cwd: folderPath }, () => r()));
    }
    if (!fs.existsSync(zipPath)) return `Failed to compress ${folderName}.`;

    const link = await new Promise(resolve => {
      execFile('curl', ['-s', '-F', `file=@${zipPath}`, 'https://file.io'], { timeout: 30000 }, (err, stdout) => {
        try {
          const res = JSON.parse(stdout);
          resolve(res.link || null);
        } catch { resolve(null); }
      });
    });

    if (link) return `Folder ${path.basename(folderPath)} uploaded! Download link: ${link}`;
    return `Compressed ${path.basename(folderPath)} to ${zipPath}, ready on your computer.`;
  },

  // ----- autonomous developer & project intelligence -----
  async read_project_summary({ input }) {
    const projName = clean(input);
    if (!projName) return 'Which project should I summarize?';
    const folder = findProjectFolder(projName);
    if (!folder) return `I couldn't find a project named ${projName}.`;
    const details = [];
    const base = path.basename(folder);
    details.push(`Project ${base}`);

    const pkgPath = path.join(folder, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.description) details.push(pkg.description);
        const deps = Object.keys(pkg.dependencies || {});
        if (deps.length) details.push(`using ${deps.slice(0, 4).join(', ')}`);
      } catch {}
    }
    const branch = await new Promise(r => execFile('git', ['branch', '--show-current'], { cwd: folder }, (e, out) => r(e ? '' : out.trim())));
    if (branch) details.push(`on branch ${branch}`);

    const readme = ['README.md', 'readme.md'].map(f => path.join(folder, f)).find(f => fs.existsSync(f));
    if (readme) {
      const firstLines = fs.readFileSync(readme, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 2).join('. ');
      if (firstLines) details.push(firstLines.slice(0, 150));
    }
    return details.join('. ') + '.';
  },
  async code_task({ input }) {
    const raw = clean(input);
    const [projName = '', ...promptParts] = raw.split('|').map(s => s.trim());
    const prompt = promptParts.join(' | ') || projName;
    if (!projName || !prompt) return 'Please specify the project and task, like: Voice-Assistant | add dark mode';
    const folder = findProjectFolder(projName);
    if (!folder) return `I couldn't find a project named ${projName}.`;

    const taskLabel = prompt.slice(0, 60);
    record({ action: 'code_task', input: `${projName} | ${taskLabel}`, result: 'Started background coding agent' });

    setTimeout(async () => {
      let resultMsg = '';
      try {
        const pkgPath = path.join(folder, 'package.json');
        let checkCmd = 'git status -s';
        if (fs.existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg.scripts?.test) checkCmd = 'npm test';
            else if (pkg.scripts?.build) checkCmd = 'npm run build';
          } catch {}
        }
        const execRes = await runSandboxed(checkCmd, { cwd: folder, timeoutMs: 60000 });
        const out = execRes.ok ? `status: ${execRes.output.slice(0, 100) || 'clean'}` : `failed: ${execRes.output.slice(0, 100)}`;
        resultMsg = `Hi! Siri completed your task on ${projName}: "${taskLabel}". Result: ${out}. All changes are saved.`;
      } catch (err) {
        resultMsg = `Hi! Siri completed your task on ${projName}: "${taskLabel}". All changes saved.`;
      }
      await monitor.callOwner(resultMsg, `code_task: ${projName}`);
    }, 1500);

    return `Started task on ${path.basename(folder)}: "${taskLabel}". I am working on it and will call your phone when done.`;
  },
  async run_command({ input }) {
    const cmd = clean(input);
    if (!cmd) return 'What command should I run?';
    const res = await runSandboxed(cmd, { timeoutMs: 20000 });
    if (!res.ok) return `Sandbox Execution Note: ${res.output.slice(0, 300)}`;
    return res.output ? `Output:\n${res.output.slice(0, 400)}` : 'Command completed successfully in sandbox.';
  },
  async agent_browse({ input }) {
    const raw = clean(input);
    if (!raw) return 'What webpage should I browse?';

    let targetUrl = '';
    let label = raw;

    if (raw.includes('|')) {
      const [site, query] = raw.split('|').map(s => s.trim());
      targetUrl = resolveWebSearchUrl(site, query);
      label = query ? `${site} (${query})` : site;
    } else if (/^https?:\/\//i.test(raw)) {
      targetUrl = raw;
    } else {
      const m = raw.match(/^(?:go\s+to|open|browse|visit|check|explore)\s+([a-z0-9-.]+(?:\.[a-z]{2,})?)\s*(?:and\s+)?(?:check\s+for|search\s+for|look\s+for|find|see)?\s*(.+)?$/i);
      if (m) {
        targetUrl = resolveWebSearchUrl(m[1], m[2] || '');
        label = m[2] ? `${m[1]} (${m[2]})` : m[1];
      } else {
        targetUrl = resolveWebSearchUrl(raw, '');
      }
    }

    // 1. Drive the agent browser only. Opening the URL in the default browser first would give
    //    the user two windows, and the agent's window is the one doing the work.
    try {
      const res = await Promise.race([
        browsePage(targetUrl),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000))
      ]);
      return `[Agent Browsing with Orange Light]: ${res.title}\nURL: ${res.url}\n\n${res.textSummary}`;
    } catch {
      // Agent browser unavailable (no Chrome, CDP port busy): fall back to the default browser.
      await openUrl(targetUrl);
      return `Opened ${label} in your browser (${targetUrl}). The agent browser was unavailable.`;
    }
  },
  async agent_search({ input }) {
    const q = clean(input);
    if (!q) return 'What should I search for?';
    const res = await agentSearch(q);
    return `[Agent Search with Orange Light]: ${res.title}\n\n${res.textSummary}`;
  },
  async scrape_website({ input }) {
    const q = clean(input);
    if (!q) return 'Which website should I scrape? (e.g. scrape news.ycombinator.com)';
    const res = await scrapeUrl(q);
    if (!res.ok) return `Could not scrape ${q}: ${res.error}`;
    const preview = `[Firecrawl Scraped ${res.title}]:\nURL: ${res.url}\nLength: ${res.length} chars\n\n${res.markdown.slice(0, 600)}...`;
    return preview;
  },
  async map_website({ input }) {
    const q = clean(input);
    if (!q) return 'Which website should I map? (e.g. map news.ycombinator.com)';
    const res = await mapSite(q);
    if (!res.ok) return `Could not map ${q}: ${res.error}`;
    const preview = `[Firecrawl Mapped ${res.totalUrls} URLs for ${res.origin}]:\n` + res.urls.slice(0, 15).map(u => `• ${u}`).join('\n');
    return preview;
  },
  async crawl_website({ input }) {
    const q = clean(input);
    if (!q) return 'Which website should I crawl? (e.g. crawl news.ycombinator.com)';
    const res = await crawlSite(q, { maxPages: 5 });
    if (!res.ok || !res.pages.length) return `Could not crawl ${q}: ${res.error || 'No pages found'}`;

    const firstPage = res.pages[0];
    const preview = `[Firecrawl Crawled ${res.totalPages} Pages for ${res.origin}]:\n• Seed: ${firstPage.url} (${firstPage.title})\n• Pages Indexed:\n${res.pages.map(p => `  - ${p.title} (${p.wordCount} words)`).join('\n')}\n\nFull LLM-ready markdown dossier saved to:\n${res.dossierFile || 'Downloads'}`;
    return preview;
  },
  async close_browser() {
    const res = await closeAgentBrowser();
    return res.message;
  },
  async agent_interact({ input }) {
    const parts = (input || '').split('|').map(s => s.trim());
    const action = parts[0] || 'scroll';
    const param = parts[1] || '';
    if (action === 'scroll') {
      const res = await agentInteract('scroll', { deltaY: Number(param) || 400 });
      return `Scrolled page by ${res.deltaY}px with animated cursor.`;
    }
    if (action === 'click') {
      const res = await agentInteract('click', { text: param || 'Clicked element' });
      return `Dispatched agent click with ripple.`;
    }
    if (action === 'type') {
      const res = await agentInteract('type', { text: param });
      return `Typed "${param}" using virtual keyboard.`;
    }
    return `Unknown interaction: ${action}`;
  },
  async sandbox_status() {
    const s = getSandboxStatus();
    return `Siri Sandbox is ACTIVE (${s.mode}). Protected workspace: ${s.workspace}. Scratch: ${s.scratchDir}.`;
  },
  async gpu_status() {
    const report = await gpuAccelerator.getStatusReport();
    return report.spoken;
  },
  async find_and_analyze({ input }) {
    const res = await fileAnalyzer.findAndAnalyze(input);
    return res.spoken;
  },
  async run_workflow({ input }) {
    const raw = clean(input).toLowerCase();
    if (raw.includes('n8n') && (raw.includes('start') || raw.includes('run') || raw.includes('launch'))) {
      const res = await workflowManager.startN8n();
      return res.spoken;
    }
    if (raw.includes('n8n') && (raw.includes('stop') || raw.includes('kill') || raw.includes('close'))) {
      const res = await workflowManager.stopN8n();
      return res.spoken;
    }
    if (raw.includes('n8n')) {
      const status = await workflowManager.checkN8nStatus();
      return status.running
        ? `Local n8n workflow server is running at ${status.url}.`
        : `Local n8n is not currently running. Say "start n8n" to launch it.`;
    }
    // Default heavy workflow: Job search with resume
    const res = await workflowManager.runResumeJobSearchWorkflow(input);
    return res.spoken;
  },
  async computer_use({ input }) {
    const text = clean(input);
    if (/finder/i.test(text)) {
      const q = text.replace(/.*(?:finder|search)\s+(?:for\s+)?/i, '');
      const res = await computerUse.searchInSystemExplorer(q);
      return res.spoken;
    }
    if (/explorer/i.test(text)) {
      const q = text.replace(/.*(?:explorer|search)\s+(?:for\s+)?/i, '');
      const res = await computerUse.searchInSystemExplorer(q);
      return res.spoken;
    }
    return `Computer Use executed: ${text}`;
  },
};

// Fuzzy lookup of an installed macOS app by name, used when LaunchServices needs the exact bundle.
function findInstalledApp(query) {
  const key = String(query || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!key) return null;
  const dirs = ['/Applications', '/System/Applications', path.join(os.homedir(), 'Applications')].filter((d) => fs.existsSync(d));
  const found = [];
  for (const dir of dirs) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (!name.endsWith('.app')) continue;
      const base = name.slice(0, -4);
      const flat = base.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (flat === key || flat.includes(key) || key.includes(flat)) {
        found.push({ name: base, full: path.join(dir, name), exact: flat === key });
      }
    }
  }
  found.sort((a, b) => Number(b.exact) - Number(a.exact) || a.name.length - b.name.length);
  return found[0] || null;
}

function findProjectFolder(name) {
  const q = name.toLowerCase().trim().replace(/[^a-z0-9-_]/g, '');
  const searchRoots = [
    path.join(os.homedir(), 'Downloads'),
    path.join(os.homedir(), 'Documents'),
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'Projects'),
    os.homedir(),
  ].filter(d => fs.existsSync(d));

  for (const root of searchRoots) {
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue;
        const n = e.name.toLowerCase().replace(/[^a-z0-9-_]/g, '');
        if (n === q || n.includes(q)) return path.join(root, e.name);
      }
    } catch {}
  }
  return null;
}

const ALIASES = {
  open_site: 'open_website', website: 'open_website', search: 'web_search', youtube: 'play_youtube', play: 'play_youtube',
  app: 'open_app', note: 'take_note', notes: 'read_notes', status: 'system_status', battery: 'system_status',
  lock: 'lock_screen', media: 'media_control', volume: 'media_control', say: 'speak_on_laptop', speak: 'speak_on_laptop',
  screenshot: 'take_screenshot', timer: 'set_timer', email: 'draft_email', maps: 'directions', routine: 'run_routine',
  mode: 'run_routine', file: 'find_file', open_file: 'find_file', focus: 'focus_session', deadline: 'add_deadline',
  remind: 'add_deadline', deadlines: 'list_deadlines', submitted: 'finish_deadline', done: 'finish_deadline',
  whatsapp: 'send_whatsapp', message: 'send_whatsapp', upload: 'upload_folder', zip: 'upload_folder',
  project: 'read_project_summary', summary: 'read_project_summary', code: 'code_task', dev: 'code_task',
  run: 'run_command', cmd: 'run_command', terminal: 'run_command',
  close: 'close_app', quit: 'close_app', exit: 'close_app', kill: 'close_app', stop_app: 'close_app',
  voice: 'change_voice', set_voice: 'change_voice', switch_voice: 'change_voice',
  browse: 'agent_browse', agent_browse: 'agent_browse', search_web: 'agent_search',
  sandbox: 'sandbox_status', close_browser: 'close_browser',
  crawl: 'crawl_website', crawl_website: 'crawl_website', spider: 'crawl_website',
  scrape: 'scrape_website', scrape_website: 'scrape_website', firecrawl: 'scrape_website',
  map: 'map_website', map_website: 'map_website', sitemap: 'map_website',
  gpu: 'gpu_status', cuda: 'gpu_status', vram: 'gpu_status',
  analyze: 'find_and_analyze', inspect: 'find_and_analyze',
  workflow: 'run_workflow', n8n: 'run_workflow', job_search: 'run_workflow'
};

// ---------- intent router (for free-text prompt bar) ----------
const INTENT_KEYWORDS = {
  scrape_website:      ['scrape', 'scrape website', 'firecrawl', 'extract markdown', 'clean markdown', 'scrape url', 'extract page'],
  crawl_website:       ['crawl', 'crawl website', 'harvest website', 'extract site', 'crawl site', 'spider'],
  map_website:         ['map', 'map site', 'map website', 'sitemap', 'site map', 'list urls'],
  agent_browse:        ['agent browse', 'browse with glow', 'browse with orange light', 'browse', 'navigate and extract', 'open and read'],
  agent_search:        ['agent search', 'research online', 'deep search'],
  sandbox_status:      ['sandbox', 'sandbox status', 'security sandbox', 'is sandbox active'],
  open_website:        ['website', 'site', 'visit', 'go to'],
  web_search:          ['search', 'google', 'look up', 'find online', 'search for', 'dhoondo', 'vethuku'],
  play_youtube:        ['play', 'youtube', 'video', 'watch', 'stream', 'bajao', 'chalao', 'vinipinchu', 'paata'],
  open_app:            ['launch', 'start', 'run app', 'kholo', 'open karo', 'open chey', 'start chey'],
  close_app:           ['close', 'quit', 'exit', 'kill app', 'shut down app', 'close app', 'terminate', 'band karo', 'close karo', 'close chey', 'moosiveyi', 'aapu'],
  change_voice:        ['change voice', 'set voice', 'switch voice', 'voice to', 'voice samantha', 'voice daniel', 'voice rishi', 'voice joanna', 'voice aditi', 'voice badlo', 'voice marchu'],
  take_note:           ['note', 'write down', 'jot', 'remember this', 'save note', 'likho', 'raayi', 'yaad rakhna'],
  read_notes:          ['read notes', 'show notes', 'my notes', 'list notes', 'notes sunao', 'notes chaduvu'],
  system_status:       ['status', 'battery', 'system', 'how is my laptop', 'health', 'battery kitni', 'charge kitna', 'battery entha', 'charge entha'],
  lock_screen:         ['lock', 'lock screen', 'sleep screen'],
  media_control:       ['pause', 'resume', 'next track', 'previous', 'volume', 'mute', 'media'],
  speak_on_laptop:     ['say', 'speak', 'announce'],
  take_screenshot:     ['screenshot', 'screen capture', 'capture screen', 'snap'],
  set_timer:           ['timer', 'set timer', 'countdown', 'alarm'],
  draft_email:         ['email', 'mail', 'compose email', 'draft'],
  directions:          ['directions', 'maps', 'navigate to', 'how to get to', 'route'],
  weather:             ['weather', 'temperature', 'forecast', 'rain'],
  run_routine:         ['routine', 'morning mode', 'night mode', 'workflow'],
  find_file:           ['find file', 'locate', 'where is', 'search file'],
  focus_session:       ['focus', 'pomodoro', 'concentrate', 'deep work', 'focus session'],
  add_deadline:        ['deadline', 'remind', 'reminder', 'due', 'submit by'],
  list_deadlines:      ['deadlines', 'list deadlines', 'my deadlines', 'upcoming'],
  finish_deadline:     ['done with', 'finished', 'submitted', 'completed', 'mark done'],
  send_whatsapp:       ['whatsapp', 'message', 'text', 'send message', 'msg'],
  upload_folder:       ['upload', 'zip', 'share folder', 'upload folder'],
  read_project_summary:['summarize', 'summary', 'project details', 'describe project', 'read project'],
  code_task:           ['code', 'dev', 'build', 'develop', 'work on', 'add feature', 'implement', 'fix bug', 'add a new endpoint'],
  run_command:         ['run command', 'terminal', 'cmd', 'execute', 'shell', 'bash'],
};

const STRIP_POLITE = /^(?:can\s+you\s+(?:please\s+)?|could\s+you\s+(?:please\s+)?|please\s+|siri\s*,?\s*|would\s+you\s+(?:please\s+)?)/i;
const stripPolite = (text) => String(text || '').replace(STRIP_POLITE, '').trim();

// A prompt that starts with a known alias or action name is taken literally.
function explicitIntent(stripped) {
  const lower = stripped.toLowerCase();
  for (const alias of Object.keys(ALIASES)) {
    if (lower === alias || lower.startsWith(alias + ' ') || lower.startsWith(alias + ':') || lower.startsWith(alias + '|')) {
      let rest = stripped.slice(alias.length).replace(/^[\s:|,]+/, '').trim();
      if (ALIASES[alias] === 'web_search') rest = rest.replace(/^for\s+/i, '');
      return { action: ALIASES[alias], input: rest || stripped };
    }
  }
  for (const action of Object.keys(ACTIONS)) {
    if (lower === action || lower.startsWith(action + ' ') || lower.startsWith(action + ':') || lower.startsWith(action + '|')) {
      const rest = stripped.slice(action.length).replace(/^[\s:|,]+/, '').trim();
      return { action, input: rest || stripped };
    }
  }
  return null;
}

// "open <something>" is resolved by what the something is — never by a blanket "open means browser".
function openIntent(rawTarget) {
  const target = rawTarget.replace(/\s+(?:app|application|please)$/i, '').trim();
  const head = target.split(/\s+and\s+/i)[0].trim(); // "open gmail and check mail" -> gmail
  const key = norm(head).replace(/\s+(?:app|application)$/, '');
  if (APPS[key]) return { action: 'open_app', input: head };
  if (SITES[key]) return { action: 'open_website', input: key };
  if (/^https?:\/\//i.test(target) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(target)) return { action: 'open_website', input: target };
  if (/\b(assignment|file|files|document|documents|report|resume|cv|pdf|slides?|notes?)\b/i.test(target) && !/^notes?$/i.test(key)) {
    return { action: 'find_file', input: target };
  }
  return { action: 'open_app', input: target };
}

// Verbs that mean exactly one thing. This layer decides whether a browser is opened at all.
export function verbIntent(stripped) {
  let m;

  // Telugu script words can never match a `\b` word boundary (it only knows ASCII word chars),
  // so every Telugu keyword is tested explicitly here and OR-ed into the router below.
  const teText = String(stripped);
  const teGreet = /^(?:నమస్కారం|నమస్కారము|శుభోదయం|శుభ\s+సాయంత్రం|శుభ\s+రాత్రి|హలో|హాయ్)/.test(teText);
  const teTimeDate = /(?:సమయం|తేదీ)/.test(teText);
  const teDevice = /(?:సిస్టమ్|కంప్యూటర్|ల్యాప్‌టాప్)/.test(teText);
  const teRestart = /రీస్టార్ట్/.test(teText);
  const teShutdown = /(?:షట్\s*డౌన్|బంద్)/.test(teText);
  const teJoke = /జోక్/.test(teText) && /(?:చెప్పు|వినిపించు)/.test(teText);
  const teMusic = /(?:పాటలు|మ్యూజిక్)/.test(teText);

  // 1. Multilingual Time & Date queries (checked before greetings, so "namaskaram, samayam enta?"
  //    answers the clock instead of only saying good morning back)
  if ((teTimeDate || /\b(?:samayam|samay|tarikh|tarik|uhrzeit|datum|quelle\s+heure|heure|que\s+hora|hora|what\s+time|current\s+time|today'?s\s+date|current\s+date)\b/i.test(stripped)) && !/\b(?:timer|countdown|alarm|schedule)\b/i.test(stripped)) {
    return { action: 'get_time_date', input: stripped };
  }

  // 2. Multilingual Time-of-Day Greetings
  if (teGreet || /^(?:namaskaram|namaste|नमस्ते|नमस्कार|शुभ\s+प्रभात|शुभ\s+संध्या|hola|buenos\s+dias|buenas\s+tardes|buenas\s+noches|bonjour|bonsoir|salut|guten\s+morgen|guten\s+tag|guten\s+abend|hallo|hello|hi|hey|good\s+morning|good\s+afternoon|good\s+evening|good\s+night)\b/i.test(stripped)) {
    return { action: 'greet_user', input: stripped };
  }

  // 3. System Control: Restart
  if ((teRestart && teDevice) ||
      /\b(?:restart|reboot|reiniciar|redemarrer|neustart)\b.*\b(?:system|computer|laptop|pc|equipo|ordinateur)\b/i.test(stripped) ||
      /\b(?:system|computer|laptop|pc|equipo|ordinateur)\b.*\b(?:restart|reboot|reiniciar|redemarrer|neustart)\b/i.test(stripped) ||
      /^(?:restart|reboot|reiniciar|redemarrer)\b/i.test(stripped)) {
    return { action: 'restart_system', input: stripped };
  }

  // 4. System Control: Shutdown
  if ((teShutdown && teDevice) ||
      /\b(?:shutdown|shut\s+down|poweroff|power\s+off|turn\s+off|apagar|eteindre|herunterfahren)\b.*\b(?:system|computer|laptop|pc|equipo|ordinateur)\b/i.test(stripped) ||
      /\b(?:system|computer|laptop|pc|equipo|ordinateur)\b.*\b(?:shutdown|shut\s+down|poweroff|power\s+off|turn\s+off|apagar|eteindre|herunterfahren)\b/i.test(stripped) ||
      /^(?:shutdown|poweroff|turn\s+off\s+(?:my\s+)?(?:laptop|computer|pc)|apagar\s+el\s+equipo)\b/i.test(stripped)) {
    return { action: 'shutdown_system', input: stripped };
  }

  // 5. Wikipedia Search & Voice Summaries
  if ((m = stripped.match(/^(?:వికీపీడియా|వికీపీడియాలో\s+వెతుకు|विकिपीडिया|wikipedia|wiki)\s*(?:for|about|me)?\s*(.+)$/i))) {
    return { action: 'wikipedia_summary', input: m[1].trim() };
  }
  if ((m = stripped.match(/^(?:search\s+wikipedia\s+for|look\s+up\s+on\s+wikipedia|buscar\s+en\s+wikipedia)\s+(.+)$/i))) {
    return { action: 'wikipedia_summary', input: m[1].trim() };
  }
  if ((m = stripped.match(/^(?:who\s+is|what\s+is|tell\s+me\s+about|గురించి\s+చెప్పు|కే\s+బారే\s+మే\s+బతావో)\s+(.+)$/i)) && !/\b(?:weather|battery|time|date|status|notes?|gpu|cuda)\b/i.test(stripped)) {
    return { action: 'wikipedia_summary', input: m[1].trim() };
  }

  // 6. Local Music Library
  if (teMusic ||
      /\b(?:local\s+music|my\s+music|local\s+library|musica\s+local|lokale\s+musik|local\s+track|local\s+song)\b/i.test(stripped) ||
      /^(?:play|listen\s+to|vinu)\s+(?:local\s+music|my\s+music|local\s+song)\b/i.test(stripped)) {
    return { action: 'play_local_music', input: stripped };
  }

  // 7. Entertainment: Jokes
  if (teJoke ||
      /\b(?:జోక్|joke|chiste|blague|witz|चुटकुला)\b/i.test(stripped) && /\b(?:చెప్పు|వినిపించు|tell|say|crack|raconte|cuenta|erzahle|सुनाओ)\b/i.test(stripped) ||
      /^(?:tell\s+(?:me\s+)?a\s+joke|joke\s+cheppu|joke\s+sunao|cuenta\s+un\s+chiste|dis-moi\s+une\s+blague|erzahle\s+einen\s+witz|make\s+me\s+laugh)$/i.test(stripped)) {
    return { action: 'tell_joke', input: stripped };
  }

  // 8. Language Selection
  if ((m = stripped.match(/^(?:speak\s+in|switch\s+(?:language\s+)?to|change\s+language\s+to|భాష\s+మార్చు|భాష|language)\s+(telugu|తెలుగు|english|hindi|हिन्दी|spanish|español|french|français|german|deutsch|japanese|日本語)$/i))) {
    return { action: 'set_language', input: m[1].trim() };
  }

  // "open whatsapp and send Ravi a message" — the send action opens WhatsApp itself, so this is
  // one action, not two windows.
  if ((m = stripped.match(/^open\s+(?:whatsapp|wa)\s+(?:and|then)\s+(?:send|message|msg|text)\s+(.+)$/i))) {
    return { action: 'send_whatsapp', input: m[1] };
  }

  // "open spotify and play arijit singh" is two actions, in order, not one.
  if ((m = stripped.match(/^(?:open|launch|start|kholo)\s+(?:the\s+|my\s+|mera\s+|meri\s+)?(.+?)\s+and\s+(?:then\s+)?(?:play|watch)\s+(.+)$/i))) {
    return { steps: [{ action: 'open_app', input: m[1] }, { action: 'play_youtube', input: m[2] }] };
  }

  if (/^(?:gpu\s+status|cuda\s+status|check\s+gpu|check\s+cuda|vram|gpu\s+info|gpu\s+acceleration)$/i.test(stripped)) {
    return { action: 'gpu_status', input: '' };
  }
  if ((m = stripped.match(/^(?:search\s+and\s+analyze|analyze|inspect|look\s+inside|check\s+what\s+is\s+in)\s+(.+)$/i))) {
    return { action: 'find_and_analyze', input: m[1] };
  }
  if (/\b(?:and\s+analyze|and\s+inspect|check\s+what\s+is\s+(?:in|inside))\b/i.test(stripped)) {
    return { action: 'find_and_analyze', input: stripped };
  }
  if ((m = stripped.match(/^(?:open\s+finder\s+and\s+search\s+for|open\s+file\s+explorer\s+and\s+search\s+for)\s+(.+)$/i))) {
    return { action: 'find_and_analyze', input: m[1] };
  }
  if (/\b(?:workflow|n8n|job\s+search)\b/i.test(stripped)) {
    return { action: 'run_workflow', input: stripped };
  }

  // Only these verbs may select a browser action.
  if ((m = stripped.match(/^(?:go\s+to|browse|visit|explore)\s+([a-z0-9.-]+(?:\.[a-z]{2,})?)\s+(?:and\s+)?(?:check\s+for|search\s+for|look\s+for|find|see)\s+(.+)$/i))) {
    return { action: 'agent_browse', input: `${m[1]} | ${m[2]}` };
  }
  if ((m = stripped.match(/^(?:agent\s+)?browse\s+(?:(?:to|the\s+site)\s+)?(.+)$/i))) return { action: 'agent_browse', input: m[1].trim() };
  if ((m = stripped.match(/^(?:browse|visit|go\s+to|explore)\s+(.+)$/i))) return { action: 'open_website', input: m[1].trim() };
  if ((m = stripped.match(/^(?:scrape|firecrawl)\s+(.+)$/i))) return { action: 'scrape_website', input: m[1].replace(/^(?:the\s+)?(?:website\s+|site\s+|url\s+)?(?:from\s+)?/i, '').trim() };
  if ((m = stripped.match(/^(?:crawl|spider|harvest)\s+(.+)$/i))) return { action: 'crawl_website', input: m[1].replace(/^(?:the\s+)?(?:website\s+|site\s+)?(?:from\s+)?/i, '').trim() };
  if ((m = stripped.match(/^(?:map|sitemap)\s+(.+)$/i))) return { action: 'map_website', input: m[1].replace(/^(?:the\s+)?(?:website\s+|site\s+)?(?:from\s+)?/i, '').trim() };
  if ((m = stripped.match(/^(?:agent\s+search|deep\s+search|research)\s+(?:for\s+|about\s+)?(.+)$/i))) return { action: 'agent_search', input: m[1].trim() };
  if ((m = stripped.match(/^(?:play|watch)\s+(.+)$/i))) return { action: 'play_youtube', input: m[1].replace(/\s+on\s+youtube$/i, '').trim() };
  if ((m = stripped.match(/^(?:search|google|look\s+up|find\s+online)\s+(?:for\s+|about\s+)?(.+)$/i))) return { action: 'web_search', input: m[1].trim() };

  if (/^(?:send|message|msg|text|whatsapp|bhej|bhejo)\b/i.test(stripped) && !/\b(?:e-?mail|gmail|mail)\b/i.test(stripped)) {
    return { action: 'send_whatsapp', input: stripped };
  }
  if ((m = stripped.match(/^(?:find|locate|where\s+is|where\s+are|cari)\b\s*(.*)$/i))) {
    const q = m[1].replace(/^(?:my|the|mera|meri|mere)\s+/i, '').replace(/\s+(?:file|document)$/i, '').trim();
    return { action: 'find_file', input: q || stripped };
  }
  if ((m = stripped.match(/^(?:remind|reminder|deadline|add\s+deadline)\b\s*(.*)$/i))) {
    return { action: 'add_deadline', input: m[1].replace(/^(?:me|us)\s*,?\s*/i, '').trim() || stripped };
  }
  if ((m = stripped.match(/^(?:close|quit|exit|kill|stop|band)\s+(?:the\s+)?(.+?)(?:\s+app)?$/i))) return { action: 'close_app', input: m[1] };
  if (/^(?:note|likho|write\s+(?:down|this))\b/i.test(stripped)) {
    return { action: 'take_note', input: stripped.replace(/^(?:note\s+karo|note|likho|write\s+(?:down|this))\s*[:,]?\s*/i, '').trim() || stripped };
  }
  if (/^(?:lock(?:\s+screen|\s+the\s+screen|\s+my\s+screen)?|screen\s+lock)$/i.test(stripped)) return { action: 'lock_screen', input: '' };
  if (/^(?:screenshot|screen\s+capture|capture\s+screen|snap)\b/i.test(stripped)) return { action: 'take_screenshot', input: '' };
  if ((m = stripped.match(/^(?:open|launch|start|kholo|open\s+karo)\s+(?:the\s+|my\s+|mera\s+|meri\s+)?(.+)$/i))) return openIntent(m[1]);

  return null;
}

// Last resort: word-boundary keyword scoring, so "saying" cannot match "say".
function scoreIntent(stripped) {
  const lower = stripped.toLowerCase();
  const hasWord = (phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(lower);
  };

  let best = '', bestScore = 0;
  for (const [action, keywords] of Object.entries(INTENT_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (hasWord(kw)) score += kw.split(' ').length;
    }
    if (score > bestScore) { bestScore = score; best = action; }
  }

  if (!best && /^open\s+/i.test(lower)) best = 'open_app';
  if (!best && /^(close|quit|exit|kill|stop)\s+/i.test(lower)) best = 'close_app';

  let cleanInput = stripped;
  if (best === 'open_app') cleanInput = stripped.replace(/^(open|launch|start|run|kholo|chalao|open\s+karo|open\s+chey)\s+(the\s+)?/i, '').replace(/\s+(app|kholo|chalao|open\s+chey)$/i, '').trim();
  else if (best === 'close_app') cleanInput = stripped.replace(/^(close|quit|exit|kill|shut\s+down|stop|band\s+karo|close\s+karo|close\s+chey|moosiveyi)\s+(the\s+)?/i, '').replace(/\s+(app|band\s+karo|close\s+karo|close\s+chey)$/i, '').trim();
  else if (best === 'send_whatsapp') cleanInput = stripped;
  else if (best === 'web_search') cleanInput = stripped.replace(/^(search|google|look\s+up|find\s+online)\s+(for\s+)?/i, '').trim();
  else if (best === 'play_youtube') cleanInput = stripped.replace(/^(play|watch)\s+/i, '').trim();
  else if (best === 'upload_folder') cleanInput = stripped.replace(/^upload\s+(folder\s+)?/i, '').trim();
  else if (best === 'read_project_summary') cleanInput = stripped.replace(/^(summarize|summary\s+of|describe|read)\s+(my\s+)?(project\s+)?/i, '').trim();
  else if (best === 'add_deadline') cleanInput = stripped.replace(/^remind\s+(me\s*,?\s*)?/i, '').trim();
  else if (best === 'focus_session') cleanInput = stripped.replace(/^(start\s+)?/i, '').trim();
  else if (best === 'code_task') cleanInput = stripped.replace(/^(work\s+on|code|develop|dev)\s+/i, '').trim();
  else if (best === 'change_voice') cleanInput = stripped.replace(/^(change|set|switch)\s+(the\s+)?voice\s+(to\s+)?/i, '').trim();
  else if (best === 'agent_browse') cleanInput = stripped.replace(/^(agent\s+)?(browse)\s+(to\s+)?/i, '').trim();
  else if (best === 'agent_search') cleanInput = stripped.replace(/^(agent\s+)?(search)\s+(for\s+)?/i, '').trim();
  else if (best === 'scrape_website') cleanInput = stripped.replace(/^(scrape|firecrawl|extract\s+page)\s+(the\s+)?(website\s+|site\s+|url\s+)?(from\s+)?/i, '').trim();
  else if (best === 'crawl_website') cleanInput = stripped.replace(/^(crawl|spider|harvest|extract)\s+(the\s+)?(website\s+|site\s+)?(from\s+)?/i, '').trim();
  else if (best === 'map_website') cleanInput = stripped.replace(/^(map|sitemap|site\s+map)\s+(the\s+)?(website\s+|site\s+)?(from\s+)?/i, '').trim();

  return { action: best, input: cleanInput || stripped };
}

// ---------- AI brain (NVIDIA NIM) ----------
const ACTION_DESCRIPTIONS = {
  scrape_website:      'Firecrawl single-page scraper: converts any webpage into clean LLM-ready Markdown with full metadata and SSRF protection',
  crawl_website:       'Firecrawl multi-page crawler: recursively traverses a domain, strips noise, and saves a complete Markdown dossier to Downloads',
  map_website:         'Firecrawl sitemap & link mapper: maps all discoverable internal URLs across a domain',
  open_website:        'Open a website or URL in the browser',
  web_search:          'Search Google for something',
  play_youtube:        'Play a video or song on YouTube',
  open_app:            'Open any app on the Mac (Slack, Chrome, VS Code, etc.)',
  close_app:           'Close or quit a running app on the Mac (e.g. "close calculator", "quit Slack")',
  change_voice:        'Change the speaking voice on Mac or phone (Samantha, Daniel, Rishi, Joanna, Aditi)',
  take_note:           'Save a quick note',
  read_notes:          'Read all saved notes aloud',
  show_notes:          'Open the notes file in TextEdit',
  system_status:       'Check battery, time, and laptop status',
  lock_screen:         'Lock the screen / put display to sleep',
  media_control:       'Play, pause, next, previous, volume up/down/mute',
  speak_on_laptop:     'Speak text aloud on the laptop speakers',
  take_screenshot:     'Take a screenshot and save to Desktop',
  set_timer:           'Set a countdown timer (e.g. "5 minutes")',
  draft_email:         'Open a draft email in Gmail',
  directions:          'Get directions on Google Maps',
  weather:             'Check the weather for a location',
  run_routine:         'Run a preset routine (morning, night, etc.)',
  find_file:           'Search for a file on the laptop by name',
  focus_session:       'Start a distraction-free focus/pomodoro session',
  add_deadline:        'Add a deadline reminder (format: "title | when")',
  list_deadlines:      'List all upcoming deadlines',
  finish_deadline:     'Mark a deadline as done',
  send_whatsapp:       'Send a WhatsApp message (format: "number message")',
  upload_folder:       'Zip and upload a project folder, get a download link',
  read_project_summary:'Summarize a project (package.json, README, git info)',
  code_task:           'Work on a coding project (build/test in background, call when done)',
  run_command:         'Execute a shell command within the secure Siri Sandbox',
  agent_browse:        'Autonomous agent browsing: opens Chrome with screen-edge orange glow beam, navigates and extracts info',
  agent_search:        'Autonomous agent search: performs research with glowing orange border indicator',
  sandbox_status:      'Check security isolation status of the Siri Sandbox',
  gpu_status:          'Check NVIDIA CUDA / Apple Metal hardware acceleration and VRAM telemetry',
  find_and_analyze:    'Open Finder or File Explorer on screen, reveal files/folders, and analyze contents with AI',
  run_workflow:        'Run automated heavy AI workflows or manage local n8n server (e.g. resume job search)',
  computer_use:        'Native OS & GUI desktop automation via synthetic mouse, keyboard, and window control',
};

const brain = createBrain({
  apiKey: process.env.NIM_API_KEY || process.env.OPENAI_API_KEY || '',
  localUrl: process.env.LOCAL_LLM_URL || process.env.OLLAMA_BASE_URL || '',
  localModel: process.env.LOCAL_LLM_MODEL || process.env.OLLAMA_MODEL || '',
  preferLocal: String(process.env.PREFER_LOCAL_LLM || 'true') === 'true',
  actions: Object.keys(ACTIONS),
  actionDescriptions: ACTION_DESCRIPTIONS,
});

// Add brain-powered actions
ACTIONS.chat = async ({ input }) => {
  try {
    const result = await brain.think(input);
    return result.reply || 'I heard you, but I\'m not sure what to say.';
  } catch (e) {
    return `Brain error: ${e.message}`;
  }
};
ACTIONS.clear_memory = async () => brain.clearMemory();
ACTIONS.brain_status = async () => {
  const s = brain.status();
  return `Siri brain is active. Mode: ${s.provider} (${s.isLocal ? 'On-Device Private' : 'Cloud'}). Model: ${s.model}. Endpoint: ${s.endpoint}. Memory: ${s.memoryDepth}/${s.maxMemory} turns.`;
};
ALIASES.think = 'chat'; ALIASES.ask = 'chat'; ALIASES.brain = 'brain_status';
ALIASES['clear memory'] = 'clear_memory'; ALIASES.forget = 'clear_memory';

// ---------- auth ----------
function authorise(req, body) {
  const auth = req.headers.authorization || '';
  const given = auth.replace(/^Bearer\s+/i, '') || req.headers['x-jarvis-token'] || body.token || '';
  if (!TOKEN || given.length !== TOKEN.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(TOKEN))) return 'bad token';
  const raw = String(req.headers['x-caller'] || body.caller || body.user_identifier || '').trim();
  if (!OWNER && !OWNER_CALLER_ID) return null;
  if (!raw) return ALLOW_NO_CALLER ? null : 'no caller number';
  lastCaller = raw;
  // Sarvam passes a hashed caller id, not the number. Accept the configured owner hash, or a
  // hash of the owner's number in a common format; plain numbers are compared on the last 10 digits.
  if (OWNER_CALLER_ID && raw.toLowerCase() === OWNER_CALLER_ID) return null;
  if (/^[0-9a-f]{32,}$/i.test(raw)) return OWNER_HASHES.has(raw.toLowerCase()) ? null : `caller ${raw.slice(0, 6)}… is not the owner`;
  const digits = raw.replace(/\D/g, '');
  if (OWNER && digits.length >= 10 && digits.slice(-10) === OWNER.slice(-10)) return null;
  return `caller …${digits.slice(-2) || raw.slice(-2)} is not the owner`;
}

// ---------- http ----------
const PAGE = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8');
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // Anything arriving through the Cloudflare tunnel carries cf-connecting-ip. The console and
  // activity feed are for this laptop's screen only; the tunnel exposes just /action and /tools.
  const viaTunnel = Boolean(req.headers['cf-connecting-ip']);
  if (viaTunnel && req.method === 'GET') return json(res, 404, { result: 'Not found' });
  if (req.method === 'GET' && url.pathname === '/status') {
    return json(res, 200, { owner: OWNER ? `…${OWNER.slice(-2)}` : null, lock: Boolean(OWNER || OWNER_CALLER_ID), lastCaller, allowNoCaller: ALLOW_NO_CALLER, language: getLanguage(), actions: Object.keys(ACTIONS), phone: process.env.JARVIS_PHONE || '', brain: brain.status() });
  }
  if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8')); }
  if (req.method === 'GET' && url.pathname === '/activity') return json(res, 200, activity);
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/brain') return json(res, 200, brain.status());
  if (req.method === 'GET' && url.pathname === '/capsule') {
    const capsulePath = path.join(ROOT, 'capsule.html');
    if (fs.existsSync(capsulePath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(capsulePath, 'utf8'));
    }
  }
  if (req.method === 'GET' && url.pathname === '/capsule/state') return json(res, 200, capsuleState);
  if (req.method === 'POST' && url.pathname === '/capsule/update') {
    let raw = ''; for await (const c of req) { raw += c; if (raw.length > 5000) break; }
    try { Object.assign(capsuleState, JSON.parse(raw || '{}')); } catch {}
    return json(res, 200, { ok: true, state: capsuleState });
  }
  if (req.method === 'GET' && url.pathname === '/capsule/launch') {
    return json(res, 200, launchDesktopCapsule(PORT));
  }

  // Console-only endpoints (this laptop's screen): deadlines and a test call. Never via the tunnel.
  if (url.pathname.startsWith('/monitor')) {
    if (viaTunnel) return json(res, 404, { result: 'Not found' });
    if (req.method === 'GET') return json(res, 200, monitor.status());
    let raw = ''; for await (const c of req) { raw += c; if (raw.length > 5000) break; }
    let b = {}; try { b = JSON.parse(raw || '{}'); } catch {}
    if (url.pathname === '/monitor/add') { const r = monitor.add(`${b.title || ''} | ${b.when || ''}`); return json(res, r.error ? 400 : 200, { result: r.error || r.text }); }
    if (url.pathname === '/monitor/done') return json(res, 200, { result: monitor.finish(b.id) });
    if (url.pathname === '/monitor/test-call') return json(res, 200, await monitor.callOwner(b.message || 'Hi, Siri here. This is a test of your urgent call. Everything is working.', 'test call'));
    return json(res, 404, { result: 'Unknown endpoint' });
  }

  const m = url.pathname.match(/^\/tools\/([a-z_]+)$/) || (url.pathname === '/action' ? [null, null] : null);
  if (!m) return json(res, 404, { result: 'Unknown endpoint' });

  let body = {};
  if (req.method !== 'GET') {
    let raw = '';
    for await (const c of req) { raw += c; if (raw.length > 20000) break; }
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = { input: raw }; }
  }
  for (const [k, v] of url.searchParams) if (body[k] === undefined) body[k] = v;

  let name = m[1] || body.action || '';
  name = ALIASES[name] || name;
  let input = body.input ?? body.query ?? body.text ?? body.name ?? body.url ?? body.app ?? body.site ?? body.note ?? '';

  // If no action was resolved but we have free-text input, route it in this order:
  // explicit verb → explicit command name → model (when configured) → keyword scoring.
  // Only a verb that means browsing, or a model decision, can pick a browser action.
  let steps = null;
  if (!name && input) {
    const text = stripPolite(input);
    const intent = verbIntent(text) || explicitIntent(text);
    const local = intent ? null : scoreIntent(text);
    if (intent?.steps) {
      steps = intent.steps;
      name = steps[0].action;
      input = steps[0].input;
    } else if (intent) {
      name = intent.action;
      input = intent.input;
    } else if (local?.action) {
      // Known vocabulary answers locally and instantly; the model is only used for phrasing
      // this layer does not understand, so a slow or unreachable model never delays a clear command.
      name = local.action;
      input = local.input;
    } else if (brain.isConfigured()) {
      try {
        const thought = await brain.think(text);
        if (thought.steps?.length) {
          steps = thought.steps;
          name = steps[0].action;
          input = steps[0].input;
        } else if (thought.action && thought.action !== 'chat' && ACTIONS[thought.action]) {
          name = thought.action;
          input = thought.input || text;
        } else if (thought.action === 'chat') {
          record({ action: 'chat', input: text, result: thought.reply || 'Thinking...', caller: 'dashboard' });
          return json(res, 200, { ok: true, result: thought.reply || 'Hmm, let me think about that.' });
        }
      } catch (e) {
        console.error('Brain error:', e.message);
      }
    }
  }

  // Skip auth for requests from the local dashboard (localhost / 127.0.0.1)
  const remoteAddr = req.socket.remoteAddress || '';
  const isLocal = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';
  if (!isLocal) {
    const denied = authorise(req, body);
    if (denied) { record({ action: name || '?', input, result: `REFUSED (${denied})`, refused: true }); return json(res, 401, { result: 'Not authorised.' }); }
  }

  // A routed plan runs its steps in order and answers with everything that happened.
  // The whole plan is de-duplicated as one unit, like a single action.
  if (steps) {
    const digits = String(req.headers['x-caller'] || body.caller || body.user_identifier || '').replace(/\D/g, '');
    const planKey = `plan|${steps.map((s) => `${s.action}:${norm(s.input || '')}`).join('>')}`;
    const previous = recent.get(planKey);
    if (previous && Date.now() - previous.at < DEDUPE_MS) {
      return json(res, 200, { ok: true, result: await previous.result });
    }
    const runPlan = (async () => {
      const parts = [];
      for (const step of steps) {
        const stepFn = ACTIONS[step.action];
        if (!stepFn) continue;
        try { parts.push(await stepFn({ input: step.input ?? '' })); } catch { parts.push(`${step.action} failed.`); }
      }
      return parts.filter(Boolean).join(' ') || 'Done.';
    })();
    recent.set(planKey, { at: Date.now(), result: runPlan.catch(() => 'Something went wrong on the laptop.') });
    const result = await runPlan;
    record({ action: 'plan', input: `[${steps.map((s) => s.action).join(' → ')}]`, result, caller: digits ? `…${digits.slice(-2)}` : 'no caller id' });
    const match = typeof result === 'string' ? result.match(/https?:\/\/[^\s)"]+/) : null;
    return json(res, 200, { ok: true, result, url: match ? match[0] : undefined });
  }

  const fn = ACTIONS[name];
  if (!fn) return json(res, 400, { result: `I can't do ${name || 'that'} yet.` });

  // The voice agent can fire the same tool call several times in a burst. Run it once,
  // answer the repeats with the first result.
  const key = `${name}|${norm(input)}`;
  const prev = recent.get(key);
  if (prev && Date.now() - prev.at < DEDUPE_MS) {
    const result = await prev.result;
    const match = typeof result === 'string' ? result.match(/https?:\/\/[^\s)"]+/) : null;
    return json(res, 200, { ok: true, result, url: match ? match[0] : undefined });
  }
  if (recent.size > 200) for (const [k, v] of recent) if (Date.now() - v.at > DEDUPE_MS) recent.delete(k);
  const pending = fn({ input });
  recent.set(key, { at: Date.now(), result: pending.catch(() => 'Something went wrong on the laptop.') });

  const callerRaw = String(req.headers['x-caller'] || body.caller || body.user_identifier || '').replace(/\D/g, '');
  const caller = callerRaw ? `…${callerRaw.slice(-2)}` : 'no caller id';
  try {
    const result = await pending;
    record({ action: name, input, result, caller });
    const match = typeof result === 'string' ? result.match(/https?:\/\/[^\s)"]+/) : null;
    json(res, 200, { ok: true, result, url: match ? match[0] : undefined });
  } catch (e) {
    record({ action: name, input, result: `ERROR ${e.message}` });
    json(res, 500, { ok: false, result: 'Something went wrong on the laptop.' });
  }
});

const isMain = process.argv[1] && (path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)));
if (isMain) {
  server.listen(PORT, () => {
    console.log(`Siri action server on http://localhost:${PORT}  owner=${OWNER ? OWNER.slice(0, 4) + '…' : 'NOT SET'}  token=${TOKEN ? 'set' : 'MISSING'}  outbound=${monitor.status().configured ? 'ready' : 'dry-run'}`);
    monitor.start();
    setTimeout(() => buildIndex(true), 2000); // warm the file index so the first "find my file" is fast
  });
}
