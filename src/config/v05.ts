/**
 * v0.5 centralised configuration. Nothing here is scattered across the code:
 * the WordNet anchor wordlists (W1) and the auto-calibration thresholds (W3)
 * live in this single module.
 */

/** Anchor wordlist files for the WordNet import (v0.5 §W1). Relative to scripts/data/. */
export const ANCHOR_WORDLIST_FILES = ['cet6-wordlist.csv', 'ielts-wordlist.csv'] as const;

/** Learning days of evidence required before a calibration estimate is computed (v0.5 §W3). */
export const CALIBRATION_LEARNING_DAY_WINDOW = 14;

/** Minimum |estimated − current| band change to surface a suggestion (v0.5 §W3). */
export const CALIBRATION_TRIGGER_THRESHOLD = 0.5;

/** Maximum single-step band change (anti-jitter) (v0.5 §W3). */
export const CALIBRATION_MAX_STEP = 1.0;

/** Mastery at/above which a word counts as "mastered" for the estimate. */
export const CALIBRATION_MASTERY_THRESHOLD = 0.7;

/** `learning_preferences` key for the "adaptive starting point" switch (default off). */
export const AUTO_CALIBRATION_PREFERENCE_KEY = 'auto_calibration_enabled';

/** `learning_preferences` key storing the last acknowledged suggestion value (避免重复打扰). */
export const AUTO_CALIBRATION_ACKNOWLEDGED_KEY = 'auto_calibration_acknowledged';
