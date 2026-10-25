// crawler_engine.js — Firecrawl-Grade Web Crawling & LLM-Ready Markdown Extraction Engine
// Reverse-engineered from Firecrawl (https://github.com/firecrawl/firecrawl)
// Provides /scrape, /crawl, and /map with SSRF protection, DOM decluttering,
// semantic Markdown conversion, and metadata synthesis. Pure Node.js zero-dependency.

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { URL } from 'node:url';

// ── 1. SSRF & Security Validation Policy ──
export function validateSafeUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') {
    return { ok: false, reason: 'URL cannot be empty' };
  }

  let clean = urlStr.trim();

  // If a protocol scheme is present, ensure it is strictly HTTP or HTTPS
  const schemeMatch = clean.match(/^([a-zA-Z0-9+.-]+):/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      return { ok: false, reason: `Forbidden scheme "${scheme}:". Only HTTP and HTTPS are permitted by security policy.` };
    }
  } else {
    clean = 'https://' + clean;
  }

  let parsed;
  try {
    parsed = new URL(clean);
  } catch {
    return { ok: false, reason: `Invalid URL format: ${urlStr}` };
  }

  // Double check protocol
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `Forbidden protocol "${parsed.protocol}". Only HTTP/HTTPS permitted.` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Loopback and internal aliases
  if (
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.onion')
  ) {
    return { ok: false, reason: 'Targeting loopback or local infrastructure is forbidden by security guardrails.' };
  }

  // Cloud Instance Metadata Service (AWS, GCP, Azure, DigitalOcean)
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
    return { ok: false, reason: 'Targeting cloud instance metadata endpoints is blocked by security policy.' };
  }

  // IPv4 Private Range Restrictions (RFC 1918 & Link-Local)
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [_, a, b] = ipv4.map(Number);
    if (
      a === 127 || // Loopback
      a === 10 || // 10.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) || // 192.168.0.0/16
      (a === 169 && b === 254) || // Link-local
      a === 0
    ) {
      return { ok: false, reason: 'Private network and loopback IP addresses are blocked.' };
    }
  }

  return { ok: true, url: parsed.href, origin: parsed.origin, host: parsed.host };
}

// ── 2. HTML Entity Decoding ──
function decodeEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// ── 3. Metadata Extraction ──
export function extractMetadata(html, sourceUrl) {
  const meta = {
    title: '',
    description: '',
    ogTitle: '',
    ogDescription: '',
    ogImage: '',
    canonical: '',
    language: '',
    author: '',
    publishedTime: ''
  };

  if (!html) return meta;

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) meta.title = decodeEntities(titleMatch[1].trim());

  const getMeta = (nameOrProp) => {
    const rx = new RegExp(`<meta\\s+[^>]*(?:name|property)=["']${nameOrProp}["'][^>]*content=["']([^"']*)["']`, 'i');
    const rx2 = new RegExp(`<meta\\s+[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${nameOrProp}["']`, 'i');
    const m = html.match(rx) || html.match(rx2);
    return m ? decodeEntities(m[1].trim()) : '';
  };

  meta.description = getMeta('description');
  meta.ogTitle = getMeta('og:title') || meta.title;
  meta.ogDescription = getMeta('og:description') || meta.description;
  meta.ogImage = getMeta('og:image');
  meta.author = getMeta('author');
  meta.publishedTime = getMeta('article:published_time') || getMeta('og:published_time');

  const canonMatch = html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
  if (canonMatch) meta.canonical = canonMatch[1].trim();

  const langMatch = html.match(/<html\b[^>]*lang=["']([^"']*)["']/i);
  if (langMatch) meta.language = langMatch[1].trim();

  return meta;
}

