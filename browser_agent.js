// browser_agent.js - Autonomous Browser Agent with Antigravity-Style Screen-Edge Blue Glow
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function findChromeExecutable() {
  const platform = process.platform;
  const candidates = [];

  if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(os.homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else if (platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

    candidates.push(
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
    );
  } else {
    // Linux
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium'
    );
  }

  for (const bin of candidates) {
    if (bin && fs.existsSync(bin)) return bin;
  }
  return null;
}

const CHROME_PATH = findChromeExecutable() || (process.platform === 'win32' ? 'chrome.exe' : 'google-chrome');
// Chrome 136+ refuses --remote-debugging-port on the default profile, so the agent needs its own.
// Keeping it in the home directory (instead of tmp) means a login survives restarts and updates.
const PROFILE_DIR = path.join(os.homedir(), '.siri', 'agent-profile');
const CDP_PORT = 9222;

let chromeProcess = null;
let currentWs = null;
let messageId = 1;
const pendingRequests = new Map();

// Antigravity-style Orange Light Perimeter Injected Script
const ORANGE_LIGHT_GLOW_SCRIPT = `
(() => {
  if (document.getElementById('siri-agent-glow')) return;
  const overlay = document.createElement('div');
  overlay.id = 'siri-agent-glow';
  overlay.innerHTML = \`
    <style>
      #siri-agent-glow {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        pointer-events: none !important;
        z-index: 2147483645 !important;
        box-shadow: 
          inset 0 0 0 4px #ea580c,
          inset 0 0 40px rgba(234, 88, 12, 0.75),
          inset 0 0 100px rgba(234, 88, 12, 0.35) !important;
        animation: siriOrangeGlowPulse 2.2s cubic-bezier(0.4, 0, 0.6, 1) infinite alternate !important;
      }
      @keyframes siriOrangeGlowPulse {
        0% { opacity: 0.65; filter: drop-shadow(0 0 10px #ea580c); }
        100% { opacity: 1.0; filter: drop-shadow(0 0 28px #ea580c); }
      }
      #siri-agent-banner {
        position: fixed !important;
        top: 14px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        background: rgba(10, 10, 10, 0.94) !important;
        border: 1px solid rgba(234, 88, 12, 0.8) !important;
        color: #ffffff !important;
        font-family: "Outfit", -apple-system, BlinkMacSystemFont, sans-serif !important;
        font-size: 11px !important;
        font-weight: 700 !important;
        letter-spacing: 0.16em !important;
        padding: 6px 20px !important;
        border-radius: 9999px !important;
        box-shadow: 0 8px 32px rgba(234, 88, 12, 0.4) !important;
        pointer-events: none !important;
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        z-index: 2147483647 !important;
      }
      .siri-glow-beacon {
        width: 8px !important;
        height: 8px !important;
        border-radius: 50% !important;
        background: #ea580c !important;
        box-shadow: 0 0 12px #ea580c !important;
      }
    </style>
    <div id="siri-agent-banner">
      <span class="siri-glow-beacon"></span>
      <span>SIRI AUTONOMOUS AGENT ACTIVE</span>
    </div>
  \`;
  document.documentElement.appendChild(overlay);
})()
`;

