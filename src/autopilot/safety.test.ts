// Autopilot safety gates(P3) 단위테스트 — 순수 판정(무네트워크·무DB).
import { describe, test, expect } from 'bun:test';
import {
  isImmutableCorePath, checkImmutableCore, evidencePasses,
  evaluateMergeGate, evaluateRebootGate, evaluateHealthRollback,
} from './safety.js';
import { DISARMED, type AutopilotArming } from './arming.js';
import type { Evidence } from './absorb-flow.js';

const withMerge = (armed: boolean): AutopilotArming => ({ ...DISARMED, merge: { armed } });
const pass: Evidence = { build: 'pass', test: 'pass', log: '' };
const failTest: Evidence = { build: 'pass', test: 'fail', log: '' };
const skipped: Evidence = { build: 'skipped', test: 'skipped', log: '' };

describe('③ 불변 코어', () => {
  test('매매/재부팅/arming/safety 경로 감지', () => {
    expect(isImmutableCorePath('src/domains/trade-mandate.ts')).toBe(true);
    expect(isImmutableCorePath('src/domains/trade-autonomous.ts')).toBe(true);
    expect(isImmutableCorePath('src/autopilot/arming.ts')).toBe(true);
    expect(isImmutableCorePath('src/autopilot/safety.ts')).toBe(true);
    expect(isImmutableCorePath('src/nexus/reboot-handler.ts')).toBe(true);
    expect(isImmutableCorePath('/Users/x/.elanous/finance-trade-mandate.json')).toBe(true);
  });
  test('일반 경로는 통과', () => {
    expect(isImmutableCorePath('src/autopilot/triage.ts')).toBe(false);
    expect(isImmutableCorePath('src/domains/dig-engine.ts')).toBe(false);
  });
  test('checkImmutableCore violations', () => {
    const r = checkImmutableCore(['src/domains/triage.ts', 'src/domains/trade-mandate.ts']);
    expect(r.ok).toBe(false);
    expect(r.violations).toEqual(['src/domains/trade-mandate.ts']);
    expect(checkImmutableCore(['src/foo.ts']).ok).toBe(true);
  });
});

describe('① 빌드/테스트 게이트', () => {
  test('strict=false: fail 만 차단', () => {
    expect(evidencePasses(pass)).toBe(true);
    expect(evidencePasses(skipped)).toBe(true);
    expect(evidencePasses(failTest)).toBe(false);
    expect(evidencePasses(undefined)).toBe(false);
  });
  test('strict=true: pass 만 통과', () => {
    expect(evidencePasses(pass, { strict: true })).toBe(true);
    expect(evidencePasses(skipped, { strict: true })).toBe(false);
  });
});

describe('P3.2 merge 게이트', () => {
  test('disarmed → 차단', () => {
    expect(evaluateMergeGate({ arming: withMerge(false), evidence: pass, changedFiles: ['a.ts'] }).allowed).toBe(false);
  });
  test('armed + 증거통과 + 코어무위반 → 허용', () => {
    const d = evaluateMergeGate({ arming: withMerge(true), evidence: pass, changedFiles: ['src/autopilot/triage.ts'] });
    expect(d.allowed).toBe(true);
  });
  test('armed 이나 불변코어 위반 → 차단', () => {
    const d = evaluateMergeGate({ arming: withMerge(true), evidence: pass, changedFiles: ['src/domains/trade-mandate.ts'] });
    expect(d.allowed).toBe(false);
    expect(d.violations).toContain('src/domains/trade-mandate.ts');
  });
  test('armed 이나 테스트 실패 → 차단', () => {
    expect(evaluateMergeGate({ arming: withMerge(true), evidence: failTest, changedFiles: ['a.ts'] }).allowed).toBe(false);
  });
  test('armed 이나 skipped 증거 → 차단(strict)', () => {
    expect(evaluateMergeGate({ arming: withMerge(true), evidence: skipped, changedFiles: ['a.ts'] }).allowed).toBe(false);
  });
});

describe('P3.3 재부팅 게이트 — 항상 HITL', () => {
  test('arming 무관하게 autoAllowed=false', () => {
    const armedAll: AutopilotArming = { discover: { armed: true }, propose: { armed: true }, absorb: { armed: true, backend: 'claude' }, merge: { armed: true }, reboot: { armed: true }, materialize: { armed: true }, build: { armed: true, backend: 'claude' }, autoAccept: { armed: true }, selfHeal: { armed: true }, reviewAutoMerge: { armed: true } };
    const d = evaluateRebootGate({ arming: armedAll, evidence: pass });
    expect(d.autoAllowed).toBe(false);
    expect(d.preconditionsMet).toBe(true);
  });
  test('빌드/테스트 미통과 → 전제 불충족', () => {
    expect(evaluateRebootGate({ arming: DISARMED, evidence: failTest }).preconditionsMet).toBe(false);
  });
});

describe('② health 롤백(blue-green)', () => {
  test('health OK → 롤백 없음', () => {
    expect(evaluateHealthRollback({ healthOk: true, previousRef: 'sha1' }).rollback).toBe(false);
  });
  test('health 실패 + previousRef → 롤백', () => {
    const d = evaluateHealthRollback({ healthOk: false, previousRef: 'sha1' });
    expect(d.rollback).toBe(true);
    expect(d.target).toBe('sha1');
  });
  test('health 실패 + previousRef 없음 → 수동 개입', () => {
    expect(evaluateHealthRollback({ healthOk: false }).rollback).toBe(false);
  });
});
