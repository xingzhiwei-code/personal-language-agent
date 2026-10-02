import type { LearnerState, LearningPreference, UserContext } from '@/domain/entities';
import type { ActivityType, Modality, SkillKind } from '@/domain/enums';

export interface DueReviewSummary {
  subjectId: string;
  mastery: number;
  overdueDays: number;
  /** Modality that would add the most information for this item. */
  suggestedModality: Modality;
}

export interface SchedulerSnapshot {
  nowIso: string;
  goal: {
    id: string;
    languageCode: string;
    title: string;
    priority: number;
  } | null;
  targets: { skill: SkillKind; importance: number }[];
  /** Skill-level learner states (subjectType === 'skill'). */
  skillStates: LearnerState[];
  dueReviews: DueReviewSummary[];
  /** Total active knowledge items available for practice. */
  knowledgeCount: number;
  knowledgeItemIds: string[];
  /** Items that can drive reading/production practice (have example sentences). */
  sentenceCount: number;
  sentenceItemIds: string[];
  grammarItemCount: number;
  grammarItemIds: string[];
  context: UserContext | null;
  preferences: LearningPreference[];
  /** Most recent first. */
  recentActivityTypes: ActivityType[];
  aiAvailable: boolean;
  /** Activity types the user just rejected — a transient nudge, not a preference. */
  rejectedActivityTypes: ActivityType[];
}

export interface Candidate {
  activityType: ActivityType;
  minMinutes: number;
  preferredMinutes: number;
  /** Items per minute, used to size the activity. */
  itemsPerMinute: number;
  maxItems: number;
  requiresAi: boolean;
  /** Skills this activity measures. */
  skills: SkillKind[];
  subjectIds: string[];
  /** Operational cost for the user: typing, headphones, waiting, etc. (0..1). */
  friction: number;
  reasonHints: string[];
}

export interface ScoredCandidate {
  activityType: ActivityType;
  score: number;
  factors: {
    learningValue: number;
    urgency: number;
    goalAlignment: number;
    contextFit: number;
    durationFit: number;
    preferenceFit: number;
    novelty: number;
    repetitionPenalty: number;
    friction: number;
  };
  plannedDurationMinutes: number;
  estimatedItemCount: number;
  subjectIds: string[];
  requiresAi: boolean;
  reason: string;
}
