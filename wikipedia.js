// wikipedia.js — Direct Wikipedia API Integration with Multilingual Voice Summaries
// Supports Telugu (te.wikipedia.org), Hindi (hi.wikipedia.org), English (en.wikipedia.org), and other supported languages.

import https from 'node:https';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'SiriVoiceAssistant/1.0 (https://github.com/Voice-Assistant)' } }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, json: null });
        }
      });
    }).on('error', err => reject(err));
  });
}

/**
 * Searches Wikipedia and returns a clean, voice-ready summary.
 * @param {string} topic
 * @param {string} langCode - 'en', 'te', 'hi', 'es', 'fr', 'de', 'ja'
 * @returns {Promise<{ ok: boolean, title?: string, summary?: string, url?: string, thumbnail?: string, lang?: string, error?: string }>}
 */
export async function getWikipediaSummary(topic, langCode = 'en') {
  const cleanTopic = String(topic || '').trim().replace(/^about\s+/i, '').replace(/^for\s+/i, '');
  if (!cleanTopic) {
    return { ok: false, error: 'Empty topic query' };
  }

  const primaryLang = (langCode || 'en').toLowerCase();
  const primaryUrl = `https://${primaryLang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanTopic)}`;

  try {
    const res = await fetchJson(primaryUrl);
    if (res.status === 200 && res.json && res.json.extract) {
      const summaryText = res.json.extract;
      // Trim to first 2-3 sentences for concise natural speech
      const sentences = summaryText.split(/(?<=[.?!])\s+/);
      const voiceExtract = sentences.slice(0, 3).join(' ');

      return {
        ok: true,
        title: res.json.title || cleanTopic,
        summary: voiceExtract || summaryText,
        description: res.json.description || '',
        url: res.json.content_urls?.desktop?.page || `https://${primaryLang}.wikipedia.org/wiki/${encodeURIComponent(cleanTopic)}`,
        thumbnail: res.json.thumbnail?.source || '',
        lang: primaryLang
      };
    }

    // Fallback: If localized Wikipedia (e.g. Telugu/Hindi) did not match, try English Wikipedia
    if (primaryLang !== 'en') {
      const fallbackUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanTopic)}`;
      const fbRes = await fetchJson(fallbackUrl);
      if (fbRes.status === 200 && fbRes.json && fbRes.json.extract) {
        const sentences = fbRes.json.extract.split(/(?<=[.?!])\s+/);
        return {
          ok: true,
          title: fbRes.json.title || cleanTopic,
          summary: sentences.slice(0, 3).join(' '),
          description: fbRes.json.description || '',
          url: fbRes.json.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(cleanTopic)}`,
          thumbnail: fbRes.json.thumbnail?.source || '',
          lang: 'en',
          fallbackUsed: true
        };
      }
    }

    return {
      ok: false,
      topic: cleanTopic,
      error: `No Wikipedia article found for "${cleanTopic}".`
    };
  } catch (err) {
    return {
      ok: false,
      topic: cleanTopic,
      error: err.message || 'Wikipedia connection failed'
    };
  }
}