// Vectorized Rounded Cursor & Floating Keyboard Peripherals Script
const CURSOR_AND_KEYBOARD_SCRIPT = `
(() => {
  if (document.getElementById('siri-peripherals-root')) return;

  const root = document.createElement('div');
  root.id = 'siri-peripherals-root';
  root.innerHTML = \`
    <style>
      #siri-peripherals-root {
        position: fixed !important;
        inset: 0 !important;
        pointer-events: none !important;
        z-index: 2147483646 !important;
        font-family: "Outfit", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      }

      /* ── Custom Rounded Cursor Component ── */
      #siri-agent-cursor {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 32px !important;
        height: 38px !important;
        pointer-events: none !important;
        z-index: 2147483647 !important;
        transform: translate3d(140px, 180px, 0);
        transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease !important;
        will-change: transform !important;
        filter: drop-shadow(0 6px 16px rgba(0, 0, 0, 0.6)) drop-shadow(0 0 12px rgba(234, 88, 12, 0.45)) !important;
      }

      #siri-agent-cursor svg {
        width: 100% !important;
        height: 100% !important;
        overflow: visible !important;
        transform-origin: 0 0 !important;
        transition: transform 0.14s ease !important;
      }

      #siri-agent-cursor.clicking svg {
        transform: scale(0.85) !important;
      }

      .siri-cursor-ripple {
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        width: 12px !important;
        height: 12px !important;
        border-radius: 50% !important;
        border: 2px solid #ea580c !important;
        background: rgba(234, 88, 12, 0.35) !important;
        transform: translate(-50%, -50%) scale(0.2) !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      .siri-cursor-ripple.active {
        animation: siriRipplePulse 0.55s cubic-bezier(0.1, 0.8, 0.3, 1) forwards !important;
      }

      @keyframes siriRipplePulse {
        0% { transform: translate(-50%, -50%) scale(0.2); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(3.5); opacity: 0; }
      }

      .siri-cursor-pill {
        position: absolute !important;
        left: 24px !important;
        top: 24px !important;
        background: rgba(12, 12, 12, 0.95) !important;
        border: 1px solid rgba(234, 88, 12, 0.75) !important;
        color: #ffffff !important;
        padding: 4px 10px !important;
        border-radius: 9999px !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        letter-spacing: 0.04em !important;
        white-space: nowrap !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.7) !important;
        pointer-events: none !important;
      }

      .siri-cursor-dot {
        width: 6px !important;
        height: 6px !important;
        border-radius: 50% !important;
        background: #ea580c !important;
        box-shadow: 0 0 8px #ea580c !important;
      }

      /* ── Virtual Keyboard Component ── */
      #siri-virtual-keyboard {
        position: fixed !important;
        bottom: 24px !important;
        left: 50% !important;
        transform: translate3d(-50%, 140%, 0) !important;
        background: rgba(12, 12, 12, 0.94) !important;
        backdrop-filter: blur(20px) !important;
        -webkit-backdrop-filter: blur(20px) !important;
        border: 1px solid rgba(234, 88, 12, 0.5) !important;
        border-radius: 18px !important;
        padding: 14px 18px !important;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.85), 0 0 32px rgba(234, 88, 12, 0.2) !important;
        z-index: 2147483647 !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 8px !important;
        transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease !important;
        pointer-events: none !important;
        opacity: 0 !important;
        max-width: 580px !important;
        width: 90% !important;
      }

      #siri-virtual-keyboard.visible {
        transform: translate3d(-50%, 0, 0) !important;
        opacity: 1 !important;
      }

      .siri-kb-header {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        padding-bottom: 6px !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
      }

      .siri-kb-title {
        font-size: 11px !important;
        font-weight: 700 !important;
        letter-spacing: 0.12em !important;
        color: #ea580c !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
      }

      .siri-kb-buffer {
        font-family: "JetBrains Mono", monospace !important;
        font-size: 12px !important;
        color: #ffffff !important;
        background: rgba(255, 255, 255, 0.08) !important;
        padding: 3px 9px !important;
        border-radius: 6px !important;
        max-width: 320px !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
      }

      .siri-kb-rows {
        display: flex !important;
        flex-direction: column !important;
        gap: 6px !important;
      }

      .siri-kb-row {
        display: flex !important;
        gap: 5px !important;
        justify-content: center !important;
      }

      .siri-kb-key {
        background: #181818 !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        color: #e0e0e0 !important;
        border-radius: 7px !important;
        height: 32px !important;
        min-width: 28px !important;
        padding: 0 8px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        transition: all 0.12s ease !important;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4) !important;
      }

      .siri-kb-key.key-wide { min-width: 46px !important; }
      .siri-kb-key.key-space { min-width: 160px !important; }

      .siri-kb-key.key-active {
        background: #ea580c !important;
        color: #000000 !important;
        font-weight: 800 !important;
        border-color: #fb923c !important;
        transform: scale(0.92) translateY(1px) !important;
        box-shadow: 0 0 16px rgba(234, 88, 12, 0.9) !important;
      }
    </style>

    <!-- Rounded Vector Cursor Component -->
    <div id="siri-agent-cursor">
      <div class="siri-cursor-ripple" id="siri-cursor-ripple"></div>
      <svg viewBox="0 0 100 120" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M11.6,0.0 L5.3,2.9 L1.0,8.9 L0.0,15.2 L0.3,21.5 L0.7,27.8 L1.0,34.1 L1.4,40.4 L1.5,46.7 L1.9,53.0 L2.2,59.3 L2.6,65.6 L2.9,71.9 L3.1,78.2 L3.4,84.5 L3.7,90.8 L4.1,97.1 L4.4,103.4 L4.8,109.7 L7.7,115.8 L13.5,119.6 L19.8,119.6 L26.1,115.8 L30.7,109.9 L35.3,103.6 L39.9,97.4 L44.5,91.8 L50.3,87.6 L56.6,85.2 L62.9,84.7 L69.2,84.7 L75.5,84.7 L81.8,84.7 L88.1,84.7 L94.4,82.8 L99.1,77.2 L100.0,70.9 L97.3,64.7 L91.0,59.3 L84.8,54.2 L79.0,49.4 L73.3,44.6 L67.3,39.7 L61.5,34.9 L55.4,29.8 L49.1,24.7 L42.8,19.4 L37.0,14.7 L31.2,9.9 L25.4,5.1 L19.1,0.9 L12.8,0.0 Z"
              fill="#000000"
              stroke="#ffffff"
              stroke-width="3"
              stroke-linejoin="round" />
        <path d="M14,6 L7,24 L10,95 L20,105 L35,88 L85,74 L90,69 Z"
              fill="rgba(234, 88, 12, 0.15)" />
      </svg>
      <div class="siri-cursor-pill" id="siri-cursor-pill">
        <span class="siri-cursor-dot"></span>
        <span id="siri-cursor-text">Siri Agent</span>
      </div>
    </div>

    <!-- Virtual Keyboard Component -->
    <div id="siri-virtual-keyboard">
      <div class="siri-kb-header">
        <div class="siri-kb-title">
          <span class="siri-cursor-dot"></span>
          <span>SIRI AUTONOMOUS KEYBOARD</span>
        </div>
        <div class="siri-kb-buffer" id="siri-kb-buffer">Ready</div>
      </div>
      <div class="siri-kb-rows">
        <div class="siri-kb-row">
          <div class="siri-kb-key" data-key="1">1</div>
          <div class="siri-kb-key" data-key="2">2</div>
          <div class="siri-kb-key" data-key="3">3</div>
          <div class="siri-kb-key" data-key="4">4</div>
          <div class="siri-kb-key" data-key="5">5</div>
          <div class="siri-kb-key" data-key="6">6</div>
          <div class="siri-kb-key" data-key="7">7</div>
          <div class="siri-kb-key" data-key="8">8</div>
          <div class="siri-kb-key" data-key="9">9</div>
          <div class="siri-kb-key" data-key="0">0</div>
          <div class="siri-kb-key key-wide" data-key="Backspace">⌫</div>
        </div>
        <div class="siri-kb-row">
          <div class="siri-kb-key" data-key="q">Q</div>
          <div class="siri-kb-key" data-key="w">W</div>
          <div class="siri-kb-key" data-key="e">E</div>
          <div class="siri-kb-key" data-key="r">R</div>
          <div class="siri-kb-key" data-key="t">T</div>
          <div class="siri-kb-key" data-key="y">Y</div>
          <div class="siri-kb-key" data-key="u">U</div>
          <div class="siri-kb-key" data-key="i">I</div>
          <div class="siri-kb-key" data-key="o">O</div>
          <div class="siri-kb-key" data-key="p">P</div>
        </div>
        <div class="siri-kb-row">
          <div class="siri-kb-key" data-key="a">A</div>
          <div class="siri-kb-key" data-key="s">S</div>
          <div class="siri-kb-key" data-key="d">D</div>
          <div class="siri-kb-key" data-key="f">F</div>
          <div class="siri-kb-key" data-key="g">G</div>
          <div class="siri-kb-key" data-key="h">H</div>
          <div class="siri-kb-key" data-key="j">J</div>
          <div class="siri-kb-key" data-key="k">K</div>
          <div class="siri-kb-key" data-key="l">L</div>
          <div class="siri-kb-key key-wide" data-key="Enter">⏎</div>
        </div>
        <div class="siri-kb-row">
          <div class="siri-kb-key" data-key="z">Z</div>
          <div class="siri-kb-key" data-key="x">X</div>
          <div class="siri-kb-key" data-key="c">C</div>
          <div class="siri-kb-key" data-key="v">V</div>
          <div class="siri-kb-key key-space" data-key=" ">SPACE</div>
          <div class="siri-kb-key" data-key="b">B</div>
          <div class="siri-kb-key" data-key="n">N</div>
          <div class="siri-kb-key" data-key="m">M</div>
        </div>
      </div>
    </div>
  \`;

  document.documentElement.appendChild(root);

  window.__siriAgent = {
    cursor: document.getElementById('siri-agent-cursor'),
    ripple: document.getElementById('siri-cursor-ripple'),
    label: document.getElementById('siri-cursor-text'),
    keyboard: document.getElementById('siri-virtual-keyboard'),
    buffer: document.getElementById('siri-kb-buffer'),

    moveTo(x, y, text) {
      if (!this.cursor) return;
      this.cursor.style.transform = \`translate3d(\${x}px, \${y}px, 0)\`;
      if (text && this.label) this.label.textContent = text;
    },

    click(x, y, text) {
      if (x !== undefined && y !== undefined) this.moveTo(x, y, text || 'Clicking');
      if (this.cursor) {
        this.cursor.classList.add('clicking');
        setTimeout(() => this.cursor.classList.remove('clicking'), 160);
      }
      if (this.ripple) {
        this.ripple.classList.remove('active');
        void this.ripple.offsetWidth;
        this.ripple.classList.add('active');
      }
    },

    scroll(amount, text) {
      if (this.label) this.label.textContent = text || (amount > 0 ? 'Scrolling ↓' : 'Scrolling ↑');
      window.scrollBy({ top: amount, behavior: 'smooth' });
    },

    setKeyboardVisible(visible) {
      if (!this.keyboard) return;
      if (visible) this.keyboard.classList.add('visible');
      else this.keyboard.classList.remove('visible');
    },

    pressKey(char) {
      const lower = char.toLowerCase();
      const el = document.querySelector(\`.siri-kb-key[data-key="\${lower}"]\`) ||
                 document.querySelector(\`.siri-kb-key[data-key="\${char}"]\`);
      if (el) {
        el.classList.add('key-active');
        setTimeout(() => el.classList.remove('key-active'), 180);
      }
      if (this.buffer) {
        if (char === 'Backspace') this.buffer.textContent = this.buffer.textContent.slice(0, -1);
        else if (char.length === 1) this.buffer.textContent = (this.buffer.textContent === 'Ready' ? '' : this.buffer.textContent) + char;
      }
    }
  };
})();
`;

