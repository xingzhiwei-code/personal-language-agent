import { describe, expect, it } from 'vitest';
import { isSupported, speak } from '@/lib/speech';

describe('speech module (v0.3 §P2)', () => {
  it('degrades to a no-op when speechSynthesis is unavailable', () => {
    // The Node test environment has no `window`, so the module must stay
    // silent instead of throwing or blocking the study flow.
    expect(isSupported()).toBe(false);
    expect(() => speak('hello')).not.toThrow();
  });
});
