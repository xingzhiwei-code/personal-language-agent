import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importWordRelations } from '../../scripts/import-word-relations';
import { createTestHarness, type TestHarness } from '../helpers/context';

describe('word-relation import (v0.5 §W1)', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
  });

  afterEach(() => h.cleanup());

  const deps = (h: TestHarness) => ({
    repository: h.ctx.repos.wordRelations,
    topicWords: { education: ['curriculum'] },
    wordnetRelations: [
      { word: 'curriculum', related: 'syllabus', type: 'synonym' as const },
      { word: 'curriculum', related: 'course', type: 'synonym' as const },
      { word: 'obscureword', related: 'other', type: 'synonym' as const },
    ],
    anchorLemmas: new Set(['curriculum']),
  });

  it('is idempotent: re-running does not double the row count', async () => {
    const first = await importWordRelations(deps(h));
    expect(first.imported).toBeGreaterThan(0);

    const second = await importWordRelations(deps(h));
    expect(second.total).toBe(first.total); // no doubling
    expect(await h.ctx.repos.wordRelations.count()).toBe(first.total);
  });

  it('never imports edges whose source is a non-anchor word', async () => {
    await importWordRelations(deps(h));

    const nonAnchor = await h.ctx.repos.wordRelations.listByLemma('obscureword');
    expect(nonAnchor).toHaveLength(0);

    const anchor = await h.ctx.repos.wordRelations.listByLemma('curriculum');
    expect(anchor.length).toBeGreaterThan(0);
  });
});