/**
 * Ensures Google Chrome is running in CDP automation mode.
 */
async function ensureChrome() {
  // Test if port 9222 is already open
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) return true;
  } catch {}

  // Spawn Chrome cleanly using macOS open to prevent CoreUI EXC_BREAKPOINT crash
  try { fs.mkdirSync(PROFILE_DIR, { recursive: true }); } catch {}

  const chromeBin = findChromeExecutable() || CHROME_PATH;

  if (process.platform === 'darwin') {
    // Check if Google Chrome app exists for standard open invocation
    if (fs.existsSync('/Applications/Google Chrome.app')) {
      chromeProcess = spawn('/usr/bin/open', [
        '-na',
        'Google Chrome',
        '--args',
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${PROFILE_DIR}`,
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank'
      ], { detached: true, stdio: 'ignore' });
      if (chromeProcess) chromeProcess.unref();
    } else if (chromeBin) {
      chromeProcess = spawn(chromeBin, [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${PROFILE_DIR}`,
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank'
      ], { detached: true, stdio: 'ignore' });
      if (chromeProcess) chromeProcess.unref();
    }
  } else if (chromeBin) {
    chromeProcess = spawn(chromeBin, [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank'
    ], { detached: true, stdio: 'ignore' });
    if (chromeProcess) chromeProcess.unref();
  }

  // Wait for CDP endpoint to become ready
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 250));
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {}
  }
  return false;
}

