import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const SRC = join(ROOT, 'src');

function listFiles(dir: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) output.push(...listFiles(full));
    else if (/\.tsx?$/.test(entry)) output.push(full);
  }
  return output;
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  const patterns = [
    /import\s[^;]*?from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(source);
    while (match) {
      if (match[1]) specifiers.push(match[1]);
      match = pattern.exec(source);
    }
  }
  return specifiers;
}

const FORBIDDEN_IN_DOMAIN = [
  'react',
  'react-dom',
  'next',
  'next/',
  'drizzle-orm',
  'drizzle-orm/',
  'better-sqlite3',
  'node:fs',
  'node:fs/promises',
  'fs',
  'openai',
  '@anthropic-ai/sdk',
  '@google/generative-ai',
  'cos-nodejs-sdk-v5',
  '@aws-sdk/client-s3',
];

/**
 * Architecture boundaries are enforced by a test, not by convention
 * (PRD §12.11). Dependency direction: Domain <- Application <- Infrastructure <- UI.
 */
describe('architecture boundaries', () => {
  const pureLayers = ['domain', 'learner', 'scheduler', 'nlu', 'language', 'assessment'];

  for (const layer of pureLayers) {
    it(`src/${layer} does not depend on UI, ORM, database, fs or vendor AI SDKs`, () => {
      const files = listFiles(join(SRC, layer));
      expect(files.length).toBeGreaterThan(0);

      const violations: string[] = [];
      for (const file of files) {
        for (const specifier of importsOf(file)) {
          if (FORBIDDEN_IN_DOMAIN.some((banned) => specifier === banned || specifier.startsWith(`${banned}/`))) {
            violations.push(`${relative(ROOT, file)} -> ${specifier}`);
          }
          if (specifier.startsWith('@/infrastructure') || specifier.startsWith('@/app')) {
            violations.push(`${relative(ROOT, file)} -> ${specifier}`);
          }
        }
      }
      expect(violations).toEqual([]);
    });
  }

  it('src/domain only imports from itself (and zod)', () => {
    const files = listFiles(join(SRC, 'domain'));
    const violations: string[] = [];
    for (const file of files) {
      for (const specifier of importsOf(file)) {
        const allowed =
          specifier === 'zod' || specifier.startsWith('./') || specifier.startsWith('../');
        if (!allowed) violations.push(`${relative(ROOT, file)} -> ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('the application layer never imports infrastructure directly', () => {
    const files = listFiles(join(SRC, 'application'));
    const violations: string[] = [];
    for (const file of files) {
      for (const specifier of importsOf(file)) {
        if (specifier.startsWith('@/infrastructure') || specifier === 'better-sqlite3') {
          violations.push(`${relative(ROOT, file)} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('the agent never touches the database, ORM or infrastructure', () => {
    const files = listFiles(join(SRC, 'agent'));
    const violations: string[] = [];
    for (const file of files) {
      for (const specifier of importsOf(file)) {
        if (
          specifier.startsWith('@/infrastructure') ||
          specifier.includes('drizzle') ||
          specifier === 'better-sqlite3'
        ) {
          violations.push(`${relative(ROOT, file)} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('the learner model, scheduler and event handling contain no LLM calls', () => {
    const files = [
      ...listFiles(join(SRC, 'learner')),
      ...listFiles(join(SRC, 'scheduler')),
      ...listFiles(join(SRC, 'assessment')),
      join(SRC, 'application/assessment.ts'),
      join(SRC, 'application/events.ts'),
      join(SRC, 'application/learner-state.ts'),
      join(SRC, 'application/recommendations.ts'),
    ];

    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // `ctx.llm` may only appear as a capability *flag* check, never a call.
      if (/\.llm\.complete\s*\(/.test(source)) {
        violations.push(`${relative(ROOT, file)} calls llm.complete`);
      }
      if (/\bfetch\s*\(/.test(source)) {
        violations.push(`${relative(ROOT, file)} performs network I/O`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('no cloud storage or vendor AI SDK is a project dependency in V0.1', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const banned of [
      'cos-nodejs-sdk-v5',
      '@aws-sdk/client-s3',
      'openai',
      '@anthropic-ai/sdk',
      '@google/generative-ai',
    ]) {
      expect(all[banned]).toBeUndefined();
    }
  });

  it('secrets are only read from environment variables', () => {
    const files = listFiles(SRC);
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // Long literal keys / bearer tokens must never be committed.
      if (/sk-[A-Za-z0-9]{16,}/.test(source)) {
        violations.push(`${relative(ROOT, file)} contains a literal API key`);
      }
    }
    expect(violations).toEqual([]);
  });
});
