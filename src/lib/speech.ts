/**
 * Word pronunciation via the Web Speech API (v0.3 §P2).
 *
 * This is "reading a word out loud", NOT pronunciation scoring — there is no
 * STT here and we never fake feedback. Callers depend only on `speak(text)`
 * and `isSupported()`, so tests can mock this module without touching the
 * browser API.
 *
 * Degradation contract: when the API is unavailable or autoplay is blocked,
 * `speak` silently does nothing and never throws. The caller keeps the manual
 * replay button; only the automatic first playback is skipped.
 */

export interface SpeechOptions {
  /** BCP-47 language tag. Defaults to en-US. */
  lang?: string;
  /** Playback rate. Defaults to 0.9 (slightly slower for learners). */
  rate?: number;
}

/** True when `speechSynthesis` is available in the current environment. */
export function isSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Speaks `text` aloud. No-op when unsupported. Never throws. */
export function speak(text: string, options: SpeechOptions = {}): void {
  if (!isSupported() || text.trim().length === 0) return;
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = options.lang ?? 'en-US';
    utterance.rate = options.rate ?? 0.9;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Autoplay policy or a broken voice list must never break the study flow.
  }
}
