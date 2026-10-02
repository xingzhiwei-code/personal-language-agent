import { describe, expect, it } from 'vitest';
import type { LearnerState, UserContext } from '@/domain/entities';
import { createInitialState } from '@/learner/state';
import { scoreCandidates } from '@/scheduler/scoring';
import type { SchedulerSnapshot } from '@/scheduler/types';

const NOW = '2026-01-10T10:00:00.000Z';

function skillState(skill: string, mastery: number, confidence = 0.4): LearnerState {
  return {
    ...createInitialState({
      id: `state-${skill}`,
      learnerId: 'learner-1',
      subjectType: 'skill',
      subjectId: skill,
      nowIso: NOW,
    }),
    mastery,
    confidence,
  };
}

function context(partial: Partial<UserContext> = {}): UserContext {
  return {
    id: 'ctx-1',
    learnerId: 'learner-1',
    capturedAt: NOW,
    availableMinutes: null,
    device: 'desktop',
    canSpeak: true,
    canListen: true,
    canType: true,
    canRead: true,
    attention: 'medium',
    intent: 'unknown',
    note: null,
    rawInput: null,
    ...partial,
  };
}

function snapshot(partial: Partial<SchedulerSnapshot> = {}): SchedulerSnapshot {
  return {
    nowIso: NOW,
    goal: { id: 'goal-1', languageCode: 'en', title: '提高英语口语', priority: 1 },
    targets: [
      { skill: 'speaking', importance: 1 },
      { skill: 'vocabulary', importance: 0.7 },
    ],
    skillStates: [skillState('speaking', 0.2), skillState('vocabulary', 0.5)],
    dueReviews: [
      { subjectId: 'item-1', mastery: 0.2, overdueDays: 1, suggestedModality: 'recall' },
      { subjectId: 'item-2', mastery: 0.3, overdueDays: 0, suggestedModality: 'recognition' },
    ],
    knowledgeCount: 12,
    knowledgeItemIds: ['item-1', 'item-2'],
    sentenceCount: 4,
    sentenceItemIds: ['item-1'],
    grammarItemCount: 0,
    grammarItemIds: [],
    context: context(),
    preferences: [],
    recentActivityTypes: [],
    aiAvailable: true,
    rejectedActivityTypes: [],
    ...partial,
  };
}

describe('deterministic scheduling', () => {
  it('produces the same ranking for the same snapshot', () => {
    const first = scoreCandidates(snapshot());
    const second = scoreCandidates(snapshot());
    expect(first.map((entry) => entry.activityType)).toEqual(
      second.map((entry) => entry.activityType),
    );
    expect(first[0]?.score).toBe(second[0]?.score);
  });

  it('never recommends an activity longer than the available time', () => {
    const scored = scoreCandidates(
      snapshot({ context: context({ availableMinutes: 3 }) }),
    );
    expect(scored.length).toBeGreaterThan(0);
    for (const candidate of scored) {
      expect(candidate.plannedDurationMinutes).toBeLessThanOrEqual(3);
    }
    // A 4-minute minimum activity must be filtered out entirely.
    expect(scored.some((candidate) => candidate.activityType === 'writing')).toBe(false);
  });

  it('prioritises due reviews when nothing else is declared', () => {
    const scored = scoreCandidates(snapshot());
    expect(scored[0]?.activityType).toBe('quick_review');
    expect(scored[0]?.reason).toContain('复习');
  });

  it('lets an explicit "I just want to chat" intent win over scoring', () => {
    const scored = scoreCandidates(
      snapshot({ context: context({ intent: 'conversation' }) }),
    );
    expect(scored[0]?.activityType).toBe('conversation');
  });

  it('does not offer AI activities when no provider is configured', () => {
    const scored = scoreCandidates(snapshot({ aiAvailable: false }));
    expect(scored.every((candidate) => !candidate.requiresAi)).toBe(true);
    expect(scored.length).toBeGreaterThan(0);
  });

  it('suppresses a just-rejected activity without deleting it forever', () => {
    const scored = scoreCandidates(snapshot({ rejectedActivityTypes: ['quick_review'] }));
    expect(scored[0]?.activityType).not.toBe('quick_review');
    expect(scored.some((candidate) => candidate.activityType === 'quick_review')).toBe(true);
  });

  it('penalises repeating the same activity three times in a row', () => {
    const repeated = scoreCandidates(
      snapshot({ recentActivityTypes: ['quick_review', 'quick_review', 'quick_review'] }),
    );
    const fresh = scoreCandidates(snapshot());
    const repeatedScore =
      repeated.find((candidate) => candidate.activityType === 'quick_review')?.score ?? 0;
    const freshScore =
      fresh.find((candidate) => candidate.activityType === 'quick_review')?.score ?? 0;
    expect(repeatedScore).toBeLessThan(freshScore);
  });

  it('respects device/attention constraints through contextFit', () => {
    const noTyping = scoreCandidates(
      snapshot({ context: context({ canType: false, canRead: true }) }),
    );
    const writing = noTyping.find((candidate) => candidate.activityType === 'writing');
    const review = noTyping.find((candidate) => candidate.activityType === 'quick_review');
    expect(writing?.factors.contextFit ?? 0).toBeLessThan(review?.factors.contextFit ?? 1);
  });

  it('returns an empty list when there is nothing to do yet', () => {
    const scored = scoreCandidates(
      snapshot({
        dueReviews: [],
        knowledgeCount: 0,
        sentenceCount: 0,
        grammarItemCount: 0,
        aiAvailable: false,
      }),
    );
    expect(scored).toEqual([]);
  });

  it('gives a real, non-empty reason for the top recommendation', () => {
    const scored = scoreCandidates(snapshot());
    expect(scored[0]?.reason.length ?? 0).toBeGreaterThan(4);
    expect(scored[0]?.reason).toContain('分钟');
  });
});
