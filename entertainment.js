// entertainment.js — Local Music Library Playback & Multilingual Joke Engine
// Native support for Telugu, Hindi, English, Spanish, French, German.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { IS_MAC, IS_WIN, IS_LINUX } from './system_ops.js';
import { t } from './i18n.js';

const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.wav', '.flac', '.aac', '.ogg', '.aiff', '.wma']);

function runPlayer(file) {
  return new Promise((resolve) => {
    if (IS_MAC) {
      execFile('open', [file], (e) => resolve(!e));
    } else if (IS_WIN) {
      execFile('cmd.exe', ['/c', 'start', '', file], { windowsHide: true }, (e) => resolve(!e));
    } else {
      execFile('xdg-open', [file], (e) => resolve(!e));
    }
  });
}

function scanDirForAudio(dir, results = [], maxDepth = 2, currentDepth = 0) {
  if (currentDepth > maxDepth || !fs.existsSync(dir)) return results;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTS.has(ext)) {
          results.push({
            name: path.basename(entry.name, ext),
            file: entry.name,
            full: fullPath,
            ext
          });
        }
      } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
        scanDirForAudio(fullPath, results, maxDepth, currentDepth + 1);
      }
    }
  } catch {}
  return results;
}

/**
 * Searches and plays a local music file from user's music or downloads directory.
 */
export async function playLocalMusic(query = '', lang = 'en') {
  const searchRoots = [
    path.join(os.homedir(), 'Music'),
    path.join(os.homedir(), 'Downloads'),
    path.join(os.homedir(), 'Desktop')
  ];

  const tracks = [];
  for (const root of searchRoots) {
    scanDirForAudio(root, tracks);
  }

  if (!tracks.length) {
    return {
      ok: false,
      spoken: t('no_local_music', lang),
      query
    };
  }

  const cleanQ = String(query || '').trim().toLowerCase();
  let chosen = null;

  if (cleanQ) {
    chosen = tracks.find(t => t.name.toLowerCase().includes(cleanQ)) ||
             tracks.find(t => cleanQ.includes(t.name.toLowerCase()));
  }

  if (!chosen) {
    // Pick random or most recent track
    chosen = tracks[Math.floor(Math.random() * tracks.length)];
  }

  const launched = await runPlayer(chosen.full);
  const spoken = t('playing_local_music', lang, { title: chosen.name });

  return {
    ok: launched,
    title: chosen.name,
    file: chosen.file,
    fullPath: chosen.full,
    spoken
  };
}

// ── Curated Multilingual Joke Pool ──
const JOKES = {
  te: [
    { setup: 'ప్రోగ్రామర్లు డార్క్ మోడ్ ఎందుకు ఇష్టపడతారు?', punchline: 'ఎందుకంటే కాంతి ఉంటే బగ్స్ వస్తాయి కదా!' },
    { setup: 'కంప్యూటర్ డాక్టర్ దగ్గరికి ఎందుకు వెళ్ళింది?', punchline: 'దానికి వైరస్ సోకిందంట!' },
    { setup: 'ప్రపంచంలో 10 రకాల మనుషులు ఉంటారు:', punchline: 'ఒకరు బైనరీ తెలిసినవారు, మరొకరు తెలియనివారు!' },
    { setup: 'డెవలపర్ ఎందుకు ఖాళీ జేబులతో తిరుగుతున్నాడు?', punchline: 'తన క్యాష్ (Cache) మొత్తం వాడేసాడు కాబట్టి!' },
    { setup: 'జావా మరియు సి++ ఒక రెస్టారెంట్‌కు వెళ్లాయి...', punchline: 'కానీ గార్బేజ్ కలెక్టర్ వచ్చి జావాను క్లీన్ చేసేసాడు!' },
    { setup: 'వై-ఫై ఎందుకు అలిగింది?', punchline: 'దానికి సరైన కనెక్షన్ కుదరలేదని!' }
  ],
  hi: [
    { setup: 'प्रोग्रामर को डार्क मोड क्यों पसंद है?', punchline: 'क्योंकि रोशनी में कीड़े (Bugs) आ जाते हैं!' },
    { setup: 'कंप्यूटर डॉक्टर के पास क्यों गया?', punchline: 'क्योंकि उसे वायरस लग गया था!' },
    { setup: 'दुनिया में केवल 10 तरह के लोग होते हैं:', punchline: 'एक वो जो बाइनरी समझते हैं, और दूसरे वो जो नहीं समझते!' },
    { setup: 'डेवलपर कंगाल क्यों हो गया?', punchline: 'क्योंकि उसने अपना सारा कैश (Cache) उड़ा दिया!' },
    { setup: 'इंटरनेट बंद क्यों हुआ?', punchline: 'क्योंकि तार ने कहा: मैं थक गया हूँ!' }
  ],
  en: [
    { setup: 'Why do programmers prefer dark mode?', punchline: 'Because light attracts bugs!' },
    { setup: 'There are only 10 types of people in the world:', punchline: 'Those who understand binary, and those who do not.' },
    { setup: 'Why did the developer go broke?', punchline: 'Because they used up all their cache!' },
    { setup: 'Why do Java programmers have to wear glasses?', punchline: 'Because they don’t C#!' },
    { setup: 'A SQL query walks into a bar, walks up to two tables and asks:', punchline: '“Can I join you?”' },
    { setup: 'Why was the computer cold?', punchline: 'It left its Windows open!' }
  ],
  es: [
    { setup: '¿Por qué los programadores prefieren el modo oscuro?', punchline: '¡Porque la luz atrae a los bichos (bugs)!' },
    { setup: 'Solo hay 10 tipos de personas en el mundo:', punchline: 'Las que entienden binario y las que no.' },
    { setup: '¿Qué le dice una impresora a otra?', punchline: '¿Esa hoja es tuya o es impresión mía?' },
    { setup: '¿Por qué la computadora fue al médico?', punchline: '¡Porque tenía un virus!' }
  ],
  fr: [
    { setup: 'Pourquoi les développeurs préfèrent-ils le mode sombre ?', punchline: 'Parce que la lumière attire les insectes (bugs) !' },
    { setup: 'Il y a 10 sortes de personnes dans le monde :', punchline: 'Ceux qui comprennent le binaire et ceux qui ne le comprennent pas.' },
    { setup: 'Que fait un geek quand il a froid ?', punchline: 'Il ferme les fenêtres (Windows) !' }
  ],
  de: [
    { setup: 'Warum bevorzugen Programmierer den Dunkelmodus?', punchline: 'Weil Licht Käfer (Bugs) anzieht!' },
    { setup: 'Es gibt 10 Arten von Menschen auf der Welt:', punchline: 'Diejenigen, die Binär verstehen, und diejenigen, die es nicht tun.' },
    { setup: 'Warum friert der Computer?', punchline: 'Er hat Windows offengelassen!' }
  ]
};

/**
 * Returns a localized joke with setup and punchline.
 */
export function getRandomJoke(lang = 'en') {
  const pool = JOKES[lang] || JOKES.en;
  const item = pool[Math.floor(Math.random() * pool.length)];
  return {
    setup: item.setup,
    punchline: item.punchline,
    spoken: `${item.setup} ... ${item.punchline}`
  };
}