/**
 * Connects to the active Chrome tab over WebSocket.
 */
async function getPageConnection() {
  const ready = await ensureChrome();
  if (!ready) throw new Error('Chrome automation CDP endpoint unavailable.');
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error('Could not fetch active Chrome tabs.');
  const tabs = await res.json();
  const pageTab = tabs.find(t => t.type === 'page') || tabs[0];
  if (!pageTab || !pageTab.webSocketDebuggerUrl) {
    // Open a new tab
    const newTabRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' });
    const tab = await newTabRes.json();
    return connectWs(tab.webSocketDebuggerUrl);
  }

  if (currentWs && currentWs.readyState === WebSocket.OPEN) {
    return currentWs;
  }

  return connectWs(pageTab.webSocketDebuggerUrl);
}

function connectWs(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      currentWs = ws;
      resolve(ws);
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id && pendingRequests.has(msg.id)) {
          const { res, rej } = pendingRequests.get(msg.id);
          pendingRequests.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message || 'CDP Error'));
          else res(msg.result);
        }
      } catch {}
    };
    ws.onerror = (e) => reject(e);
  });
}

/**
 * Sends a Chrome DevTools Protocol command.
 */
function sendCdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = messageId++;
    pendingRequests.set(id, { res: resolve, rej: reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`CDP command ${method} timed out.`));
      }
    }, 15000);
  });
}

