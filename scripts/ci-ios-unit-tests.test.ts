import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyIosUnmeasurable, iosFilesIn, parseChangedFiles, parseSwiftTestTally, runIosUnitTestGate,
} from './ci-ios-unit-tests.js';

function rootWithPackage(): string {
  const root = mkdtempSync(join(tmpdir(), 'ios-gate-'));
  mkdirSync(join(root, 'apps', 'ios', 'MonadiOSKitTests'), { recursive: true });
  writeFileSync(join(root, 'apps', 'ios', 'MonadiOSKitTests', 'Package.swift'), '// swift-tools-version: 5.9\n');
  return root;
}
function capture() {
  const out: string[] = [], err: string[] = [];
  return { out, err, log: (l: string) => out.push(l), error: (l: string) => err.push(l) };
}

describe('parseSwiftTestTally — «실제로 돈» 수', () => {
  test('마지막 총계 줄을 쓴다 — swift test 는 스위트마다 같은 줄을 낸다', () => {
    const out = 'Executed 6 tests, with 0 failures\nExecuted 6 tests, with 1 failure\n';
    expect(parseSwiftTestTally(out)).toEqual({ ran: 6, failed: 1 });
  });
  test('단수/복수 둘 다 읽는다 — "1 failure" 와 "0 failures"', () => {
    expect(parseSwiftTestTally('Executed 1 test, with 1 failure')).toEqual({ ran: 1, failed: 1 });
  });
  test('⛔ 총계 줄이 «없으면» 0 — 「못 셌음」이 분명히 드러난다', () => {
    expect(parseSwiftTestTally('error: build failed')).toEqual({ ran: 0, failed: 0 });
  });
});

describe('iosFilesIn', () => {
  test('apps/ios 아래 Swift·프로젝트 파일만 깨운다', () => {
    expect(iosFilesIn(['apps/ios/A.swift', 'apps/ios/x.pbxproj', 'src/a.ts', 'apps/android/B.kt']))
      .toEqual(['apps/ios/A.swift', 'apps/ios/x.pbxproj']);
  });
});

describe('classifyIosUnmeasurable — ⛔ 「못 쟀다」는 「통과」가 아니다', () => {
  test('툴체인 부재를 이름 붙이고 «조치»를 준다', () => {
    const r = classifyIosUnmeasurable('xcrun: error: unable to find utility "xctest"');
    expect(r).toContain('xcode-select');
  });
  test('평범한 시험 실패는 «측정 불가가 아니다»', () => {
    expect(classifyIosUnmeasurable('Executed 6 tests, with 1 failure')).toBeNull();
  });
});

describe('runIosUnitTestGate', () => {
  test('⛔ 돈 시험이 0개면 통과가 아니다 — 이 게이트의 존재 이유', () => {
    const c = capture();
    const code = runIosUnitTestGate({
      args: [], cwd: rootWithPackage(), log: c.log, error: c.error,
      runSwiftTest: () => ({ status: 1, output: "error: cannot find 'AskQuestionResult' in scope\n" }),
    });
    expect(code).toBe(1);
    expect(c.err.join('\n')).toContain('돈 시험이 «0개»');
    expect(c.err.join('\n')).toContain("cannot find 'AskQuestionResult'");
  });

  test('⭐ 통과하면 «몇 개 돌았는지» ⊕ «못 재는 것»을 같이 말한다', () => {
    const c = capture();
    const code = runIosUnitTestGate({
      args: [], cwd: rootWithPackage(), log: c.log, error: c.error,
      runSwiftTest: () => ({ status: 0, output: 'Executed 6 tests, with 0 failures' }),
    });
    expect(code).toBe(0);
    expect(c.out.join('\n')).toContain('6개 돌았고');
    // ⛔ 초록을 「전부 검증됐다」로 읽지 않게 «스스로» 경계를 말해야 한다.
    expect(c.out.join('\n')).toContain('못 재는 것');
  });

  test('iOS 를 안 만졌으면 «해당 없음»을 말하고 swift 를 부르지 않는다', () => {
    const c = capture(); let called = 0;
    const code = runIosUnitTestGate({
      args: ['--changed-files', 'src/a.ts'], cwd: rootWithPackage(), log: c.log, error: c.error,
      runSwiftTest: () => { called += 1; return { status: 0, output: '' }; },
    });
    expect(code).toBe(0);
    expect(called).toBe(0);
    expect(c.out.join('\n')).toContain('해당 없음');
    expect(c.out.join('\n')).not.toContain('돌았고');
  });

  test('⛔ Package.swift 가 «없으면» 통과가 아니다', () => {
    const c = capture();
    const code = runIosUnitTestGate({
      args: [], cwd: mkdtempSync(join(tmpdir(), 'no-pkg-')), log: c.log, error: c.error,
      runSwiftTest: () => ({ status: 0, output: '' }),
    });
    expect(code).toBe(1);
    expect(c.err.join('\n')).toContain('없어서 통과');
  });

  test('parseChangedFiles 는 형제 게이트와 «같은 관례»(공백 ⊕ 콤마)', () => {
    expect(parseChangedFiles(['--changed-files', 'a.swift', 'b.swift'])).toEqual(['a.swift', 'b.swift']);
    expect(parseChangedFiles(['--changed-files', 'a.swift,b.swift'])).toEqual(['a.swift', 'b.swift']);
    expect(parseChangedFiles([])).toBeNull();
  });
});
