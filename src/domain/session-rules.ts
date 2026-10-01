import type { SessionStatus } from './enums';
import { invalidTransition } from './errors';

/**
 * Session state machine (PRD §F-03). Leaving a session is never a failure:
 * `abandoned` and `paused` are both legitimate, resumable-by-choice outcomes.
 */
const ALLOWED: Record<SessionStatus, readonly SessionStatus[]> = {
  created: ['active', 'abandoned', 'completed'],
  active: ['paused', 'completed', 'abandoned'],
  paused: ['active', 'completed', 'abandoned'],
  completed: [],
  abandoned: [],
};

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  if (from === to) return true; // idempotent re-submission of the same action
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: SessionStatus, to: SessionStatus): void {
  if (!canTransition(from, to)) throw invalidTransition(from, to);
}

export function isTerminal(status: SessionStatus): boolean {
  return status === 'completed' || status === 'abandoned';
}

export function isResumable(status: SessionStatus): boolean {
  return status === 'created' || status === 'active' || status === 'paused';
}
