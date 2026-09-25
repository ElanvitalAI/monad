/** 모델 «이름» 하드코딩 관문.
 *
 *  🩸 2026-09-25 — 대표 이 «두 번» 같은 정정을 했다: 발사기가 낡은 `gpt-5.6-sol` 을 박고 있었다.
 *  📏 근본은 훈계가 아니라 ***분포***였다 — 전수하니 스크립트에 박힌 이름 중 «가장 흔한» 것이
 *     ***낡은 것(31곳)***이고 현행 기본은 12곳이었다 ⇒ ***옆 스크립트를 베끼면 낡은 이름을 물려받는다.***
 *  ⛔ 설정·사다리는 «옳았다»(llm.model = 현행 · 사다리 best = 현행). 스크립트가 그걸 «안 읽어서» 어긋났다.
 */
import { describe, expect, test } from 'bun:test';
import { isCommentOnlyLine, modelIdsInLine, readBaseline, renderViolation, runModelHardcodeGate, scanSource } from './ci-model-hardcode-gate.js';

describe('모델 id 를 문다', () => {
  test('프로바이더별 접두를 «열거»해서 문다', () => {
    expect(modelIdsInLine('MODEL=gpt-6-sol')).toEqual(['gpt-6-sol']);
    expect(modelIdsInLine('m = "gpt-5.6-sol"')).toEqual(['gpt-5.6-sol']);
    expect(modelIdsInLine('x=grok-4.7')).toEqual(['grok-4.7']);
    expect(modelIdsInLine("t='claude-sonnet-5'")).toEqual(['claude-sonnet-5']);
  });

  test('⛔ 주석 줄은 세지 «않는다» — 문서화된 이력이 위반이 되면 규율이 지워진다', () => {
    expect(isCommentOnlyLine('// 08-18 이후 grok-4.6 → 4.7 로 늙었다')).toBe(true);
    expect(modelIdsInLine('// gpt-5.6-sol 을 쓰지 마라')).toEqual([]);
    expect(modelIdsInLine('#   낡은 gpt-5.6-sol 이 31곳이었다')).toEqual([]);
    expect(modelIdsInLine(' *  gpt-6-sol 이 기본이다')).toEqual([]);
  });

  test('⛔ 모델 «이름이 아닌» 것을 물지 않는다 — 넓은 정규식은 경로·판 번호를 문다', () => {
    expect(modelIdsInLine('D=/tmp/claude-501/scratch')).toEqual([]);   // 세션 디렉토리
    expect(modelIdsInLine('const port = 9333;')).toEqual([]);
    expect(modelIdsInLine('version: 5.6')).toEqual([]);
  });

  test('한 줄에 여럿이면 «여럿»으로 센다', () => {
    expect(scanSource('a=gpt-6-sol; b=gpt-6-astra\n')[0]!.ids).toEqual(['gpt-6-sol', 'gpt-6-astra']);
  });
});

describe('ratchet — «신규»만 막는다', () => {
  test('baseline 문면을 읽는다 (주석·빈 줄 무시)', () => {
    const m = readBaseline('# 머리말\n\nscripts/a.ts 3\nscripts/deep/b.sh 1\n');
    expect(m.get('scripts/a.ts')).toBe(3);
    expect(m.get('scripts/deep/b.sh')).toBe(1);
    expect(m.size).toBe(2);
  });

  test('위반 문면이 ***처방***을 댄다 — 수만 내면 다음 사람이 무엇을 할지 모른다', () => {
    const r = renderViolation('scripts/x.sh', 0, 1, 'line 7: M=gpt-5.6-sol');
    expect(r).toContain('0 → 1');
    expect(r).toContain('tierModel');
    expect(r).toContain('llm.model');
  });

  test('현 저장소는 통과한다 — ⛔ baseline 이 맞아야 이 관문이 «가짜»가 아니다', () => {
    const lines: string[] = [];
    const rc = runModelHardcodeGate({ args: [], log: (l) => lines.push(l), error: (l) => lines.push(l) });
    expect(rc).toBe(0);
    // 📏 분모를 확인한다 — 「0개 스캔」이면 통과가 «헛통과»다.
    expect(lines.join('\n')).toMatch(/scanned \d+ files/);
    const scanned = Number(/scanned (\d+) files/.exec(lines.join('\n'))?.[1] ?? 0);
    expect(scanned).toBeGreaterThan(100);
  });
});

describe('하니스 게이트에서 쓰는 모양 — cwd ⊕ --changed-files (🅣 2026-09-25)', () => {
  test('cwd 의 트리를 스캔하고, --changed-files 면 «그 파일들의» 초과만 막는다', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { runModelHardcodeGate } = await import('./ci-model-hardcode-gate.js');
    const root = mkdtempSync(join(tmpdir(), 'model-gate-cwd-'));
    try {
      mkdirSync(join(root, 'scripts'), { recursive: true });
      writeFileSync(join(root, 'scripts', 'model-hardcode-baseline.txt'), '# empty\n');
      writeFileSync(join(root, 'scripts', 'mine.ts'), "const m = 'gpt-6-sol';\n");
      writeFileSync(join(root, 'scripts', 'theirs.ts'), "const m = 'grok-4.7';\n");
      const quiet = { log: () => {}, error: () => {} };
      // 양성: 전체 스캔이면 둘 다 새 위반 → 막는다
      expect(runModelHardcodeGate({ cwd: root, args: [], ...quiet })).toBe(1);
      // 남의 파일만 위반이고 내 변경은 깨끗한 파일 → 통과
      writeFileSync(join(root, 'scripts', 'clean.ts'), 'export const x = 1;\n');
      expect(runModelHardcodeGate({ cwd: root, args: ['--changed-files', 'scripts/clean.ts'], ...quiet })).toBe(0);
      // 내가 바꾼 파일에 새 이름 → 막는다
      expect(runModelHardcodeGate({ cwd: root, args: ['--changed-files', 'scripts/mine.ts'], ...quiet })).toBe(1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
