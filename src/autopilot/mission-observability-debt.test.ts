import { describe, it, expect } from 'bun:test';
import {
  scanObservabilityDebt,
  formatObservabilityDebt,
  runObservabilityDebtScan,
  type DebtScanInput,
} from './mission-observability-debt.js';

describe('scanObservabilityDebt — 순수 관측부채 감지', () => {
  it('셀프힐 신호 2종+ 방출(log) 있는데 관측 계측 0 이면 부채', () => {
    const files: DebtScanInput[] = [{
      path: 'src/autopilot/foo.ts',
      content: 'function x() { if (deadlock) { log("VERDICT: FAIL"); return { ok:false }; } }',
    }];
    const f = scanObservabilityDebt(files);
    expect(f).toHaveLength(1);
    expect(f[0]!.signals).toContain('deadlock');
    expect(f[0]!.signals).toContain('verdict-fail');
  });

  it('방출(log/console/onProgress) 없는 순수 로직은 부채 아님(호출측이 관측)', () => {
    const files: DebtScanInput[] = [{
      path: 'src/autopilot/pure-triage.ts',
      content: 'export function triage(x): Decision { if (deadlock) return { path: "revise" }; return { path: "retry" }; } // VERDICT: FAIL no-op',
    }];
    expect(scanObservabilityDebt(files)).toHaveLength(0);
  });

  it('recordMissionObservation 이 있으면 관측됨(부채 아님)', () => {
    const files: DebtScanInput[] = [{
      path: 'src/autopilot/foo.ts',
      content: 'deadlock VERDICT: FAIL triage\nrecordMissionObservation({ stage: "deadlock" });',
    }];
    expect(scanObservabilityDebt(files)).toHaveLength(0);
  });

  it('observe( 계측도 관측됨으로 인정', () => {
    const files: DebtScanInput[] = [{
      path: 'src/autopilot/foo.ts',
      content: 'deadlock no-op triage\nobserve({ stage: "triage" });',
    }];
    expect(scanObservabilityDebt(files)).toHaveLength(0);
  });

  it('debug.log 계측도 관측됨으로 인정', () => {
    const files: DebtScanInput[] = [{
      path: 'src/autopilot/foo.ts',
      content: 'deadlock recover 교착\ndebug.log("x.y", "z");',
    }];
    expect(scanObservabilityDebt(files)).toHaveLength(0);
  });

  it('신호 1종만 있으면 부채 아님(단순 언급 오탐 방지)', () => {
    const files: DebtScanInput[] = [{ path: 'src/autopilot/foo.ts', content: '// triage 라는 단어만 언급' }];
    expect(scanObservabilityDebt(files)).toHaveLength(0);
  });

  it('.test. 파일은 제외', () => {
    const files: DebtScanInput[] = [{
      path: 'src/autopilot/foo.test.ts',
      content: 'deadlock VERDICT: FAIL triage no-op',
    }];
    expect(scanObservabilityDebt(files)).toHaveLength(0);
  });

  it('부채 큰 순(hits 내림차순) 정렬', () => {
    const files: DebtScanInput[] = [
      { path: 'a.ts', content: 'deadlock triage; log("x")' },
      { path: 'b.ts', content: 'deadlock deadlock deadlock triage triage no-op; log("y")' },
    ];
    const f = scanObservabilityDebt(files);
    expect(f[0]!.path).toBe('b.ts');
    expect(f[0]!.hits).toBeGreaterThan(f[1]!.hits);
  });
});

describe('formatObservabilityDebt', () => {
  it('빈 부채면 "없음" 메시지', () => {
    expect(formatObservabilityDebt([])).toContain('없음');
  });
  it('topN 초과면 생략 표기', () => {
    const findings = Array.from({ length: 7 }, (_, i) => ({ path: `f${i}.ts`, signals: ['deadlock', 'triage'], hits: 10 - i, reason: '' }));
    const out = formatObservabilityDebt(findings, 5);
    expect(out).toContain('외 2개');
  });
});

describe('runObservabilityDebtScan — 드라이버(throttle·propose-only)', () => {
  const files: DebtScanInput[] = [{ path: 'src/autopilot/foo.ts', content: 'deadlock VERDICT: FAIL triage; log("fail")' }];

  it('throttle 안이면 스킵(안 돈다)', () => {
    const r = runObservabilityDebtScan({
      listFiles: () => files,
      lastScanAt: () => 1000,
      nowMs: () => 1000 + 60_000, // 1분 경과 < 20h
      throttleMs: 20 * 3600 * 1000,
      inject: () => { throw new Error('불러선 안 됨'); },
    });
    expect(r.ran).toBe(false);
    expect(r.reason).toBe('throttled');
  });

  it('throttle 지나면 스캔 + 부채 있으면 propose-only 주입', () => {
    const injected: Array<{ summary: string; text: string }> = [];
    let savedAt = 0;
    const r = runObservabilityDebtScan({
      listFiles: () => files,
      lastScanAt: () => 0,
      setScanAt: (t) => { savedAt = t; },
      nowMs: () => 999,
      inject: (summary, text) => injected.push({ summary, text }),
    });
    expect(r.ran).toBe(true);
    expect(r.findings).toHaveLength(1);
    expect(injected).toHaveLength(1);
    expect(injected[0]!.summary).toContain('관측부채');
    expect(savedAt).toBe(999);
  });

  it('부채 0 이면 주입 안 함(마커는 갱신)', () => {
    const injected: unknown[] = [];
    let savedAt = 0;
    const r = runObservabilityDebtScan({
      listFiles: () => [{ path: 'src/autopilot/clean.ts', content: 'deadlock triage\nobserve({});' }],
      lastScanAt: () => 0,
      setScanAt: (t) => { savedAt = t; },
      nowMs: () => 555,
      inject: () => injected.push(1),
    });
    expect(r.ran).toBe(true);
    expect(r.findings).toHaveLength(0);
    expect(injected).toHaveLength(0);
    expect(savedAt).toBe(555);
  });

  it('listFiles 가 던져도 fail-soft(error)', () => {
    const r = runObservabilityDebtScan({
      lastScanAt: () => 0,
      nowMs: () => 1,
      listFiles: () => { throw new Error('fs boom'); },
    });
    expect(r.ran).toBe(false);
    expect(r.reason).toBe('error');
  });
});
