// sandbox.js - Execution Isolation & Safety Governance for Siri
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';

const WORKSPACE = path.resolve(process.cwd());
const SCRATCH_DIR = path.join(os.tmpdir(), 'siri-sandbox');

// Ensure scratch directory exists
try { fs.mkdirSync(SCRATCH_DIR, { recursive: true }); } catch {}

// Paths strictly forbidden from read/write/traversal across macOS, Windows, and Linux
const BLOCKED_PATH_PATTERNS = [
  /^\/System/i,
  /^\/Library/i,
  /^\/etc/i,
  /^\/private/i,
  /^[a-zA-Z]:\\Windows/i,
  /^[a-zA-Z]:\\ProgramData/i,
  /^[a-zA-Z]:\\System Volume Information/i,
  /\\SAM$/i,
  /\\SYSTEM$/i,
  /\.ssh([/\\].*)?$/i,
  /\.aws([/\\].*)?$/i,
  /\.gnupg([/\\].*)?$/i,
  /\.env$/i, // Protected from being leaked via general file inspection
  /id_rsa/i,
  /id_ed25519/i
];

// Dangerous destructive shell patterns across POSIX and Windows PowerShell/cmd
const DESTRUCTIVE_CMD_PATTERNS = [
  /\brm\s+-[rf]{1,2}\s+(\/|~|\$HOME|\*)/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, // Fork bomb
  />\s*\/dev\/[a-z0-9]+/i,
  /\bchmod\s+-R\s+777\s+\//i,
  /\bchown\s+-R\s+.*\s+\//i,
  /\bformat\s+[a-z]:/i,
  /\bdel\s+\/[sfq]/i,
  /\brmdir\s+\/[sfq]/i,
  /\bRemove-Item\s+.*-Recurse/i,
  /\bdiskpart\b/i,
  /\bbcdedit\b/i
];

/**
 * Validates whether a file path is permitted within the safe boundary.
 * @param {string} targetPath 
 * @returns {{ allowed: boolean, reason?: string, resolved: string }}
 */
export function validatePath(targetPath) {
  if (!targetPath) return { allowed: false, reason: 'Empty path', resolved: '' };
  const normalized = targetPath.replace(/^~/, os.homedir());
  const resolved = path.resolve(WORKSPACE, normalized);

  for (const pattern of BLOCKED_PATH_PATTERNS) {
    if (pattern.test(resolved)) {
      return { allowed: false, reason: `Path "${resolved}" is restricted by safety policy.`, resolved };
    }
  }

  // Allowed if inside workspace, temporary scratch, Downloads, or Desktop
  const allowedRoots = [WORKSPACE, SCRATCH_DIR, path.join(os.homedir(), 'Downloads'), path.join(os.homedir(), 'Desktop')];
  const isInsideAllowed = allowedRoots.some(root => resolved.toLowerCase().startsWith(root.toLowerCase()));

  return {
    allowed: isInsideAllowed,
    reason: isInsideAllowed ? undefined : `Path "${resolved}" is outside the authorized workspace sandbox.`,
    resolved
  };
}

/**
 * Inspects a shell command for dangerous or uncontained destructive operations.
 * @param {string} cmdLine 
 * @returns {{ safe: boolean, reason?: string }}
 */
export function validateCommand(cmdLine) {
  if (!cmdLine || typeof cmdLine !== 'string') return { safe: false, reason: 'Empty command' };

  for (const pattern of DESTRUCTIVE_CMD_PATTERNS) {
    if (pattern.test(cmdLine)) {
      return { safe: false, reason: 'Command matches high-risk destructive pattern. Blocked by Siri Sandbox.' };
    }
  }

  return { safe: true };
}

/**
 * Executes a command within the sandboxed environment with strict timeouts and path bounds.
 * Universal across Windows (PowerShell), macOS (zsh/sh), and Linux (bash/sh).
 * @param {string} command
 * @param {object} options
 * @returns {Promise<{ ok: boolean, output: string, exitCode: number }>}
 */
export function runSandboxed(command, options = {}) {
  const check = validateCommand(command);
  if (!check.safe) {
    return Promise.resolve({ ok: false, output: `[SANDBOX BLOCKED] ${check.reason}`, exitCode: 1 });
  }

  const timeoutMs = options.timeoutMs || 30000;
  const cwd = options.cwd && validatePath(options.cwd).allowed ? path.resolve(options.cwd) : WORKSPACE;

  let shell = '/bin/sh';
  let shellArgs = ['-c', command];

  if (IS_WIN) {
    shell = 'powershell.exe';
    shellArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command];
  } else if (IS_MAC && fs.existsSync('/bin/zsh')) {
    shell = '/bin/zsh';
  } else if (fs.existsSync('/bin/bash')) {
    shell = '/bin/bash';
  }

  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(shell, shellArgs, {
        cwd,
        env: {
          ...process.env,
          PWD: cwd,
          SIRI_SANDBOX: '1',
          TMPDIR: SCRATCH_DIR
        }
      });
    } catch (err) {
      return resolve({ ok: false, output: `Sandbox spawn error: ${err.message}`, exitCode: 1 });
    }

    let output = '';
    const timer = setTimeout(() => {
      try {
        if (IS_WIN) {
          spawn('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F']);
        } else {
          proc.kill('SIGKILL');
        }
      } catch {}
      resolve({ ok: false, output: output + '\n[SANDBOX TIMEOUT] Process terminated after ' + (timeoutMs / 1000) + 's.', exitCode: 124 });
    }, timeoutMs);

    if (proc.stdout) {
      proc.stdout.on('data', (d) => { output += d.toString(); if (output.length > 50000) output = output.slice(0, 50000); });
    }
    if (proc.stderr) {
      proc.stderr.on('data', (d) => { output += d.toString(); if (output.length > 50000) output = output.slice(0, 50000); });
    }

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output: output.trim(), exitCode: code ?? 0 });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, output: `Process error: ${err.message}`, exitCode: 1 });
    });
  });
}

/**
 * Returns current sandbox telemetry and status.
 */
export function getSandboxStatus() {
  return {
    active: true,
    platform: process.platform,
    arch: process.arch,
    mode: 'STRICT_WORKSPACE',
    workspace: WORKSPACE,
    scratchDir: SCRATCH_DIR,
    blockedPatternsCount: BLOCKED_PATH_PATTERNS.length,
    destructiveFiltersCount: DESTRUCTIVE_CMD_PATTERNS.length
  };
}
