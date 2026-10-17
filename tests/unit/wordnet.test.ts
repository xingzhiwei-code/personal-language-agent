import { describe, expect, it } from 'vitest';
import {
  buildWordRelations,
  normalizeLemma,
  relationId,
} from '@/data/wordnet';

describe('normalizeLemma', () => {
  it('lowercases and collapses underscores/hyphens to spaces', () => {
    expect(normalizeLemma('Take_A_Breath')).toBe('take a breath');
    expect(normalizeLemma('by-product')).toBe('by product');
    expect(normalizeLemma('  Entity  ')).toBe('entity');
  });
});

describe('relationId', () => {
  it('is deterministic and discriminates on type/topic', () => {
    const a = relationId('run', 'jog', 'synonym', null);
    const b = relationId('run', 'jog', 'synonym', null);
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
    expect(relationId('run', 'jog', 'antonym', null)).not.toBe(a);
    expect(relationId('run', 'jog', 'topic', 'education')).not.toBe(a);
  });
});

describe('buildWordRelations', () => {
  const topicWords = { education: ['curriculum', 'syllabus'] };
  const wordnetRelations = [
    { word: 'curriculum', related: 'syllabus', type: 'synonym' as const },
    { word: 'curriculum', related: 'course', type: 'synonym' as const },
    { word: 'syllabus', related: 'program', type: 'synonym' as const },
  ];

  it('keeps only anchor words for WordNet rows (non-anchor has no edges)', () => {
    const relations = buildWordRelations({
      topicWords: {},
      wordnetRelations,
      anchorLemmas: new Set(['curriculum']),
    });

    // Only `curriculum` is an anchor; `syllabus`/`course` edges are dropped.
    const wordnet = relations.filter((r) => r.source === 'wordnet');
    expect(wordnet).toHaveLength(2);
    expect(wordnet.every((r) => r.wordLemma === 'curriculum')).toBe(true);
    // A source lemma that is not an anchor must never appear.
    expect(wordnet.some((r) => r.wordLemma === 'syllabus')).toBe(false);
  });

  it('never anchor-filters topic rows (v0.4 curated list)', () => {
    const relations = buildWordRelations({
      topicWords,
      wordnetRelations: [],
      anchorLemmas: new Set(), // empty anchors
    });
    const topics = relations.filter((r) => r.source === 'topic_list');
    expect(topics).toHaveLength(2);
    expect(topics.map((r) => r.wordLemma).sort()).toEqual(['curriculum', 'syllabus']);
  });

  it('assigns deterministic ids so a re-run is a no-op', () => {
    const build = () =>
      buildWordRelations({
        topicWords,
        wordnetRelations,
        anchorLemmas: new Set(['curriculum', 'syllabus']),
      });
    const first = build();
    const second = build();
    expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id));
  });
});
