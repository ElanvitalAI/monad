// Autopilot arming 단위테스트 — fail-closed 기본 + SE4 build 게이트.
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAutopilotArming, buildArmed, reviewAutoMergeArmed, DISARMED } from './arming.js';

function withArmingFile(raw: unknown, fn: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'arming-'));
  const path = join(dir, 'autopilot.json');
  writeFileSync(path, JSON.stringify(raw));
  try { fn(path); } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('arming — fail-closed 기본', () => {
  test('파일 부재 → 전부 disarmed(build 포함)', () => {
    const a = loadAutopilotArming(join(tmpdir(), 'does-not-exist-xyz.json'));
    expect(a.build.armed).toBe(false);
    expect(DISARMED.build.armed).toBe(false);
  });
  test('손상 JSON → fail-closed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arming-bad-'));
    const path = join(dir, 'a.json');
    writeFileSync(path, '{ broken');
    expect(loadAutopilotArming(path).build.armed).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('SE5 discover/propose — READ-ONLY 기본 on', () => {
  test('파일 부재 → discover/propose on(발굴 기본 작동)', () => {
    const a = loadAutopilotArming(join(tmpdir(), 'none-abc.json'));
    expect(a.discover.armed).toBe(true);
    expect(a.propose.armed).toBe(true);
  });
  test('명시 false → off', () => {
    withArmingFile({ discover: { armed: false }, propose: { armed: false } }, (p) => {
      const a = loadAutopilotArming(p);
      expect(a.discover.armed).toBe(false);
      expect(a.propose.armed).toBe(false);
    });
  });
  test('일부만 off — propose off, discover on', () => {
    withArmingFile({ propose: { armed: false } }, (p) => {
      const a = loadAutopilotArming(p);
      expect(a.discover.armed).toBe(true);   // 명시 안 함 → 기본 on
      expect(a.propose.armed).toBe(false);
    });
  });
});

describe('SE4 build 게이트', () => {
  test('build.armed=true 명시 → armed', () => {
    withArmingFile({ build: { armed: true, backend: 'codex-app-server' } }, (p) => {
      expect(buildArmed(p)).toBe(true);
      expect(loadAutopilotArming(p).build.backend).toBe('codex-app-server');
    });
  });
  test('build.armed 비-true(문자열) → disarmed(엄격)', () => {
    withArmingFile({ build: { armed: 'true' } }, (p) => {
      expect(buildArmed(p)).toBe(false); // 'true' 문자열은 불인정
    });
  });
  test('build 키 부재 → backend 기본 claude·disarmed', () => {
    withArmingFile({ merge: { armed: true } }, (p) => {
      expect(buildArmed(p)).toBe(false);
      expect(loadAutopilotArming(p).build.backend).toBe('claude');
    });
  });
});

describe('R3 reviewAutoMerge 게이트 — 머지=HITL 불변 opt-in(fail-closed)', () => {
  test('파일 부재 → disarmed(기본 OFF·머지 HITL 유지)', () => {
    expect(reviewAutoMergeArmed(join(tmpdir(), 'none-ram.json'))).toBe(false);
    expect(DISARMED.reviewAutoMerge.armed).toBe(false);
  });
  test('키 부재(다른 arming만) → disarmed', () => {
    withArmingFile({ build: { armed: true } }, (p) => expect(reviewAutoMergeArmed(p)).toBe(false));
  });
  test('명시 true → armed', () => {
    withArmingFile({ reviewAutoMerge: { armed: true } }, (p) => expect(reviewAutoMergeArmed(p)).toBe(true));
  });
  test('비-true(문자열) → disarmed(엄격·매매 mandate 동형)', () => {
    withArmingFile({ reviewAutoMerge: { armed: 'true' } }, (p) => expect(reviewAutoMergeArmed(p)).toBe(false));
  });
});
