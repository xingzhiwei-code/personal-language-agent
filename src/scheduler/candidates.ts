import type { Candidate, SchedulerSnapshot } from './types';

/**
 * Builds the feasible activity set. Feasibility is a hard gate: we never offer
 * an activity we cannot actually deliver (no audio material -> no listening,
 * no AI key -> no conversation recommendation).
 */
export function buildCandidates(snapshot: SchedulerSnapshot): Candidate[] {
  const candidates: Candidate[] = [];
  const dueIds = snapshot.dueReviews.map((review) => review.subjectId);

  if (dueIds.length > 0) {
    candidates.push({
      activityType: 'quick_review',
      minMinutes: 2,
      preferredMinutes: 5,
      itemsPerMinute: 2,
      maxItems: dueIds.length,
      requiresAi: false,
      skills: ['vocabulary'],
      subjectIds: dueIds,
      friction: 0.1,
      reasonHints: [`有 ${dueIds.length} 条到期需要复习`],
    });
  }

  if (snapshot.knowledgeCount > 0) {
    candidates.push({
      activityType: 'vocabulary_recall',
      minMinutes: 2,
      preferredMinutes: 6,
      itemsPerMinute: 1.5,
      maxItems: snapshot.knowledgeCount,
      requiresAi: false,
      skills: ['vocabulary'],
      subjectIds: snapshot.knowledgeItemIds,
      friction: 0.2,
      reasonHints: ['主动回忆比重复认读更能形成长期记忆'],
    });
  }

  if (snapshot.sentenceCount > 0) {
    candidates.push({
      activityType: 'reading',
      minMinutes: 3,
      preferredMinutes: 8,
      itemsPerMinute: 1,
      maxItems: snapshot.sentenceCount,
      requiresAi: false,
      skills: ['reading', 'vocabulary'],
      subjectIds: snapshot.sentenceItemIds,
      friction: 0.15,
      reasonHints: ['在真实句子里再遇到这些表达'],
    });
  }

  if (snapshot.grammarItemCount > 0) {
    candidates.push({
      activityType: 'grammar_practice',
      minMinutes: 3,
      preferredMinutes: 6,
      itemsPerMinute: 1.2,
      maxItems: snapshot.grammarItemCount,
      requiresAi: false,
      skills: ['grammar'],
      subjectIds: snapshot.grammarItemIds,
      friction: 0.25,
      reasonHints: ['针对你记录的语法点做定向练习'],
    });
  }

  if (snapshot.aiAvailable) {
    candidates.push({
      activityType: 'conversation',
      minMinutes: 3,
      preferredMinutes: 10,
      itemsPerMinute: 0,
      maxItems: 0,
      requiresAi: true,
      skills: ['speaking', 'interaction'],
      subjectIds: [],
      friction: 0.35,
      reasonHints: ['用对话把学过的表达真正用出来'],
    });

    if (snapshot.knowledgeCount > 0) {
      candidates.push({
        activityType: 'writing',
        minMinutes: 4,
        preferredMinutes: 8,
        itemsPerMinute: 0.5,
        maxItems: 4,
        requiresAi: true,
        skills: ['writing'],
        subjectIds: snapshot.knowledgeItemIds,
        friction: 0.5,
        reasonHints: ['写出来最能暴露真实的产出差距'],
      });
    }
  }

  // listening / pronunciation are intentionally absent in V0.1:
  // there is no audio material, STT or TTS yet, and we do not fake features.
  return candidates;
}