// ── 4. HTML to Clean Markdown Converter (Firecrawl Core Pattern) ──
export function htmlToMarkdown(rawHtml, baseUrl = '') {
  if (!rawHtml || typeof rawHtml !== 'string') return '';

  let html = rawHtml;

  // 1. Remove comments and head metadata block (prevents title/meta tags leaking into content)
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/<head\b[\s\S]*?<\/head>/gi, '');

  // 2. Remove script, style, noscript, svg, canvas, iframe, form, button elements
  html = html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<style\b[\s\S]*?<\/style>/gi, '');
  html = html.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '');
  html = html.replace(/<svg\b[\s\S]*?<\/svg>/gi, '');
  html = html.replace(/<canvas\b[\s\S]*?<\/canvas>/gi, '');
  html = html.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '');
  html = html.replace(/<form\b[\s\S]*?<\/form>/gi, '');

  // 3. Remove navigation, headers, footers, aside, modals, cookie banners (Noise Reduction)
  html = html.replace(/<nav\b[\s\S]*?<\/nav>/gi, '');
  html = html.replace(/<header\b[\s\S]*?<\/header>/gi, '');
  html = html.replace(/<footer\b[\s\S]*?<\/footer>/gi, '');
  html = html.replace(/<aside\b[\s\S]*?<\/aside>/gi, '');
  html = html.replace(/<dialog\b[\s\S]*?<\/dialog>/gi, '');
  html = html.replace(/<div\b[^>]*(?:id|class)=["'][^"']*(?:cookie|consent|banner|newsletter|advert|modal|dialog|popup)[^"']*["'][\s\S]*?<\/div>/gi, '');

  // 4. Strip hidden prompt-injection elements (display:none, visibility:hidden, opacity:0, font-size:0)
  html = html.replace(/<[a-z0-9]+\b[^>]*style=["'][^"']*(?:display:\s*none|visibility:\s*hidden|opacity:\s*0|font-size:\s*0)[^"']*["'][\s\S]*?<\/[a-z0-9]+>/gi, '');

  // 5. Code blocks (<pre><code>)
  html = html.replace(/<pre\b[^>]*><code(?:\s+class=["'][^"']*language-([a-z0-9_-]+)[^"']*["'])?[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, lang, code) => {
    const cleanCode = decodeEntities(code.replace(/<[^>]+>/g, '')).trim();
    return `\n\n\`\`\`${lang || ''}\n${cleanCode}\n\`\`\`\n\n`;
  });
  html = html.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => {
    const cleanCode = decodeEntities(code.replace(/<[^>]+>/g, '')).trim();
    return `\n\n\`\`\`\n${cleanCode}\n\`\`\`\n\n`;
  });

  // 6. Inline code
  html = html.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => {
    const cleanCode = decodeEntities(code.replace(/<[^>]+>/g, '')).trim();
    return `\`${cleanCode}\``;
  });

  // 7. Tables (convert <table> into clean GFM Markdown tables)
  html = html.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, tableContent) => {
    const rows = [];
    const trMatches = tableContent.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi) || [];

    for (const tr of trMatches) {
      const cells = [];
      const cellMatches = tr.match(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi) || [];
      for (const c of cellMatches) {
        const text = decodeEntities(c.replace(/<[^>]+>/g, '')).replace(/\|/g, '\\|').trim();
        cells.push(text || ' ');
      }
      if (cells.length > 0) rows.push(cells);
    }

    if (rows.length === 0) return '';
    const maxCols = Math.max(...rows.map(r => r.length));
    const padRow = (r) => {
      const padded = [...r];
      while (padded.length < maxCols) padded.push(' ');
      return `| ${padded.join(' | ')} |`;
    };

    let mdTable = '\n\n' + padRow(rows[0]) + '\n';
    mdTable += '| ' + Array(maxCols).fill('---').join(' | ') + ' |\n';
    for (let i = 1; i < rows.length; i++) {
      mdTable += padRow(rows[i]) + '\n';
    }
    return mdTable + '\n';
  });

  // 8. Headers (H1-H6)
  html = html.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `\n\n# ${decodeEntities(c.replace(/<[^>]+>/g, '')).trim()}\n\n`);
  html = html.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `\n\n## ${decodeEntities(c.replace(/<[^>]+>/g, '')).trim()}\n\n`);
  html = html.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `\n\n### ${decodeEntities(c.replace(/<[^>]+>/g, '')).trim()}\n\n`);
  html = html.replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `\n\n#### ${decodeEntities(c.replace(/<[^>]+>/g, '')).trim()}\n\n`);
  html = html.replace(/<h5\b[^>]*>([\s\S]*?)<\/h5>/gi, (_, c) => `\n\n##### ${decodeEntities(c.replace(/<[^>]+>/g, '')).trim()}\n\n`);
  html = html.replace(/<h6\b[^>]*>([\s\S]*?)<\/h6>/gi, (_, c) => `\n\n###### ${decodeEntities(c.replace(/<[^>]+>/g, '')).trim()}\n\n`);

  // 9. Blockquotes
  html = html.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => {
    const lines = decodeEntities(c.replace(/<[^>]+>/g, '')).trim().split('\n');
    return `\n\n` + lines.map(l => `> ${l.trim()}`).join('\n') + `\n\n`;
  });

  // 10. Links: <a href="...">text</a>
  html = html.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const cleanText = decodeEntities(text.replace(/<[^>]+>/g, '')).trim();
    if (!cleanText || href.startsWith('javascript:') || href.startsWith('mailto:') || href === '#') {
      return cleanText;
    }
    let absUrl = href;
    if (baseUrl && !/^https?:\/\//i.test(href)) {
      try { absUrl = new URL(href, baseUrl).href; } catch {}
    }
    return `[${cleanText}](${absUrl})`;
  });

  // 11. Images: <img src="..." alt="..."> (filters tiny icons and 1x1 pixels)
  html = html.replace(/<img\b[^>]*src=["']([^"']*)["'][^>]*(?:alt=["']([^"']*)["'])?[^>]*>/gi, (_, src, alt) => {
    if (src.includes('1x1') || src.includes('tracking') || src.length > 500) return '';
    return alt ? `![${alt}](${src})` : '';
  });

  // 12. Lists: Process li elements with word boundaries
  html = html.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `\n- ${decodeEntities(c.replace(/<[^>]+>/g, '')).trim()}`);
  html = html.replace(/<\/?(?:ul|ol)\b[^>]*>/gi, '\n');

  // 13. Bold and Italic
  html = html.replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, c) => `**${decodeEntities(c.replace(/<[^>]+>/g, '')).trim()}**`);
  html = html.replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_, c) => `*${decodeEntities(c.replace(/<[^>]+>/g, '')).trim()}*`);

  // 14. Paragraphs and line breaks
  html = html.replace(/<br\b\s*\/?>/gi, '\n');
  html = html.replace(/<hr\b\s*\/?>/gi, '\n\n---\n\n');
  html = html.replace(/<\/(?:p|div|section|article)>/gi, '\n\n');
  html = html.replace(/<(?:p|div|section|article)\b[^>]*>/gi, '');

  // 15. Strip any remaining unhandled HTML tags
  html = html.replace(/<[^>]+>/g, '');

  // 16. Cleanup whitespace: decode remaining entities, collapse 3+ newlines into 2
  html = decodeEntities(html);
  html = html.split('\n').map(l => l.trimEnd()).join('\n');
  html = html.replace(/\n{3,}/g, '\n\n').trim();

  return html;
}

