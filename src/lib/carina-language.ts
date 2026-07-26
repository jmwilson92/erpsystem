/**
 * Carina reply / TTS / speech-recognition language.
 * Default is always English until the user asks to switch.
 */

export const LANG_KEY = "forge-carina-lang";

export type CarinaLang = {
  /** BCP-47 for Web Speech + xAI TTS (e.g. en-US, es-ES) */
  code: string;
  /** Human name for prompts */
  name: string;
};

/** Supported spoken languages (expand carefully — needs TTS + STT support). */
export const CARINA_LANGUAGES: CarinaLang[] = [
  { code: "en-US", name: "English" },
  { code: "es-ES", name: "Spanish" },
  { code: "es-MX", name: "Spanish (Mexico)" },
  { code: "fr-FR", name: "French" },
  { code: "de-DE", name: "German" },
  { code: "pt-BR", name: "Portuguese (Brazil)" },
  { code: "it-IT", name: "Italian" },
  { code: "ja-JP", name: "Japanese" },
  { code: "ko-KR", name: "Korean" },
  { code: "zh-CN", name: "Chinese (Simplified)" },
  { code: "hi-IN", name: "Hindi" },
  { code: "ar-SA", name: "Arabic" },
];

const byName = new Map(
  CARINA_LANGUAGES.flatMap((l) => {
    const keys = [l.name.toLowerCase()];
    // aliases
    if (l.code.startsWith("en")) keys.push("english", "en", "inglés", "ingles");
    if (l.code.startsWith("es"))
      keys.push("spanish", "español", "espanol", "es");
    if (l.code.startsWith("fr")) keys.push("french", "français", "francais", "fr");
    if (l.code.startsWith("de")) keys.push("german", "deutsch", "de");
    if (l.code.startsWith("pt")) keys.push("portuguese", "português", "portugues", "pt");
    if (l.code.startsWith("it")) keys.push("italian", "italiano", "it");
    if (l.code.startsWith("ja")) keys.push("japanese", "日本語", "ja");
    if (l.code.startsWith("ko")) keys.push("korean", "한국어", "ko");
    if (l.code.startsWith("zh")) keys.push("chinese", "mandarin", "中文", "zh");
    if (l.code.startsWith("hi")) keys.push("hindi", "हिन्दी", "hi");
    if (l.code.startsWith("ar")) keys.push("arabic", "العربية", "ar");
    return keys.map((k) => [k, l] as const);
  })
);

export const DEFAULT_LANG: CarinaLang = CARINA_LANGUAGES[0];

export function resolveLang(codeOrName?: string | null): CarinaLang {
  if (!codeOrName?.trim()) return DEFAULT_LANG;
  const raw = codeOrName.trim();
  const byCode = CARINA_LANGUAGES.find(
    (l) => l.code.toLowerCase() === raw.toLowerCase()
  );
  if (byCode) return byCode;
  // en, es, …
  const short = CARINA_LANGUAGES.find((l) =>
    l.code.toLowerCase().startsWith(raw.toLowerCase() + "-")
  );
  if (short && raw.length <= 3) return short;
  return byName.get(raw.toLowerCase()) || DEFAULT_LANG;
}

export function loadStoredLang(): CarinaLang {
  if (typeof window === "undefined") return DEFAULT_LANG;
  try {
    return resolveLang(localStorage.getItem(LANG_KEY));
  } catch {
    return DEFAULT_LANG;
  }
}

export function storeLang(lang: CarinaLang) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LANG_KEY, lang.code);
  } catch {
    // ignore
  }
}

/**
 * Detect "speak Spanish", "switch to French", "in English please", etc.
 * Returns null if not a language-switch request.
 */
export function detectLanguageSwitch(text: string): CarinaLang | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;

  // Explicit switch patterns
  const patterns = [
    /(?:speak|talk|reply|answer|switch(?:\s+to)?|change(?:\s+to)?|use|in)\s+([a-z\u00c0-\u024f]{2,}(?:\s*\([^)]+\))?)/i,
    /(?:habla|responde|cambia(?:\s+a)?|en)\s+([a-z\u00c0-\u024f]{2,})/i,
    /(?:parle|réponds|en)\s+([a-z\u00c0-\u024f]{2,})/i,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (!m?.[1]) continue;
    const candidate = m[1].replace(/\s+/g, " ").trim();
    // Avoid matching "in progress" etc.
    if (
      /progress|order|stock|review|production|quality|purchasing|english\s+only/.test(
        candidate
      )
    ) {
      continue;
    }
    const lang = resolveLang(candidate);
    if (lang.name.toLowerCase() === candidate || byName.has(candidate)) {
      return lang;
    }
    // "spanish please"
    const first = candidate.split(/\s+/)[0];
    const l2 = resolveLang(first);
    if (byName.has(first) || l2 !== DEFAULT_LANG || first === "english") {
      return l2;
    }
  }

  // Bare: "Spanish" / "English" alone
  if (/^[a-z\u00c0-\u024f]{3,20}$/i.test(t) && byName.has(t)) {
    return resolveLang(t);
  }

  return null;
}

/** Short language code for xAI TTS (`en`, `es`, `fr`…) */
export function ttsLanguageCode(lang: CarinaLang): string {
  return lang.code.split("-")[0] || "en";
}