/**
 * Autonomous Browser Agent: Navigates to a page, injects blue glow light, and extracts intelligence.
 * @param {string} targetUrl 
 * @param {string} [goal] 
 * @returns {Promise<{ ok: boolean, title: string, textSummary: string, url: string }>}
 */
export async function browsePage(targetUrl, goal = '') {
  let url = targetUrl.replace(/^(agent\s+)?(browse)\s+(to\s+)?/i, '').trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  const ws = await getPageConnection();

  // 1. Navigate to target URL
  await sendCdp(ws, 'Page.enable');
  await sendCdp(ws, 'Page.navigate', { url });

  // Wait 2.5 seconds for page load
  await new Promise(r => setTimeout(r, 2500));

  // 2. Inject Antigravity-style Orange Glow and Peripherals (Cursor + Keyboard)
  await sendCdp(ws, 'Runtime.evaluate', { expression: ORANGE_LIGHT_GLOW_SCRIPT });
  await sendCdp(ws, 'Runtime.evaluate', { expression: CURSOR_AND_KEYBOARD_SCRIPT });

  // 3. Realistic agent browsing actions: move cursor, click with ripple, smooth scroll
  try {
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `
        (() => {
          if (!window.__siriAgent) return;
          const w = window.innerWidth, h = window.innerHeight;
          window.__siriAgent.moveTo(Math.round(w * 0.35), Math.round(h * 0.28), 'Browsing webpage');
        })()
      `
    });
    await new Promise(r => setTimeout(r, 600));

    // Smooth click with ripple
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `window.__siriAgent?.click(undefined, undefined, 'Inspecting DOM');`
    });
    await new Promise(r => setTimeout(r, 500));

    // Smooth scroll down to read content
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `window.__siriAgent?.scroll(420, 'Reading content ↓');`
    });
    await new Promise(r => setTimeout(r, 800));

    // Smooth scroll deeper
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `window.__siriAgent?.scroll(380, 'Analyzing sections ↓');`
    });
    await new Promise(r => setTimeout(r, 700));

    // Return to top
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `window.__siriAgent?.scroll(-800, 'Consolidating knowledge ↑');`
    });
    await new Promise(r => setTimeout(r, 500));
  } catch {}

  // 4. Extract high-level content from the page
  const extractionResult = await sendCdp(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const title = document.title || '';
        const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
        const headings = Array.from(document.querySelectorAll('h1, h2, h3')).slice(0, 10).map(h => h.innerText.trim()).filter(Boolean);
        const paragraphs = Array.from(document.querySelectorAll('p')).slice(0, 8).map(p => p.innerText.trim()).filter(p => p.length > 25);
        return {
          title,
          metaDesc,
          headings,
          paragraphs: paragraphs.slice(0, 4),
          url: window.location.href
        };
      })()
    `,
    returnByValue: true
  });

  const val = extractionResult?.result?.value || {};
  const summaryParts = [
    val.title ? `Page: "${val.title}"` : '',
    val.metaDesc ? `Description: ${val.metaDesc}` : '',
    val.headings?.length ? `Key Topics: ${val.headings.join(' • ')}` : '',
    val.paragraphs?.length ? val.paragraphs.join(' ') : ''
  ].filter(Boolean);

  return {
    ok: true,
    title: val.title || 'Webpage Loaded',
    url: val.url || url,
    textSummary: summaryParts.join('\n\n').slice(0, 1200) || 'Loaded page with active blue glow indicator.'
  };
}

/**
 * Autonomous Multi-Page Web Crawler & Knowledge Harvester
 * Crawls a seed URL and internal links, extracting structured content with orange edge glow.
 * @param {string} startUrl 
 * @param {number} [maxPages=3]
 * @returns {Promise<{ ok: boolean, seedUrl: string, totalPages: number, pages: Array<{ title: string, url: string, content: string }>, report: string }>}
 */
export async function crawlWebsite(startUrl, maxPages = 3) {
  let url = startUrl.replace(/^(crawl|scrape|extract)\s+(from\s+)?/i, '').trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  let origin = '';
  try { origin = new URL(url).origin; } catch { origin = url; }

  const ws = await getPageConnection();
  await sendCdp(ws, 'Page.enable');

  const visitedUrls = new Set();
  const queue = [url];
  const pagesData = [];

  while (queue.length > 0 && pagesData.length < maxPages) {
    const current = queue.shift();
    if (!current || visitedUrls.has(current)) continue;
    visitedUrls.add(current);

    try {
      // 1. Navigate
      await sendCdp(ws, 'Page.navigate', { url: current });
      await new Promise(r => setTimeout(r, 2200));

      // 2. Inject Antigravity-style Orange Glow and Visual Peripherals (Cursor + Keyboard)
      await sendCdp(ws, 'Runtime.evaluate', { expression: ORANGE_LIGHT_GLOW_SCRIPT });
      await sendCdp(ws, 'Runtime.evaluate', { expression: CURSOR_AND_KEYBOARD_SCRIPT });

      // 3. Autonomous visual agent actions: glide cursor, click, inertia scroll to harvest
      try {
        const pageIdx = pagesData.length + 1;
        await sendCdp(ws, 'Runtime.evaluate', {
          expression: `
            (() => {
              if (!window.__siriAgent) return;
              const w = window.innerWidth, h = window.innerHeight;
              window.__siriAgent.moveTo(Math.round(w * 0.35), Math.round(h * 0.25), 'Crawling page [${pageIdx}]');
            })()
          `
        });
        await new Promise(r => setTimeout(r, 500));

        // Click with ripple
        await sendCdp(ws, 'Runtime.evaluate', {
          expression: `window.__siriAgent?.click(undefined, undefined, 'DOM Synthesis');`
        });
        await new Promise(r => setTimeout(r, 400));

        // Smooth inertia scroll down to read and discover links
        await sendCdp(ws, 'Runtime.evaluate', {
          expression: `window.__siriAgent?.scroll(450, 'Harvesting content ↓');`
        });
        await new Promise(r => setTimeout(r, 700));

        await sendCdp(ws, 'Runtime.evaluate', {
          expression: `window.__siriAgent?.scroll(350, 'Mapping internal links ↓');`
        });
        await new Promise(r => setTimeout(r, 600));

        // Smooth scroll back
        await sendCdp(ws, 'Runtime.evaluate', {
          expression: `window.__siriAgent?.scroll(-800, 'Consolidating page ↑');`
        });
        await new Promise(r => setTimeout(r, 400));
      } catch {}

      // 4. Extract content & discover internal links
      const extraction = await sendCdp(ws, 'Runtime.evaluate', {
        expression: `
          (() => {
            const title = document.title || '';
            const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
              .slice(0, 8).map(h => h.innerText.trim()).filter(Boolean);
            const paragraphs = Array.from(document.querySelectorAll('p, article, section'))
              .map(p => p.innerText.trim())
              .filter(t => t.length > 40 && !t.includes('{') && !t.includes('cookie'))
              .slice(0, 6);
            
            // Find same-origin internal links
            const links = Array.from(document.querySelectorAll('a[href]'))
              .map(a => a.href)
              .filter(h => h.startsWith(window.location.origin) && !h.includes('#') && !h.endsWith('.pdf') && !h.endsWith('.zip'))
              .slice(0, 15);

            return {
              title,
              headings,
              paragraphs,
              links: Array.from(new Set(links)),
              url: window.location.href
            };
          })()
        `,
        returnByValue: true
      });

      const data = extraction?.result?.value;
      if (data) {
        pagesData.push({
          title: data.title || current,
          url: data.url || current,
          headings: data.headings || [],
          content: (data.paragraphs || []).join('\n\n')
        });

        // Add discovered links to queue
        if (data.links && pagesData.length < maxPages) {
          for (const link of data.links) {
            if (!visitedUrls.has(link) && !queue.includes(link)) {
              queue.push(link);
            }
          }
        }
      }
    } catch (err) {
      console.error(`Error crawling ${current}:`, err.message);
    }
  }

  // Format executive crawl dossier
  const reportLines = [
    `# Autonomous Crawl Dossier: ${origin}`,
    `Crawled ${pagesData.length} page(s) at ${new Date().toLocaleString('en-IN')}\n`,
  ];

  for (let i = 0; i < pagesData.length; i++) {
    const p = pagesData[i];
    reportLines.push(`## [Page ${i + 1}] ${p.title}`);
    reportLines.push(`URL: ${p.url}`);
    if (p.headings.length) reportLines.push(`Topics: ${p.headings.join(' • ')}`);
    if (p.content) reportLines.push(`Content:\n${p.content}\n`);
    reportLines.push('---');
  }

  return {
    ok: true,
    seedUrl: url,
    totalPages: pagesData.length,
    pages: pagesData,
    report: reportLines.join('\n')
  };
}