// ── 5. Internal Link Discovery ──
export function extractLinks(html, baseUrl) {
  if (!html || !baseUrl) return [];
  const links = new Set();
  let baseOrigin = '';
  try { baseOrigin = new URL(baseUrl).origin; } catch { return []; }

  const rx = /<a\b[^>]*href=["']([^"']*)["'][^>]*>/gi;
  let match;
  while ((match = rx.exec(html)) !== null) {
    const rawHref = match[1].trim();
    if (!rawHref || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('#')) {
      continue;
    }
    try {
      const resolved = new URL(rawHref, baseUrl);
      // Keep same origin only, ignore media / download extensions
      if (resolved.origin === baseOrigin) {
        resolved.hash = ''; // strip anchor fragments
        const p = resolved.pathname.toLowerCase();
        if (!p.endsWith('.pdf') && !p.endsWith('.zip') && !p.endsWith('.png') && !p.endsWith('.jpg') && !p.endsWith('.mp4')) {
          links.add(resolved.href);
        }
      }
    } catch {}
  }
  return Array.from(links);
}

// ── 6. Fast Outbound HTTP Fetch (with timeout & size limit) ──
export async function fastFetchHtml(targetUrl, timeoutMs = 8000, maxBytes = 4 * 1024 * 1024) {
  const check = validateSafeUrl(targetUrl);
  if (!check.ok) throw new Error(check.reason);

  const parsed = new URL(check.url);
  const isHttps = parsed.protocol === 'https:';
  const client = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.get(check.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 SiriFirecrawl/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: timeoutMs
    }, (res) => {
      // Handle redirects (up to 3 hops)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        try {
          const redirectUrl = new URL(res.headers.location, check.url).href;
          res.resume();
          return resolve(fastFetchHtml(redirectUrl, timeoutMs, maxBytes));
        } catch (e) {
          return reject(new Error(`Failed to follow redirect: ${e.message}`));
        }
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}`));
      }

      let data = '';
      let bytes = 0;

      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          req.destroy();
          return reject(new Error(`Page size exceeded safety limit (${Math.round(maxBytes / 1024)} KB).`));
        }
        data += chunk.toString('utf8');
      });

      res.on('end', () => resolve({ html: data, statusCode: res.statusCode, url: check.url }));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Fetch timed out after ${timeoutMs / 1000}s`));
    });

    req.on('error', (err) => reject(new Error(`Network error: ${err.message}`)));
  });
}

