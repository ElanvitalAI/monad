// ── GET /v1/design-check — the wire body must preserve WHY, not just WHAT ──
//
// The CLI collapses "nothing missing", "something missing", and "could not
// read a path" into one exit code. A browser panel cannot render from that.
// These tests pin the three things the wire body has to keep distinct, and
// the two-roots rule that lets a daemon inspect a project it does not live in.

import { describe, test, expect } from 'bun:test';
import { buildDesignCheckView, type DesignCheckRouteDeps } from './design-check';

function overrides(
  repoRoot: string | null,
  files: Record<string, string>,
  dirs: Record<string, string[]>,
  craftDirectory = '/monad/docs/design/craft',
): Partial<DesignCheckRouteDeps> {
  return {
    repoRoot: () => repoRoot,
    craftDirectory: () => craftDirectory,
    readFile: (path) => {
      const found = files[path];
      if (found === undefined) throw new Error(`ENOENT: ${path}`);
      return found;
    },
    readdir: (path) => {
      const found = dirs[path];
      if (found === undefined) throw new Error(`ENOENT: scandir ${path}`);
      return found;
    },
  };
}

const CRAFT = '/monad/docs/design/craft';

describe('GET /v1/design-check — healthy repository', () => {
  test('carries all three rulebook lists plus the CLI exit code', () => {
    const body = buildDesignCheckView(overrides(
      '/work/project',
      { '/work/project/DESIGN.md': '## Craft rulebooks\n- color\n' },
      { [CRAFT]: ['color.md', 'typography.md', 'NOTICE.md'] },
    ));

    expect(body.ok).toBe(true);
    expect(body.repoRoot).toBe('/work/project');
    expect(body.declaredRulebooks).toEqual(['color']);
    expect(body.unavailableRulebooks).toEqual([]);
    expect(body.availableRulebooks).toEqual(['color', 'typography']);
    expect(body.exitCode).toBe(0);
  });

  test('⭐ the two roots are DIFFERENT — DESIGN.md from the repo, craft/ from monad', () => {
    // This is the rule `#11793` established. If the route ever resolved the
    // craft directory relative to the inspected repository, a project outside
    // the monad tree would report every rulebook as unavailable — which is
    // indistinguishable from a genuinely broken DESIGN.md.
    const body = buildDesignCheckView(overrides(
      '/somewhere/else/entirely',
      { '/somewhere/else/entirely/DESIGN.md': '## Craft rulebooks\n- color\n' },
      { [CRAFT]: ['color.md'] },
    ));
    expect(body.ok).toBe(true);
    expect(body.documentPath).toBe('/somewhere/else/entirely/DESIGN.md');
    expect(body.craftDirectory).toBe(CRAFT);
    expect(body.unavailableRulebooks).toEqual([]);
  });

  test('a declared-but-missing rulebook surfaces as data AND as exitCode 1', () => {
    const body = buildDesignCheckView(overrides(
      '/work/project',
      { '/work/project/DESIGN.md': '## Craft rulebooks\n- color\n- ghost\n' },
      { [CRAFT]: ['color.md'] },
    ));
    expect(body.ok).toBe(true);
    expect(body.unavailableRulebooks).toEqual(['ghost']);
    // Both must be present: `ok` says a verdict exists, `exitCode` says the
    // repository is unhealthy. Renderers that only read `ok` would show green.
    expect(body.exitCode).toBe(1);
  });
});

describe('GET /v1/design-check — blocked states stay DISTINGUISHABLE', () => {
  test('daemon outside a checkout reports no-repository, not a missing file', () => {
    const body = buildDesignCheckView(overrides(null, {}, {}));
    expect(body.ok).toBe(false);
    expect(body.repoRoot).toBeNull();
    // ⛔ Not 'design-document'. "The daemon is not in a checkout" is a
    // deployment fact; reporting a missing file sends the operator hunting.
    expect(body.blockedOn).toBe('no-repository');
    expect(body.path).toBeNull();
    expect(body.exitCode).toBe(1);
  });

  test('unreadable craft directory names itself', () => {
    const body = buildDesignCheckView(overrides(
      '/work/project',
      { '/work/project/DESIGN.md': '## Craft rulebooks\n- color\n' },
      {},
    ));
    expect(body.ok).toBe(false);
    expect(body.blockedOn).toBe('craft-directory');
    expect(body.path).toBe(CRAFT);
  });

  test('missing DESIGN.md names itself', () => {
    const body = buildDesignCheckView(overrides('/work/project', {}, { [CRAFT]: ['color.md'] }));
    expect(body.ok).toBe(false);
    expect(body.blockedOn).toBe('design-document');
    expect(body.path).toBe('/work/project/DESIGN.md');
  });

  test('the three blocked reasons are pairwise distinct', () => {
    const noRepo = buildDesignCheckView(overrides(null, {}, {}));
    const noDir = buildDesignCheckView(overrides('/r', { '/r/DESIGN.md': 'x' }, {}));
    const noDoc = buildDesignCheckView(overrides('/r', {}, { [CRAFT]: [] }));
    const reasons = [noRepo.blockedOn, noDir.blockedOn, noDoc.blockedOn];
    expect(new Set(reasons).size).toBe(3);
    // …while every one of them is exitCode 1. That collapse is exactly why
    // the wire body cannot be "just the exit code".
    expect([noRepo.exitCode, noDir.exitCode, noDoc.exitCode]).toEqual([1, 1, 1]);
  });
});

describe('GET /v1/design-check — B5 방향', () => {
  test('같은 문서에서 방향을 읽어 «같이» 실어 보낸다', () => {
    const body = buildDesignCheckView(overrides(
      '/work/project',
      { '/work/project/DESIGN.md': '## Craft rulebooks\n\n- color\n\n## Design direction\n\n- monad-pastel-default\n' },
      { [CRAFT]: ['color.md'] },
    ));
    expect(body.ok).toBe(true);
    const dirs = body.directions as { declared: string | null; unavailable: string | null; available: unknown[] };
    expect(dirs.declared).toBe('monad-pastel-default');
    expect(dirs.unavailable).toBeNull();
    // ⛔ 두 번째 라우트를 만들지 않았다 — 같은 문서·같은 뿌리 규칙을 쓴다.
    expect(dirs.available.length).toBeGreaterThan(0);
  });

  test('⛔ 방향을 «안 골라도» exitCode 가 0 이다 — 방향은 계약이 아니다', () => {
    const body = buildDesignCheckView(overrides(
      '/work/project',
      { '/work/project/DESIGN.md': '## Craft rulebooks\n\n- color\n' },
      { [CRAFT]: ['color.md'] },
    ));
    const dirs = body.directions as { declared: string | null };
    expect(dirs.declared).toBeNull();
    // 새로 개설된 프로젝트가 «실패»로 보이면 안 된다.
    expect(body.exitCode).toBe(0);
  });

  test('⛔ 모르는 방향을 선언해도 규칙집 판정을 «안 흔든다»', () => {
    const body = buildDesignCheckView(overrides(
      '/work/project',
      { '/work/project/DESIGN.md': '## Craft rulebooks\n\n- color\n\n## Design direction\n\n- ghost\n' },
      { [CRAFT]: ['color.md'] },
    ));
    const dirs = body.directions as { unavailable: string | null };
    expect(dirs.unavailable).toBe('ghost');
    // exitCode 는 규칙집 축만 본다. 섞으면 두 축이 서로를 가린다.
    expect(body.exitCode).toBe(0);
    expect(body.unavailableRulebooks).toEqual([]);
  });
});
