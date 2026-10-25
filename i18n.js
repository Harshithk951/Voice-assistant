// i18n.js — Multilingual & Localization Engine for Siri Voice Assistant
// Native support for English, Telugu, Hindi, Spanish, French, German, and Japanese.

export const SUPPORTED_LANGUAGES = {
  en: { code: 'en', name: 'English', nativeName: 'English', locale: 'en-US' },
  te: { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', locale: 'te-IN' },
  hi: { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', locale: 'hi-IN' },
  es: { code: 'es', name: 'Spanish', nativeName: 'Español', locale: 'es-ES' },
  fr: { code: 'fr', name: 'French', nativeName: 'Français', locale: 'fr-FR' },
  de: { code: 'de', name: 'German', nativeName: 'Deutsch', locale: 'de-DE' },
  ja: { code: 'ja', name: 'Japanese', nativeName: '日本語', locale: 'ja-JP' }
};

let currentLanguage = 'en';

export function getLanguage() {
  return currentLanguage;
}

export function setLanguage(lang) {
  const code = String(lang || '').toLowerCase().trim();
  if (SUPPORTED_LANGUAGES[code]) {
    currentLanguage = code;
    return SUPPORTED_LANGUAGES[code];
  }
  // Check by name or partial
  for (const [k, v] of Object.entries(SUPPORTED_LANGUAGES)) {
    if (code.includes(v.name.toLowerCase()) || code.includes(v.nativeName.toLowerCase())) {
      currentLanguage = k;
      return v;
    }
  }
  currentLanguage = 'en';
  return SUPPORTED_LANGUAGES.en;
}

/**
 * Heuristically detects the language of an incoming prompt.
 * Checks script unicode blocks (Telugu, Devanagari, Japanese) and common high-frequency stopwords.
 */
export function detectLanguage(text) {
  if (!text || typeof text !== 'string') return currentLanguage;
  const str = text.trim();

  // 1. Script-based Unicode detection
  // Telugu Unicode block: U+0C00 - U+0C7F
  if (/[\u0C00-\u0C7F]/.test(str)) return 'te';
  // Devanagari (Hindi) Unicode block: U+0900 - U+097F
  if (/[\u0900-\u097F]/.test(str)) return 'hi';
  // Japanese (Hiragana, Katakana, Kanji): U+3040 - U+30FF, U+4E00 - U+9FAF
  if (/[\u3040-\u30FF\u4E00-\u9FAF]/.test(str)) return 'ja';

  const lower = str.toLowerCase();

  // 2. Telugu Romanized / Hinglish / Phonetic keywords
  if (/\b(namaskaram|namaskaramu|ela\s+unnavu|bagunnava|samayam|samayamu|entha|eppudu|cheppu|kholo|chey|cheyyi|pettu|choodu|matladu|matladandi|telugulo)\b/i.test(lower)) {
    return 'te';
  }

  // 3. Hindi Romanized keywords
  if (/\b(namaste|kaise\s+ho|kya\s+haal|samay|kitna|baje|kholo|bhejo|sunao|karo|batao|likho|hindime|kripya)\b/i.test(lower)) {
    return 'hi';
  }

  // 4. Spanish keywords
  if (/\b(hola|buenos\s+dias|buenas\s+tardes|buenas\s+noches|como\s+estas|que\s+hora\s+es|hora|abrir|reproducir|chiste|reiniciar|apagar|gracias|por\s+favor)\b/i.test(lower)) {
    return 'es';
  }

  // 5. French keywords
  if (/\b(bonjour|bonsoir|salut|comment\s+allez|quelle\s+heure|heure|ouvrir|jouer|blague|redemarrer|eteindre|merci|s'il\s+vous\s+plait)\b/i.test(lower)) {
    return 'fr';
  }

  // 6. German keywords
  if (/\b(hallo|guten\s+morgen|guten\s+tag|guten\s+abend|wie\s+geht|uhrzeit|wie\s+spat|offnen|spielen|witz|neustart|herunterfahren|danke|bitte)\b/i.test(lower)) {
    return 'de';
  }

  return currentLanguage;
}

// Multilingual Template Catalog
const DICTIONARY = {
  // Time-of-day greetings
  greet_morning: {
    en: 'Good morning! Hope you have a productive and great day ahead.',
    te: 'శుభోదయం! ఈ రోజు మీకు ఉత్సాహంగా మరియు ఫలప్రదంగా ఉండాలని ఆశిస్తున్నాను.',
    hi: 'शुभ प्रभात! आशा है कि आपका आज का दिन बहुत अच्छा और उत्पादक रहेगा।',
    es: '¡Buenos días! Espero que tengas un día muy productivo y excelente.',
    fr: 'Bonjour ! J’espère que vous passerez une journée productive et agréable.',
    de: 'Guten Morgen! Ich wünsche Ihnen einen produktiven und erfolgreichen Tag.',
    ja: 'おはようございます！今日も充実した素晴らしい一日になりますように。'
  },
  greet_afternoon: {
    en: 'Good afternoon! How is your day going? How can I assist you?',
    te: 'శుభ మధ్యాహ్నం! మీ రోజు ఎలా సాగుతోంది? నేను మీకు ఎలా సహాయపడగలను?',
    hi: 'शुभ दोपहर! आपका दिन कैसा चल रहा है? मैं आपकी क्या मदद कर सकता हूँ?',
    es: '¡Buenas tardes! ¿Cómo va tu día? ¿En qué te puedo ayudar hoy?',
    fr: 'Bon après-midi ! Comment se passe votre journée ? Comment puis-je vous aider ?',
    de: 'Guten Tag! Wie läuft Ihr Tag? Wie kann ich Ihnen behilflich sein?',
    ja: 'こんにちは！今日はどのようなご用件でしょうか？何でもお手伝いします。'
  },
  greet_evening: {
    en: 'Good evening! Ready to wind down, or have tasks to finish?',
    te: 'శుభ సాయంత్రం! పనులు పూర్తి చేయడానికైనా లేదా విశ్రాంతికైనా సహాయం చేయడానికి సిద్ధంగా ఉన్నాను.',
    hi: 'शुभ संध्या! क्या आप आराम कर रहे हैं या कुछ काम पूरा करना है?',
    es: '¡Buenas tardes/noches! ¿Listo para relajarte o tienes tareas pendientes?',
    fr: 'Bonsoir ! Prêt à vous détendre ou avez-vous des tâches à terminer ?',
    de: 'Guten Abend! Bereit zum Entspannen oder gibt es noch Aufgaben zu erledigen?',
    ja: 'こんばんは！本日のタスクのまとめやお手伝いはありますか？'
  },
  greet_night: {
    en: 'Good night! Still working late? Let me know what you need.',
    te: 'శుభరాత్రి! రాత్రి పూట ఇంకా పనిచేస్తున్నారా? మీకు ఏ సహాయం కావాలో చెప్పండి.',
    hi: 'शुभ रात्रि! देर रात तक काम कर रहे हैं? बताइए मैं क्या सहायता करूँ।',
    es: '¡Buenas noches! ¿Trabajando hasta tarde? Dime en qué te puedo ayudar.',
    fr: 'Bonne nuit ! Vous travaillez encore tard ? Dites-moi ce dont vous avez besoin.',
    de: 'Gute Nacht! Arbeiten Sie noch spät? Sagen Sie mir, was Sie brauchen.',
    ja: 'おやすみなさい！夜遅くまでお疲れ様です。何かお手伝いできることはありますか？'
  },

  // Confirmations & Core Actions
  opening_website: {
    en: 'Opening {target} in your browser.',
    te: 'మీ బ్రౌజర్‌లో {target} తెరుస్తున్నాను.',
    hi: 'आपके ब्राउज़र में {target} खोला जा रहा है।',
    es: 'Abriendo {target} en tu navegador.',
    fr: 'Ouverture de {target} dans votre navigateur.',
    de: 'Öffne {target} in Ihrem Browser.',
    ja: 'ブラウザで {target} を開いています。'
  },
  searching_web: {
    en: 'Searching the web for "{query}".',
    te: 'వెబ్‌లో "{query}" కోసం శోధిస్తున్నాను.',
    hi: 'वेब पर "{query}" खोजा जा रहा है।',
    es: 'Buscando en la web "{query}".',
    fr: 'Recherche sur le web pour "{query}".',
    de: 'Suche im Web nach "{query}".',
    ja: 'ウェブで「{query}」を検索しています。'
  },
  playing_youtube: {
    en: 'Playing "{query}" on YouTube.',
    te: 'యూట్యూబ్‌లో "{query}" ప్లే చేస్తున్నాను.',
    hi: 'यूट्यूब पर "{query}" चलाया जा रहा है।',
    es: 'Reproduciendo "{query}" en YouTube.',
    fr: 'Lecture de "{query}" sur YouTube.',
    de: 'Spiele "{query}" auf YouTube.',
    ja: 'YouTubeで「{query}」を再生しています。'
  },

  // System Controls
  restarting_system: {
    en: 'Restarting your computer now. Please save your work.',
    te: 'మీ కంప్యూటర్‌ను ఇప్పుడు రీస్టార్ట్ చేస్తున్నాను. దయచేసి మీ పనులను సేవ్ చేసుకోండి.',
    hi: 'आपका कंप्यूटर अब रीस्टार्ट किया जा रहा है। कृपया अपना काम सहेज लें।',
    es: 'Reiniciando el equipo ahora. Por favor guarda tu trabajo.',
    fr: 'Redémarrage de votre ordinateur en cours. Veuillez sauvegarder votre travail.',
    de: 'Der Computer wird jetzt neu gestartet. Bitte speichern Sie Ihre Arbeit.',
    ja: 'コンピューターを再起動しています。作業内容を保存してください。'
  },
  shutting_down_system: {
    en: 'Shutting down your computer. Goodbye!',
    te: 'మీ కంప్యూటర్ షట్‌డౌన్ చేయబడుతోంది. సెలవు!',
    hi: 'आपका कंप्यूटर बंद किया जा रहा है। अलविदा!',
    es: 'Apagando el equipo. ¡Hasta luego!',
    fr: 'Arrêt de votre ordinateur en cours. Au revoir !',
    de: 'Der Computer wird heruntergefahren. Auf Wiedersehen!',
    ja: 'コンピューターをシャットダウンしています。さようなら！'
  },

  // Screenshots & Notes
  screenshot_taken: {
    en: 'Screenshot captured and saved to your Pictures folder.',
    te: 'స్క్రీన్‌షాట్ తీయబడింది మరియు పిక్చర్స్ ఫోల్డర్‌లో సేవ్ చేయబడింది.',
    hi: 'स्क्रीनशॉट ले लिया गया है और आपके पिक्चर्स फ़ोल्डर में सहेज दिया गया है।',
    es: 'Captura de pantalla tomada y guardada en tu carpeta de Imágenes.',
    fr: 'Capture d’écran enregistrée dans votre dossier Images.',
    de: 'Screenshot aufgenommen und im Bilder-Ordner gespeichert.',
    ja: 'スクリーンショットを撮影し、ピクチャフォルダに保存しました。'
  },
  note_saved: {
    en: 'Saved to your notes: "{text}".',
    te: 'మీ నోట్స్‌లో సేవ్ చేయబడింది: "{text}".',
    hi: 'आपके नोट्स में सहेजा गया: "{text}"।',
    es: 'Guardado en tus notas: "{text}".',
    fr: 'Enregistré dans vos notes : "{text}".',
    de: 'In Ihren Notizen gespeichert: "{text}".',
    ja: 'ノートに保存しました：「{text}」。'
  },

  // Entertainment
  playing_local_music: {
    en: 'Playing local music track: "{title}".',
    te: 'లోకల్ మ్యూజిక్ ట్రాక్ ప్లే చేస్తున్నాను: "{title}".',
    hi: 'लोकल संगीत ट्रैक चलाया जा रहा है: "{title}"।',
    es: 'Reproduciendo pista de música local: "{title}".',
    fr: 'Lecture du morceau local : "{title}".',
    de: 'Spiele lokalen Musiktitel: "{title}".',
    ja: 'ローカルミュージックを再生しています：「{title}」。'
  },
  no_local_music: {
    en: 'Could not find any local audio files in your Music or Downloads folder.',
    te: 'మీ మ్యూజిక్ లేదా డౌన్‌లోడ్స్ ఫోల్డర్‌లో ఎటువంటి ఆడియో ఫైల్‌లు కనుగొనబడలేదు.',
    hi: 'आपके म्यूज़िक या डाउनलोड फ़ोल्डर में कोई ऑडियो फ़ाइल नहीं मिली।',
    es: 'No se encontraron archivos de audio locales en tu carpeta Música o Descargas.',
    fr: 'Aucun fichier audio local trouvé dans vos dossiers Musique ou Téléchargements.',
    de: 'Keine lokalen Audiodateien in Ihrem Musik- oder Download-Ordner gefunden.',
    ja: 'ミュージックまたはダウンロードフォルダに音楽ファイルが見つかりませんでした。'
  },

  // Wikipedia
  wikipedia_intro: {
    en: 'According to Wikipedia: {summary}',
    te: 'వికీపీడియా ప్రకారం: {summary}',
    hi: 'विकिपीडिया के अनुसार: {summary}',
    es: 'Según Wikipedia: {summary}',
    fr: 'Selon Wikipédia : {summary}',
    de: 'Laut Wikipedia: {summary}',
    ja: 'ウィキペディアによると：{summary}'
  },
  wikipedia_not_found: {
    en: 'I could not find an article on Wikipedia for "{topic}".',
    te: 'వికీపీడియాలో "{topic}" కోసం ఎటువంటి సమాచారం కనుగొనబడలేదు.',
    hi: 'विकिपीडिया पर "{topic}" के लिए कोई लेख नहीं मिला।',
    es: 'No encontré ningún artículo en Wikipedia para "{topic}".',
    fr: 'Je n’ai trouvé aucun article sur Wikipédia pour "{topic}".',
    de: 'Ich konnte keinen Wikipedia-Artikel für "{topic}" finden.',
    ja: 'ウィキペディアで「{topic}」に関する記事が見つかりませんでした。'
  },

  // Language switch acknowledgement
  language_switched: {
    en: 'Language switched to English.',
    te: 'భాష తెలుగులోకి మార్చబడింది. నేను ఇప్పుడు తెలుగులో మాట్లాడగలను మరియు అర్థం చేసుకోగలను.',
    hi: 'भाषा बदलकर हिन्दी कर दी गई है। मैं अब हिन्दी में बात कर सकता हूँ।',
    es: 'Idioma cambiado a español. Ahora te responderé en español.',
    fr: 'Langue changée en français. Je répondrai désormais en français.',
    de: 'Sprache auf Deutsch umgestellt. Ich antworte nun auf Deutsch.',
    ja: '言語を日本語に切り替えました。日本語でお手伝いいたします。'
  }
};

/**
 * Returns a translated string with optional interpolation.
 */
export function t(key, lang = currentLanguage, params = {}) {
  const table = DICTIONARY[key] || {};
  let str = table[lang] || table.en || key;
  for (const [k, v] of Object.entries(params)) {
    str = str.replaceAll(`{${k}}`, String(v));
  }
  return str;
}

/**
 * Generates an accurate, localized time-of-day greeting.
 */
export function getTimeOfDayGreeting(lang = currentLanguage) {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return t('greet_morning', lang);
  if (hour >= 12 && hour < 17) return t('greet_afternoon', lang);
  if (hour >= 17 && hour < 22) return t('greet_evening', lang);
  return t('greet_night', lang);
}

/**
 * Formats current date and time in the active/chosen language.
 */
export function formatTimeDate(date = new Date(), lang = currentLanguage, mode = 'both') {
  const meta = SUPPORTED_LANGUAGES[lang] || SUPPORTED_LANGUAGES.en;
  const locale = meta.locale;

  const timeOptions = { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true };
  const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };

  const timeStr = new Intl.DateTimeFormat(locale, timeOptions).format(date);
  const dateStr = new Intl.DateTimeFormat(locale, dateOptions).format(date);

  switch (lang) {
    case 'te':
      if (mode === 'time') return `ప్రస్తుత సమయం: ${timeStr}`;
      if (mode === 'date') return `ఈ రోజు తేదీ: ${dateStr}`;
      return `ప్రస్తుత సమయం ${timeStr}, మరియు ఈ రోజు తేదీ ${dateStr}.`;

    case 'hi':
      if (mode === 'time') return `वर्तमान समय है: ${timeStr}`;
      if (mode === 'date') return `आज की तारीख है: ${dateStr}`;
      return `वर्तमान समय ${timeStr} है, और आज की तारीख ${dateStr} है।`;

    case 'es':
      if (mode === 'time') return `Son las ${timeStr}.`;
      if (mode === 'date') return `Hoy es ${dateStr}.`;
      return `Son las ${timeStr} y hoy es ${dateStr}.`;

    case 'fr':
      if (mode === 'time') return `Il est ${timeStr}.`;
      if (mode === 'date') return `Aujourd'hui, nous sommes le ${dateStr}.`;
      return `Il est ${timeStr} et nous sommes le ${dateStr}.`;

    case 'de':
      if (mode === 'time') return `Es ist ${timeStr}.`;
      if (mode === 'date') return `Heute ist ${dateStr}.`;
      return `Es ist ${timeStr} und heute ist ${dateStr}.`;

    case 'ja':
      if (mode === 'time') return `現在の時刻は ${timeStr} です。`;
      if (mode === 'date') return `本日の日付は ${dateStr} です。`;
      return `現在の時刻は ${timeStr}、本日の日付は ${dateStr} です。`;

    default:
      if (mode === 'time') return `The current time is ${timeStr}.`;
      if (mode === 'date') return `Today is ${dateStr}.`;
      return `The current time is ${timeStr}, and today is ${dateStr}.`;
  }
}