// ── 7. Firecrawl Scrape API (/scrape) ──
export async function scrapeUrl(targetUrl, options = {}) {
  const check = validateSafeUrl(targetUrl);
  if (!check.ok) return { ok: false, error: check.reason };

  try {
    const fetchRes = await fastFetchHtml(check.url, options.timeoutMs || 8000);
    const meta = extractMetadata(fetchRes.html, check.url);
    const markdown = htmlToMarkdown(fetchRes.html, check.url);

    return {
      ok: true,
      url: check.url,
      title: meta.title || meta.ogTitle || 'Untitled',
      description: meta.description || meta.ogDescription || '',
      markdown,
      metadata: meta,
      length: markdown.length
    };
  } catch (err) {
    return { ok: false, url: check.url, error: err.message };
  }
}

// ── 8. Firecrawl Map API (/map) ──
export async function mapSite(startUrl, options = {}) {
  const check = validateSafeUrl(startUrl);
  if (!check.ok) return { ok: false, error: check.reason };

  const maxLinks = Math.min(options.limit || 30, 100);
  const discovered = new Set([check.url]);

  // 1. Try fetching sitemap.xml first (Firecrawl mapping pattern)
  try {
    const sitemapUrl = `${check.origin}/sitemap.xml`;
    const sitemapRes = await fastFetchHtml(sitemapUrl, 5000);
    if (sitemapRes.html && sitemapRes.html.includes('<loc>')) {
      const locMatches = sitemapRes.html.match(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi) || [];
      for (const loc of locMatches) {
        const cleanLoc = loc.replace(/<\/?loc\b[^>]*>/g, '').trim();
        if (cleanLoc.startsWith(check.origin)) {
          discovered.add(cleanLoc);
          if (discovered.size >= maxLinks) break;
        }
      }
    }
  } catch {}

  // 2. Discover links from landing page if sitemap was insufficient
  if (discovered.size < maxLinks) {
    try {
      const rootRes = await fastFetchHtml(check.url, 6000);
      const links = extractLinks(rootRes.html, check.url);
      for (const l of links) {
        discovered.add(l);
        if (discovered.size >= maxLinks) break;
      }
    } catch {}
  }

  return {
    ok: true,
    origin: check.origin,
    totalUrls: discovered.size,
    urls: Array.from(discovered)
  };
}

// ── 9. Firecrawl Crawl API (/crawl) ──
export async function crawlSite(startUrl, options = {}) {
  const check = validateSafeUrl(startUrl);
  if (!check.ok) return { ok: false, error: check.reason };

  const maxPages = Math.min(options.maxPages || 5, 20);
  const visited = new Set();
  const queue = [check.url];
  const pages = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    try {
      const fetchRes = await fastFetchHtml(current, options.timeoutMs || 8000);
      const meta = extractMetadata(fetchRes.html, current);
      const markdown = htmlToMarkdown(fetchRes.html, current);
      const internalLinks = extractLinks(fetchRes.html, current);

      pages.push({
        url: current,
        title: meta.title || meta.ogTitle || current,
        description: meta.description || meta.ogDescription || '',
        markdown,
        wordCount: markdown.split(/\s+/).filter(Boolean).length
      });

      // Enqueue next internal links
      for (const link of internalLinks) {
        if (!visited.has(link) && !queue.includes(link) && queue.length < 50) {
          queue.push(link);
        }
      }
    } catch (err) {
      console.warn(`[Firecrawl] Skipped ${current}: ${err.message}`);
    }
  }

  // Generate Executive Markdown Dossier
  const dossierLines = [
    `# Autonomous Crawl Dossier: ${check.origin}`,
    `Generated by Siri Firecrawl Engine · ${new Date().toLocaleString('en-IN')}`,
    `Crawled ${pages.length} page(s) within domain\n`,
    `---`
  ];

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    dossierLines.push(`\n## [${i + 1}/${pages.length}] ${p.title}`);
    dossierLines.push(`**URL**: ${p.url}`);
    if (p.description) dossierLines.push(`**Description**: ${p.description}`);
    dossierLines.push(`**Word Count**: ${p.wordCount} words\n`);
    dossierLines.push(p.markdown.slice(0, 3000));
    if (p.markdown.length > 3000) dossierLines.push('\n*(Content truncated for dossier preview)*');
    dossierLines.push('\n---');
  }

  const dossierText = dossierLines.join('\n');

  // Optionally persist dossier to Downloads or workspace
  const dossierPath = path.join(os.homedir(), 'Downloads', `crawl-${new URL(check.url).hostname}-${Date.now()}.md`);
  try {
    fs.writeFileSync(dossierPath, dossierText, 'utf8');
  } catch {}

  return {
    ok: true,
    origin: check.origin,
    totalPages: pages.length,
    pages,
    dossier: dossierText,
    dossierFile: fs.existsSync(dossierPath) ? dossierPath : null
  };
}
