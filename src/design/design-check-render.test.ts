// ── B4 (TUI half) — what /design shows, in what order, with what tone ──
//
// The PWA panel and this renderer project the SAME verdict. They may look
// different (badges vs glyphs) but the two rules that matter must agree:
//   ① missing sorts before present, ahead of alphabetical order
//   ② "shipped but not declared" is its own state, not silence
// If these ever diverge, one surface starts reassuring an operator the other
// is warning.

import { describe, expect, test } from 'bun:test';
import { renderDesignCheckLines } from './design-check-render';
import type { DesignCheckOutcome } from './design-check';

function verdict(over: Partial<Extract<DesignCheckOutcome, { ok: true }>> = {}): DesignCheckOutcome {
  return {
    ok: true,
    documentPath: '/repo/DESIGN.md',
    craftDirectory: '/elanous/craft',
    availableRulebooks: [],
    declaredRulebooks: [],
    unavailableRulebooks: [],
    ...over,
  };
}

const texts = (o: DesignCheckOutcome, opts?: { includeUndeclared?: boolean }) =>
  renderDesignCheckLines(o, opts).map((l) => l.text);

describe('renderDesignCheckLines — ordering', () => {
  test('missing sorts before present, ahead of alphabetical order', () => {
    // `zeta` is missing and sorts last alphabetically. If the name won, the
    // one line the operator ran /design for would scroll past unread.
    const lines = texts(verdict({
      declaredRulebooks: ['alpha', 'zeta'],
      unavailableRulebooks: ['zeta'],
    }));
    expect(lines[1]).toContain('zeta');
    expect(lines[1]).toContain('not found');
    expect(lines[2]).toContain('alpha');
  });

  test('the summary is the LAST line, not the first', () => {
    // A terminal scrolls. The final line is the one still on screen.
    const lines = texts(verdict({
      declaredRulebooks: ['a', 'b'],
      unavailableRulebooks: ['a'],
    }));
    expect(lines[lines.length - 1]).toContain('could not be found');
  });
});

describe('renderDesignCheckLines — the third state', () => {
  test('shipped-but-undeclared rulebooks are listed by default', () => {
    const lines = texts(verdict({
      declaredRulebooks: ['color'],
      availableRulebooks: ['color', 'typography'],
    }));
    expect(lines.some((l) => l.includes('typography') && l.includes('not declared'))).toBe(true);
  });

  test('a declared rulebook is never ALSO listed as undeclared', () => {
    const lines = texts(verdict({
      declaredRulebooks: ['color'],
      availableRulebooks: ['color'],
    }));
    expect(lines.filter((l) => l.includes('color'))).toHaveLength(1);
  });

  test('--declared narrows to what the document claims', () => {
    const lines = texts(verdict({
      declaredRulebooks: ['color'],
      availableRulebooks: ['color', 'typography'],
    }), { includeUndeclared: false });
    expect(lines.some((l) => l.includes('typography'))).toBe(false);
  });
});

describe('renderDesignCheckLines — tones carry meaning, not colour', () => {
  test('a missing rulebook is toned bad and a present one ok', () => {
    const lines = renderDesignCheckLines(verdict({
      declaredRulebooks: ['good', 'gone'],
      unavailableRulebooks: ['gone'],
    }));
    expect(lines.find((l) => l.text.includes('gone'))?.tone).toBe('bad');
    expect(lines.find((l) => l.text.includes('good'))?.tone).toBe('ok');
  });

  test('a clean verdict never emits a bad tone', () => {
    const lines = renderDesignCheckLines(verdict({
      declaredRulebooks: ['color'],
      availableRulebooks: ['color'],
    }));
    expect(lines.some((l) => l.tone === 'bad')).toBe(false);
  });
});

describe('renderDesignCheckLines — empty and blocked', () => {
  test('a document declaring nothing says so instead of printing an empty list', () => {
    const lines = texts(verdict({ availableRulebooks: ['color'] }));
    expect(lines.some((l) => l.includes('declares no craft rulebooks'))).toBe(true);
  });

  test('blocked names the path and does NOT print a rulebook list', () => {
    const lines = texts({ ok: false, blockedOn: 'design-document', path: '/repo/DESIGN.md' });
    expect(lines[0]).toContain('blocked');
    expect(lines.some((l) => l.includes('/repo/DESIGN.md'))).toBe(true);
    // ⛔ Critical: a blocked verdict must not render "All 0 rulebooks
    //    resolve." — that reads as a clean bill of health for a repository
    //    nobody actually managed to inspect.
    expect(lines.some((l) => l.includes('resolve'))).toBe(false);
  });

  test('the two blocked reasons produce DIFFERENT sentences', () => {
    const dir = texts({ ok: false, blockedOn: 'craft-directory', path: '/p' });
    const doc = texts({ ok: false, blockedOn: 'design-document', path: '/p' });
    expect(dir[1]).not.toBe(doc[1]);
  });
});

describe('renderDesignCheckLines — B5 방향 절', () => {
  const dirs = {
    declared: 'alpha' as string | null,
    unavailable: null as string | null,
    available: [{ id: 'alpha', mood: 'light ground' }, { id: 'beta', mood: 'dark ground' }],
  };

  test('방향 절이 규칙집 «아래»에 온다', () => {
    const lines = texts(verdict({ declaredRulebooks: ['color'], availableRulebooks: ['color'] }), undefined);
    const withDirs = renderDesignCheckLines(
      verdict({ declaredRulebooks: ['color'], availableRulebooks: ['color'] }),
      { directions: dirs },
    ).map((l) => l.text);
    // 규칙집 요약이 여전히 있고, 방향은 그 «뒤»에 붙는다.
    expect(withDirs.slice(0, lines.length)).toEqual(lines);
    expect(withDirs.some((l) => l.includes('Design direction'))).toBe(true);
  });

  test('고른 방향에 ✓ · 나머지에 ·', () => {
    const lines = renderDesignCheckLines(verdict(), { directions: dirs }).map((l) => l.text);
    expect(lines.some((l) => l.includes('✓ alpha'))).toBe(true);
    expect(lines.some((l) => l.includes('· beta'))).toBe(true);
  });

  test('⛔ 선언이 «없는» 것은 나쁜 톤이 아니다 — 방향은 계약이 아니라 선택이다', () => {
    const lines = renderDesignCheckLines(verdict({ declaredRulebooks: ['c'], availableRulebooks: ['c'] }), {
      directions: { ...dirs, declared: null },
    });
    expect(lines.some((l) => l.text.includes('none declared'))).toBe(true);
    // 규칙집이 멀쩡하면 bad 톤이 «하나도» 없어야 한다.
    expect(lines.some((l) => l.tone === 'bad')).toBe(false);
  });

  test('선언했는데 «못 찾으면» 그것만 bad 다', () => {
    const lines = renderDesignCheckLines(verdict(), {
      directions: { declared: 'ghost', unavailable: 'ghost', available: dirs.available },
    });
    const bad = lines.filter((l) => l.tone === 'bad');
    expect(bad).toHaveLength(1);
    expect(bad[0]!.text).toContain('ghost');
  });

  test('directions 를 «안 주면» 방향 절이 아예 없다 (기존 호출자 무회귀)', () => {
    const lines = texts(verdict({ declaredRulebooks: ['c'], availableRulebooks: ['c'] }));
    expect(lines.some((l) => l.includes('Design direction'))).toBe(false);
  });
});
