import type { KnowledgeItem, LearnerState } from '@/domain/entities';
import type { ActivityKind, Modality } from '@/domain/enums';
import { languageLabel } from '@/language/registry';
import { nextUsefulModality } from '@/learner/skills';

export interface ReviewItemSpec {
  kind: ActivityKind;
  modality: Modality;
  subjectId: string;
  prompt: string;
  options: string[] | null;
  expectedAnswer: string | null;
  hint: string | null;
}

/** Seeded PRNG so generated reviews are reproducible in tests. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: T[], random: () => number): T[] {
  const output = [...list];
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = output[i] as T;
    const b = output[j] as T;
    output[i] = b;
    output[j] = a;
  }
  return output;
}

export interface BuildReviewItemsInput {
  entries: { item: KnowledgeItem; state: LearnerState | null }[];
  /** Other items used as multiple-choice distractors. */
  distractorPool: KnowledgeItem[];
  limit: number;
  seed?: number;
}

/**
 * Turns knowledge items into concrete review questions.
 *
 * Question type is chosen by what would add the most information about the
 * learner (recognition -> recall -> production), limited by the data we
 * actually have. Nothing here calls an LLM.
 */
export function buildReviewItems(input: BuildReviewItemsInput): ReviewItemSpec[] {
  const random = mulberry32(input.seed ?? 20240101);
  const specs: ReviewItemSpec[] = [];

  const meanings = input.distractorPool
    .map((item) => item.meaning?.trim())
    .filter((meaning): meaning is string => !!meaning && meaning.length > 0);

  for (const entry of input.entries) {
    if (specs.length >= input.limit) break;
    const { item, state } = entry;
    const label = languageLabel(item.languageCode);
    const desired: Modality = state ? nextUsefulModality(state) : 'recognition';
    const meaning = item.meaning?.trim() ?? '';
    const cloze = findClozeExample(item);

    // 1) Recognition MCQ — needs a meaning plus three distinct distractors.
    const distractors = shuffle(
      meanings.filter((candidate) => candidate !== meaning),
      random,
    ).slice(0, 3);

    if (desired === 'recognition' && meaning && distractors.length === 3) {
      specs.push({
        kind: 'review_recognition',
        modality: 'recognition',
        subjectId: item.id,
        prompt: `「${item.text}」的意思是？`,
        options: shuffle([meaning, ...distractors], random),
        expectedAnswer: meaning,
        hint: null,
      });
      continue;
    }

    // 2) Production cloze — strongest evidence when an example exists.
    if (desired === 'production' && cloze) {
      specs.push({
        kind: 'review_production',
        modality: 'production',
        subjectId: item.id,
        prompt: `补全这个句子：${cloze}`,
        options: null,
        expectedAnswer: item.text,
        hint: meaning || null,
      });
      continue;
    }

    // 3) Recall — produce the target form from its meaning.
    if (meaning) {
      specs.push({
        kind: 'review_recall',
        modality: 'recall',
        subjectId: item.id,
        prompt: `「${meaning}」用${label}怎么表达？`,
        options: null,
        expectedAnswer: item.text,
        hint: item.text.length > 2 ? `${item.text.slice(0, 1)}…` : null,
      });
      continue;
    }

    // 4) Cloze without a meaning still measures production.
    if (cloze) {
      specs.push({
        kind: 'review_production',
        modality: 'production',
        subjectId: item.id,
        prompt: `补全这个句子：${cloze}`,
        options: null,
        expectedAnswer: item.text,
        hint: null,
      });
      continue;
    }

    // 5) No meaning, no example: ask the learner honestly (self-report).
    specs.push({
      kind: 'review_recall',
      modality: 'recall',
      subjectId: item.id,
      prompt: `你还记得「${item.text}」的意思吗？`,
      options: null,
      expectedAnswer: null,
      hint: '这条还没有释义，可以在知识库里补充',
    });
  }

  return specs;
}

/** Replaces the target expression inside an example sentence with a blank. */
function findClozeExample(item: KnowledgeItem): string | null {
  const needle = item.text.trim();
  if (needle.length === 0) return null;
  for (const example of item.examples) {
    const text = example.text;
    const index = text.toLowerCase().indexOf(needle.toLowerCase());
    if (index >= 0) {
      return `${text.slice(0, index)}______${text.slice(index + needle.length)}`;
    }
  }
  return null;
}
