import { describe, expect, test } from 'bun:test';
import { runHarnessPlanRfc } from './harness-plan-rfc.js';

const NOW = new Date('2026-09-04T12:00:00.000Z');
const MARKDOWN = '# RFC — Harness plan\n\n본문';

function deps(overrides: Parameters<typeof runHarnessPlanRfc>[2] = {}) {
  const writes: Array<[string, string]> = [];
  const lines: string[] = [];
  return {
    writes,
    lines,
    deps: {
      now: () => NOW,
      rootDir: '/repo',
      env: { ELANOUS_HARNESS_SPACE_ID: '' },
      exists: () => false,
      write: (path: string, markdown: string) => { writes.push([path, markdown]); },
      print: (line: string) => { lines.push(line); },
      author: async () => ({ markdown: MARKDOWN, title: 'RFC — Harness plan', arcs: [], openQuestions: ['범위를 확정할까?'] }),
      ...overrides,
    },
  };
}

describe('runHarnessPlanRfc', () => {
  test('authors injected markdown into the repository RFC convention and prints questions', async () => {
    const fixture = deps();
    const result = await runHarnessPlanRfc('Harness plan RFC를 만든다', {}, fixture.deps);

    expect(result.path).toBe('docs/RFC-harness-plan-rfc를-만든다-2026-09-04.md');
    expect(fixture.writes).toEqual([['/repo/docs/RFC-harness-plan-rfc를-만든다-2026-09-04.md', MARKDOWN]]);
    expect(fixture.lines).toEqual([
      `RFC 작성: ${result.path}`,
      '열린 질문: 범위를 확정할까?',
    ]);
  });

  test('dry-run prints the target without writing', async () => {
    const fixture = deps();
    const result = await runHarnessPlanRfc('Dry run RFC', { dryRun: true }, fixture.deps);

    expect(result.dryRun).toBe(true);
    expect(result.path).toBe('docs/RFC-dry-run-rfc-2026-09-04.md');
    expect(fixture.writes).toEqual([]);
    expect(fixture.lines).toEqual([`[dry-run] RFC 경로: ${result.path}`, '열린 질문: 범위를 확정할까?']);
  });

  test('refuses a same-day RFC collision before authoring', async () => {
    let authored = false;
    const fixture = deps({
      exists: () => true,
      author: async () => {
        authored = true;
        return { markdown: MARKDOWN, title: 'RFC — Harness plan', arcs: [], openQuestions: [] };
      },
    });

    await expect(runHarnessPlanRfc('Collision RFC', {}, fixture.deps)).rejects.toThrow('RFC 파일이 이미 있습니다: docs/RFC-collision-rfc-2026-09-04.md');
    expect(authored).toBe(false);
    expect(fixture.writes).toEqual([]);
  });

  test('refuses a harness child before collision checks, authoring, or writes', async () => {
    let checkedCollision = false;
    let authored = false;
    const fixture = deps({
      env: { ELANOUS_HARNESS_SPACE_ID: ' child-space ' },
      exists: () => { checkedCollision = true; return false; },
      author: async () => {
        authored = true;
        return { markdown: MARKDOWN, title: 'RFC — Harness plan', arcs: [], openQuestions: [] };
      },
    });

    await expect(runHarnessPlanRfc('Child RFC', {}, fixture.deps)).rejects.toThrow('하니스 자식은 plan RFC를 저작할 수 없습니다; 사람 셸에서 harness plan을 실행하세요.');
    expect(checkedCollision).toBe(false);
    expect(authored).toBe(false);
    expect(fixture.writes).toEqual([]);
    expect(fixture.lines).toEqual([]);
  });

  test('refuses a harness child dry-run before authoring', async () => {
    let authored = false;
    const fixture = deps({
      env: { ELANOUS_HARNESS_SPACE_ID: 'child-space' },
      author: async () => {
        authored = true;
        return { markdown: MARKDOWN, title: 'RFC — Harness plan', arcs: [], openQuestions: [] };
      },
    });

    await expect(runHarnessPlanRfc('Child dry run RFC', { dryRun: true }, fixture.deps)).rejects.toThrow('하니스 자식은 plan RFC를 저작할 수 없습니다; 사람 셸에서 harness plan을 실행하세요.');
    expect(authored).toBe(false);
    expect(fixture.writes).toEqual([]);
    expect(fixture.lines).toEqual([]);
  });

  test('treats an empty harness-space marker as a normal human shell', async () => {
    const fixture = deps({ env: { ELANOUS_HARNESS_SPACE_ID: '   ' } });

    const result = await runHarnessPlanRfc('Empty marker RFC', {}, fixture.deps);

    expect(result.path).toBe('docs/RFC-empty-marker-rfc-2026-09-04.md');
    expect(fixture.writes).toEqual([['/repo/docs/RFC-empty-marker-rfc-2026-09-04.md', MARKDOWN]]);
  });
});
