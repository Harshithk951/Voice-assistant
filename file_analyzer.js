// file_analyzer.js - Deep Local File & Directory Content Inspection with AI Analysis
// Opens item visually in Finder/Explorer, reads file data, and generates spoken intelligence
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { findFiles, describe } from './files.js';
import { computerUse } from './computer_use.js';
import { validatePath } from './sandbox.js';
import brain from './brain.js';

const MAX_READ_BYTES = 50_000; // 50KB read limit for fast sub-second analysis

class FileAnalyzer {
  /**
   * Discovers file or folder, reveals it in Finder/Explorer, and analyzes contents
   */
  async findAndAnalyze(query, specificQuestion = '') {
    const q = (query || '').trim();
    if (!q) return { ok: false, spoken: 'What file or folder should I search and analyze?' };

    // 1. Locate file via direct path, workspace relative path, or indexed search
    let targetPath = null;
    let isDirect = false;

    const directCandidate = path.resolve(q.replace(/^~/, os.homedir()));
    if (fs.existsSync(directCandidate)) {
      targetPath = directCandidate;
      isDirect = true;
    }

    if (!targetPath) {
      const hits = findFiles(q, 3);
      if (hits && hits.length > 0) {
        targetPath = hits[0].full;
      }
    }

    if (!targetPath) {
      // Try searching project folder names
      const homeRoots = ['Desktop', 'Documents', 'Downloads', 'OneDrive', 'Pictures'].map(d => path.join(os.homedir(), d));
      for (const root of homeRoots) {
        if (!fs.existsSync(root)) continue;
        try {
          const entries = fs.readdirSync(root, { withFileTypes: true });
          for (const e of entries) {
            if (e.isDirectory() && e.name.toLowerCase().includes(q.toLowerCase())) {
              targetPath = path.join(root, e.name);
              break;
            }
          }
          if (targetPath) break;
        } catch {}
      }
    }

    if (!targetPath) {
      return {
        ok: false,
        spoken: `I searched your Desktop, Documents, and Downloads, but couldn't find any file or folder matching "${q}".`
      };
    }

    // 2. Validate Security Sandbox Boundary
    const securityCheck = validatePath(targetPath);
    if (!securityCheck.allowed) {
      return {
        ok: false,
        spoken: `Security boundary protected: Cannot analyze "${path.basename(targetPath)}" as it is located in a restricted directory.`
      };
    }

    // 3. Open in Finder / File Explorer visually on screen (< 0.2s)
    await computerUse.revealAndFocusPath(targetPath);

    // 4. Inspect contents
    const stats = await fsp.stat(targetPath);
    let analysisResult = '';

    if (stats.isDirectory()) {
      analysisResult = await this.analyzeDirectory(targetPath, specificQuestion);
    } else {
      analysisResult = await this.analyzeFile(targetPath, specificQuestion);
    }

    return {
      ok: true,
      targetPath,
      name: path.basename(targetPath),
      isDirectory: stats.isDirectory(),
      analysis: analysisResult,
      spoken: analysisResult
    };
  }

  /**
   * Deep analysis of a folder
   */
  async analyzeDirectory(dirPath, question = '') {
    const dirName = path.basename(dirPath);
    let entries = [];
    try {
      entries = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch (e) {
      return `Opened folder ${dirName} in your file manager, but could not read its contents due to permissions.`;
    }

    const subdirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);
    const files = entries.filter(e => !e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);

    // Count extensions
    const extCount = {};
    for (const f of files) {
      const ext = path.extname(f).toLowerCase() || 'no-extension';
      extCount[ext] = (extCount[ext] || 0) + 1;
    }

    const extSummary = Object.entries(extCount).map(([ext, count]) => `${count} ${ext}`).join(', ');

    // Check for README or package.json to understand project
    let contextSnippet = '';
    const readmeFile = files.find(f => /^readme(\.(md|txt))?$/i.test(f));
    if (readmeFile) {
      try {
        const content = await fsp.readFile(path.join(dirPath, readmeFile), 'utf8');
        contextSnippet = `\nREADME snippet: ${content.slice(0, 1500)}`;
      } catch {}
    }

    const prompt = `You are Siri, an autonomous desktop assistant. The user opened folder "${dirName}" in Finder/File Explorer.
Contents:
- Total Files: ${files.length} (${extSummary})
- Subdirectories: ${subdirs.slice(0, 6).join(', ') || 'None'}
- Key files: ${files.slice(0, 10).join(', ')}
${contextSnippet}
User question or focus: ${question || 'Summarize what is in this folder'}
Provide a concise, crisp spoken summary (2-3 sentences max) explaining what this folder contains and what it appears to be used for.`;

    const aiRes = await brain.think(prompt);
    return aiRes.reply || `Opened folder ${dirName}. It contains ${files.length} files (${extSummary}) and ${subdirs.length} subfolders.`;
  }

  /**
   * Deep analysis of a document/code file
   */
  async analyzeFile(filePath, question = '') {
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    let textContent = '';
    try {
      const buf = await fsp.readFile(filePath);
      textContent = buf.slice(0, MAX_READ_BYTES).toString('utf8').replace(/[^\x20-\x7E\n\r\t]/g, ' ');
    } catch (e) {
      return `Opened ${fileName} on your screen with its default app.`;
    }

    const prompt = `You are Siri, an autonomous desktop assistant. The user opened file "${fileName}" in Finder/File Explorer.
File extension: ${ext}
File preview text:
${textContent.slice(0, 2500)}

User request/question: ${question || 'Analyze and summarize what is in this file'}
Provide a concise, direct, helpful spoken summary (2-3 sentences max) explaining the key points and data in this file.`;

    const aiRes = await brain.think(prompt);
    return aiRes.reply || `Opened ${fileName} in your file manager. It is a ${ext} document containing ${textContent.split('\n').length} lines.`;
  }
}

export const fileAnalyzer = new FileAnalyzer();
export default fileAnalyzer;