/**
 * Searches Google and navigates autonomously with the rounded cursor & keyboard peripherals.
 * @param {string} query 
 */
export async function agentSearch(query) {
  const ws = await getPageConnection();
  await sendCdp(ws, 'Page.enable');
  await sendCdp(ws, 'Page.navigate', { url: 'https://www.google.com' });
  await new Promise(r => setTimeout(r, 2000));

  // Inject glow + cursor & keyboard
  await sendCdp(ws, 'Runtime.evaluate', { expression: ORANGE_LIGHT_GLOW_SCRIPT });
  await sendCdp(ws, 'Runtime.evaluate', { expression: CURSOR_AND_KEYBOARD_SCRIPT });

  try {
    // 1. Move cursor to Google Search Input
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `
        (() => {
          const input = document.querySelector('textarea[name="q"], input[name="q"]');
          if (input) {
            const rect = input.getBoundingClientRect();
            window.__siriAgent?.moveTo(Math.round(rect.left + rect.width * 0.3), Math.round(rect.top + rect.height * 0.5), 'Targeting search input');
          } else {
            window.__siriAgent?.moveTo(window.innerWidth * 0.5, 300, 'Targeting search box');
          }
        })()
      `
    });
    await new Promise(r => setTimeout(r, 600));

    // 2. Click search input with ripple
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `
        (() => {
          const input = document.querySelector('textarea[name="q"], input[name="q"]');
          if (input) input.focus();
          window.__siriAgent?.click(undefined, undefined, 'Input focused');
        })()
      `
    });
    await new Promise(r => setTimeout(r, 400));

    // 3. Show virtual keyboard
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `window.__siriAgent?.setKeyboardVisible(true);`
    });
    await new Promise(r => setTimeout(r, 300));

    // 4. Type query character by character on the visual keyboard
    const chars = query.slice(0, 30);
    for (const char of chars) {
      await sendCdp(ws, 'Runtime.evaluate', {
        expression: `
          (() => {
            window.__siriAgent?.pressKey(${JSON.stringify(char)});
            const input = document.querySelector('textarea[name="q"], input[name="q"]');
            if (input) {
              input.value = (input.value || '') + ${JSON.stringify(char)};
              input.dispatchEvent(new Event('input', { bubbles: true }));
            }
          })()
        `
      });
      await new Promise(r => setTimeout(r, 65));
    }
    await new Promise(r => setTimeout(r, 400));

    // 5. Hide keyboard & execute search
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `
        (() => {
          window.__siriAgent?.setKeyboardVisible(false);
          window.__siriAgent?.moveTo(window.innerWidth * 0.5, 350, 'Executing query ⏎');
          window.__siriAgent?.click();
          const form = document.querySelector('form[role="search"], form[action*="search"]');
          if (form) form.submit();
        })()
      `
    });
    await new Promise(r => setTimeout(r, 2200));

    // Re-inject glow & cursor on search results page
    await sendCdp(ws, 'Runtime.evaluate', { expression: ORANGE_LIGHT_GLOW_SCRIPT });
    await sendCdp(ws, 'Runtime.evaluate', { expression: CURSOR_AND_KEYBOARD_SCRIPT });

    // 6. Smooth scroll through results with cursor indicator
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `window.__siriAgent?.scroll(500, 'Scanning search results ↓');`
    });
    await new Promise(r => setTimeout(r, 900));

    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `window.__siriAgent?.scroll(400, 'Evaluating top links ↓');`
    });
    await new Promise(r => setTimeout(r, 800));
  } catch (err) {
    console.error('Interactive search error, falling back:', err.message);
  }

  // 7. Extract search results
  const extractionResult = await sendCdp(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const title = document.title || '';
        const headings = Array.from(document.querySelectorAll('h3')).slice(0, 8).map(h => h.innerText.trim()).filter(Boolean);
        const snippets = Array.from(document.querySelectorAll('div[data-sncf], div.VwiC3b, span.aCOpRe')).slice(0, 5).map(s => s.innerText.trim()).filter(Boolean);
        return {
          title,
          headings,
          snippets,
          url: window.location.href
        };
      })()
    `,
    returnByValue: true
  });

  const val = extractionResult?.result?.value || {};
  return {
    ok: true,
    title: val.title || `Search: ${query}`,
    url: val.url || `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    textSummary: [
      `Search query: "${query}"`,
      val.headings?.length ? `Top Results:\n• ${val.headings.join('\n• ')}` : '',
      val.snippets?.length ? `Snippets:\n${val.snippets.slice(0, 3).join('\n\n')}` : ''
    ].filter(Boolean).join('\n\n')
  };
}

