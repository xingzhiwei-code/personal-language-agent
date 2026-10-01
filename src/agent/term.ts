/**
 * Deterministic extraction of the expression a user is asking about.
 * Cheap, instant, and works with no AI configured.
 */
const QUOTE_PATTERNS = [
  /[“"]([^”"]{1,80})[”"]/,
  /[‘']([^’']{1,80})[’']/,
  /「([^」]{1,80})」/,
  /『([^』]{1,80})』/,
];

export function extractTerm(text: string): string | null {
  for (const pattern of QUOTE_PATTERNS) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      const term = match[1].trim();
      if (term.length > 0) return term;
    }
  }

  // Latin-script span inside an otherwise non-Latin question,
  // e.g. "figure out 是什么意思".
  const hasCjk = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text);
  if (hasCjk) {
    const spans = text.match(/[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){0,4}/g);
    if (spans && spans.length > 0) {
      const longest = spans.sort((a, b) => b.trim().length - a.trim().length)[0];
      if (longest && longest.trim().length >= 2) return longest.trim();
    }
  }

  // "What does X mean?" / "how do you say X"
  const englishAsk =
    /what\s+does\s+(.{1,60}?)\s+mean|meaning\s+of\s+(.{1,60}?)[?.!]?$|how\s+do\s+you\s+say\s+(.{1,60}?)[?.!]?$/i.exec(
      text,
    );
  if (englishAsk) {
    const candidate = (englishAsk[1] ?? englishAsk[2] ?? englishAsk[3] ?? '').trim();
    if (candidate.length > 0) return candidate.replace(/^["'“‘]|["'”’]$/g, '');
  }

  return null;
}
