import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeLemma } from '../src/data/wordnet';

/**
 * v0.5 §W1 — one-off offline preprocessor for full WordNet relations.
 *
 * Reads WordNet 3.1 wndb `data.*` files (Princeton WordNet License, see
 * scripts/data/wordnet-LICENSE.txt) and the CET6/IELTS anchor wordlists, then
 * emits `scripts/data/wordnet-relations-full.json` containing only relations
 * whose source lemma is an anchor word (never a whole-WordNet dump).
 *
 * This is a development-time data-prep tool. It is NOT part of the runtime:
 * the import script consumes the emitted JSON, so the runtime never touches
 * WordNet or an LLM (宪法#4).
 *
 * Usage:
 *   npm run build:wordnet-relations
 * (WordNet data files must live in scripts/data/wordnet-3.1/ first.)
 */

const here = dirname(fileURLToPath(import.meta.url));

/** Reads the CET6 + IELTS wordlists (column 0 = word) into a lemma set. */
function readAnchorWords(): Set<string> {
  const anchors = new Set<string>();
  for (const file of ['cet6-wordlist.csv', 'ielts-wordlist.csv']) {
    const text = readFileSync(resolve(here, 'data', file), 'utf8');
    const lines = text.split(/\r?\n/);
    // Skip the header row.
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i]!.trim();
      if (line.length === 0) continue;
      const firstCell = line.split(',')[0]!.trim();
      const word = firstCell.replace(/^"|"$/g, '');
      const lemma = normalizeLemma(word);
      if (lemma.length > 0 && lemma.length <= 200) anchors.add(lemma);
    }
  }
  return anchors;
}

interface Synset {
  offset: string;
  words: string[];
  /** Target synset offsets of `!` (antonym) pointers. */
  antonymOffsets: string[];
  /** Target synset offsets of `+`/`\` (derivationally related) pointers. */
  derivationOffsets: string[];
}

/**
 * Parses one wndb `data.*` line into a Synset. Returns null for non-synset
 * lines (e.g. the license header). Layout:
 *   offset lex_filenum ss_type w_cnt word lex_id [word lex_id ...] p_cnt [ptr ...] | gloss
 * where w_cnt/p_cnt and lex_id/word-num are hexadecimal, and each pointer is
 * `symbol target_offset pos src_tgt` (4 tokens).
 */
function parseSynset(line: string): Synset | null {
  if (!/^\d{8} \d{2} [nvar] /.test(line)) return null;
  const tokens = line.split(/\s+/).filter(Boolean);
  const offset = tokens[0]!;
  const wCnt = parseInt(tokens[3]!, 16);
  const words: string[] = [];
  let idx = 4;
  for (let i = 0; i < wCnt; i += 1) {
    words.push(normalizeLemma(tokens[idx]!));
    idx += 2; // skip lex_id
  }
  const pCnt = parseInt(tokens[idx]!, 16);
  idx += 1;
  const antonymOffsets: string[] = [];
  const derivationOffsets: string[] = [];
  for (let i = 0; i < pCnt; i += 1) {
    const symbol = tokens[idx]!;
    const targetOffset = tokens[idx + 1]!;
    idx += 4; // symbol, target_offset, pos, src_tgt
    if (symbol === '!') antonymOffsets.push(targetOffset);
    else if (symbol === '+' || symbol === '\\') derivationOffsets.push(targetOffset);
  }
  return { offset, words, antonymOffsets, derivationOffsets };
}

function parseDataFile(file: string, synsets: Map<string, Synset>): number {
  const text = readFileSync(resolve(here, 'data/wordnet-3.1', file), 'utf8');
  let parsed = 0;
  for (const line of text.split(/\r?\n/)) {
    const synset = parseSynset(line);
    if (!synset) continue;
    synsets.set(synset.offset, synset);
    parsed += 1;
  }
  return parsed;
}

interface RelationEdge {
  word: string;
  related: string;
  type: 'synonym' | 'antonym' | 'word_family';
}

function main(): void {
  const anchors = readAnchorWords();
  const synsets = new Map<string, Synset>();
  let totalSynsets = 0;
  for (const file of ['data.noun', 'data.verb', 'data.adj', 'data.adv']) {
    totalSynsets += parseDataFile(file, synsets);
  }

  const edges = new Map<string, RelationEdge>();
  const keyOf = (word: string, related: string, type: string) =>
    `${word}\u0000${related}\u0000${type}`;
  const addEdge = (word: string, related: string, type: RelationEdge['type']) => {
    if (word === related) return;
    const key = keyOf(word, related, type);
    if (!edges.has(key)) edges.set(key, { word, related, type });
  };

  let anchorSynsetHits = 0;
  const seenAnchorWords = new Set<string>();
  for (const synset of synsets.values()) {
    const anchorWords = synset.words.filter((word) => anchors.has(word));
    if (anchorWords.length === 0) continue;
    anchorSynsetHits += 1;
    for (const anchor of anchorWords) {
      seenAnchorWords.add(anchor);
      for (const other of synset.words) {
        if (other === anchor) continue;
        addEdge(anchor, other, 'synonym');
      }
      for (const targetOffset of synset.antonymOffsets) {
        const target = synsets.get(targetOffset);
        if (!target) continue;
        for (const related of target.words) addEdge(anchor, related, 'antonym');
      }
      for (const targetOffset of synset.derivationOffsets) {
        const target = synsets.get(targetOffset);
        if (!target) continue;
        for (const related of target.words) addEdge(anchor, related, 'word_family');
      }
    }
  }

  const relations = [...edges.values()].sort(
    (a, b) => a.word.localeCompare(b.word) || a.related.localeCompare(b.related) || a.type.localeCompare(b.type),
  );

  const counts = { synonym: 0, antonym: 0, word_family: 0 };
  for (const edge of relations) counts[edge.type] += 1;

  const output = {
    _source:
      'WordNet 3.1 (Princeton WordNet License — see scripts/data/wordnet-LICENSE.txt). ' +
      'Synonym / antonym / derivationally-related (word family) relations, filtered to the ' +
      'CET6 + IELTS anchor wordlists. Not public domain; the copyright notice must be retained.',
    anchorWordCount: anchors.size,
    anchorWordHitCount: seenAnchorWords.size,
    relationCounts: counts,
    relations,
  };
  const outPath = resolve(here, 'data/wordnet-relations-full.json');
  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);

  console.log(`[build-wordnet-relations] synsets parsed: ${totalSynsets}`);
  console.log(`[build-wordnet-relations] anchor words: ${anchors.size}`);
  console.log(
    `[build-wordnet-relations] anchor words hit in WordNet: ${seenAnchorWords.size} (across ${anchorSynsetHits} synsets)`,
  );
  console.log(`[build-wordnet-relations] relation edges: ${relations.length}`);
  console.log(`  synonym=${counts.synonym} antonym=${counts.antonym} word_family=${counts.word_family}`);
  console.log(`[build-wordnet-relations] wrote ${outPath}`);
}

main();