/**
 * Arbitrary Autonomous Agent Interaction Controller
 * @param {'click'|'scroll'|'type'|'move'} action
 * @param {object} params
 */
export async function agentInteract(action, params = {}) {
  const ws = await getPageConnection();
  await sendCdp(ws, 'Runtime.evaluate', { expression: CURSOR_AND_KEYBOARD_SCRIPT });

  if (action === 'move') {
    const { x = 200, y = 200, text = 'Moving cursor' } = params;
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `window.__siriAgent?.moveTo(${x}, ${y}, ${JSON.stringify(text)})`
    });
    return { ok: true, action: 'move', x, y };
  }

  if (action === 'click') {
    const { x, y, text = 'Click' } = params;
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `window.__siriAgent?.click(${x !== undefined ? x : 'undefined'}, ${y !== undefined ? y : 'undefined'}, ${JSON.stringify(text)})`
    });
    return { ok: true, action: 'click', x, y };
  }

  if (action === 'scroll') {
    const { deltaY = 400, text = 'Scrolling' } = params;
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `window.__siriAgent?.scroll(${deltaY}, ${JSON.stringify(text)})`
    });
    return { ok: true, action: 'scroll', deltaY };
  }

  if (action === 'type') {
    const { text = '', selector } = params;
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `window.__siriAgent?.setKeyboardVisible(true);`
    });
    for (const c of text) {
      await sendCdp(ws, 'Runtime.evaluate', {
        expression: `
          (() => {
            window.__siriAgent?.pressKey(${JSON.stringify(c)});
            ${selector ? `const el = document.querySelector(${JSON.stringify(selector)}); if (el) { el.value = (el.value || '') + ${JSON.stringify(c)}; el.dispatchEvent(new Event('input', {bubbles:true})); }` : ''}
          })()
        `
      });
      await new Promise(r => setTimeout(r, 60));
    }
    await new Promise(r => setTimeout(r, 500));
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `window.__siriAgent?.setKeyboardVisible(false);`
    });
    return { ok: true, action: 'type', text };
  }

  return { ok: false, error: 'Unknown action' };
}

/**
 * Dismisses or closes the agent browser session.
 */
export async function closeAgentBrowser() {
  if (currentWs) {
    try {
      await sendCdp(currentWs, 'Runtime.evaluate', {
        expression: `document.getElementById('siri-agent-glow')?.remove()`
      });
      currentWs.close();
    } catch {}
    currentWs = null;
  }
  if (chromeProcess) {
    try { chromeProcess.kill('SIGTERM'); } catch {}
    chromeProcess = null;
  }
  return { ok: true, message: 'Agent browser session closed.' };
}
