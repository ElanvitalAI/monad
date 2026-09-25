// Signal pool + 1차 게이트 단위테스트 — 순수(무네트워크·:memory:). A1.
import { test, expect, describe, spyOn } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignalPool, type Signal } from './signal-pool.js';
import { classifySeverityRules, runGate1 } from './signal-gate1.js';

const sig = (over: Partial<Signal> = {}): Signal => ({
  eventId: 'e1', source: 'community', observedAt: '2026-07-11T00:00:00Z',
  collectedAt: '2026-07-11T00:00:01Z', origin: 'fmkorea', trust: 1.0, raw: '삼성 좋아보임', ...over,
});

describe('SignalPool — 연결 설정', () => {
  test('연결 busy_timeout은 리터럴 2000ms다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'signal-pool-'));
    const path = join(dir, 'signal_pool.db');
    const p = new SignalPool({ path });
    try {
      expect((p as any).db.query('PRAGMA busy_timeout').get()).toEqual({ timeout: 2000 });
    } finally {
      p.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('잠금 오류에는 데이터베이스 파일 경로를 보강한다', () => {
    const path = join(tmpdir(), 'signal-pool-locked.db');
    const locked = new Error('database is locked');
    const run = spyOn(Database.prototype, 'run').mockImplementation(() => { throw locked; });
    try {
      expect(() => new SignalPool({ path })).toThrow(`SignalPool database is locked: ${path}`);
    } finally {
      run.mockRestore();
    }
  });

  test('마이그레이션 중 잠금 오류에도 데이터베이스 파일 경로를 보강한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'signal-pool-'));
    const path = join(dir, 'signal_pool.db');
    const legacy = new Database(path);
    legacy.run(`CREATE TABLE signals (
      event_id TEXT PRIMARY KEY, source TEXT NOT NULL, asset TEXT,
      observed_at TEXT NOT NULL, collected_at TEXT NOT NULL, origin TEXT NOT NULL,
      evidence_url TEXT, trust REAL NOT NULL DEFAULT 1.0, severity TEXT,
      severity_reason TEXT, ttl_ms INTEGER, dedup_group TEXT, proposed_action TEXT,
      raw TEXT NOT NULL
    )`);
    legacy.close();
    const originalRun = Database.prototype.run;
    const run = spyOn(Database.prototype, 'run').mockImplementation(function (this: Database, sql: string) {
      if (sql.startsWith('ALTER TABLE signals ADD COLUMN')) throw new Error('database is locked');
      return originalRun.call(this, sql);
    });
    try {
      expect(() => new SignalPool({ path })).toThrow(`SignalPool database is locked: ${path}`);
    } finally {
      run.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SignalPool — 적재/dedup/조회', () => {
  test('ingest 멱등(event_id 중복 무시)', () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      expect(p.ingest(sig()).inserted).toBe(true);
      expect(p.ingest(sig()).inserted).toBe(false);   // 같은 eventId → 무시
      expect(p.count()).toBe(1);
    } finally { p.close(); }
  });
  test('listUnclassified → markSeverity → listBySeverity', () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      p.ingest(sig({ eventId: 'a' }));
      p.ingest(sig({ eventId: 'b' }));
      expect(p.listUnclassified().length).toBe(2);
      p.markSeverity('a', 'S3', 'test');
      expect(p.listUnclassified().length).toBe(1);     // b만 남음
      expect(p.listBySeverity('S3').length).toBe(1);
    } finally { p.close(); }
  });
  test('dedupGroupCount', () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      p.ingest(sig({ eventId: 'a', dedupGroup: 'g1' }));
      p.ingest(sig({ eventId: 'b', dedupGroup: 'g1' }));
      p.ingest(sig({ eventId: 'c', dedupGroup: 'g2' }));
      expect(p.dedupGroupCount('g1')).toBe(2);
      expect(p.dedupGroupCount('g2')).toBe(1);
    } finally { p.close(); }
  });
});

describe('classifySeverityRules — 심각도(모나드 교정 반영)', () => {
  test('단일 커뮤니티/SNS → 상한 S1(직접 매매신호 아님)', () => {
    expect(classifySeverityRules(sig({ source: 'community' }), { dedupCount: 1 }).severity).toBe('S1');
    expect(classifySeverityRules(sig({ source: 'sns' }), { dedupCount: 1 }).severity).toBe('S1');
  });
  test('다중 커뮤니티 서사 → S2', () => {
    expect(classifySeverityRules(sig({ source: 'community' }), { dedupCount: 3 }).severity).toBe('S2');
  });
  test('★ 커뮤니티 급증(dedup≥30) → S3 승격(집중 버즈·2차 회부·P4)', () => {
    expect(classifySeverityRules(sig({ source: 'community' }), { dedupCount: 30 }).severity).toBe('S3');
    expect(classifySeverityRules(sig({ source: 'community' }), { dedupCount: 758 }).severity).toBe('S3');
    // 임계 미만은 여전히 S2(급증 아님)
    expect(classifySeverityRules(sig({ source: 'community' }), { dedupCount: 29 }).severity).toBe('S2');
    // 임계 override
    expect(classifySeverityRules(sig({ source: 'community' }), { dedupCount: 10, communitySurgeDedup: 10 }).severity).toBe('S3');
  });
  test('★ 커뮤니티 잡담은 키워드보다 상한 우선(규제/급락 단어여도 S1)', () => {
    // 모나드 교정 — 단일 커뮤니티 출처는 규제/제재/급락 단어만으로 S3/S4 취급 금지.
    expect(classifySeverityRules(sig({ source: 'community', asset: '005930', raw: '규제 심하다 급락각' }), { dedupCount: 1 }).severity).toBe('S1');
  });
  test('공시/실적(신뢰 소스) → S3', () => {
    expect(classifySeverityRules(sig({ source: 'disclosure', raw: '유상증자 공시' })).severity).toBe('S3');
    expect(classifySeverityRules(sig({ source: 'news', raw: 'earnings shock guidance cut' })).severity).toBe('S3');
  });
  test('보유 자산 급변(신뢰 소스·거래정지/급락) → S4', () => {
    expect(classifySeverityRules(sig({ source: 'news', asset: '005930.KO', raw: '삼성전자 거래정지' })).severity).toBe('S4');
    expect(classifySeverityRules(sig({ source: 'news', asset: 'KORU.US', raw: '급락 서킷브레이커' })).severity).toBe('S4');
  });
  test('시장/국면 신호 → S2', () => {
    expect(classifySeverityRules(sig({ source: 'market', raw: 'DXY 급등' })).severity).toBe('S2');
    expect(classifySeverityRules(sig({ source: 'regime', raw: '국면 전환' })).severity).toBe('S2');
  });
  test('TTL 만료 → S0 강등', () => {
    const s = sig({ ttlMs: 1, collectedAt: '2026-07-11T00:00:00Z' });
    expect(classifySeverityRules(s, { now: Date.parse('2026-07-11T01:00:00Z') }).severity).toBe('S0');
  });
});

describe('runGate1 — 전량 분류', () => {
  test('미분류 전량 → severity 기록 + 롤업', async () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      p.ingest(sig({ eventId: 'a', source: 'community' }));                        // S1
      p.ingest(sig({ eventId: 'b', source: 'disclosure', raw: '공시' }));          // S3
      p.ingest(sig({ eventId: 'c', source: 'news', asset: '005930.KO', raw: '거래정지' })); // S4
      const r = await runGate1(p);
      expect(r.classified).toBe(3);
      expect(r.bySeverity.S1).toBe(1);
      expect(r.bySeverity.S3).toBe(1);
      expect(r.bySeverity.S4).toBe(1);
      expect(p.listUnclassified().length).toBe(0);   // 전량 분류됨
    } finally { p.close(); }
  });
  test('LLM seam 주입 시 refine(실패=규칙 유지)', async () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      p.ingest(sig({ eventId: 'a' }));
      const r = await runGate1(p, { classify: async () => ({ severity: 'S2', reason: 'llm' }) });
      expect(r.bySeverity.S2).toBe(1);   // LLM 이 규칙(S1)을 덮음
    } finally { p.close(); }
  });
  test('★ 커뮤니티 급증 서사 → 서사당 1대표만 S3(나머지 S2·gate2 비용가드·P4)', async () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      // 같은 dedupGroup 에 35건 몰림(급증) → 1건만 S3, 34건 S2.
      for (let i = 0; i < 35; i += 1) {
        p.ingest(sig({ eventId: `surge-${i}`, source: 'community', dedupGroup: '000660.KO' }));
      }
      const r = await runGate1(p);
      expect(r.classified).toBe(35);
      expect(r.bySeverity.S3).toBe(1);    // 대표 1건만 critical
      expect(r.bySeverity.S2).toBe(34);   // 나머지는 S2(중복 대표)
    } finally { p.close(); }
  });
});

describe('H2 — 소스별 hit-rate 집계 + 학습 trust 재가중', () => {
  /** source·outcome 지정 신호 seed(검증됨). */
  const seedOutcome = (p: SignalPool, id: string, source: Signal['source'], correct: boolean) => {
    p.ingest(sig({ eventId: id, source }));
    p.markOutcome(id, { return: correct ? 0.02 : -0.02, correct, at: '2026-07-14T00:00:00Z' });
  };

  test('sourceHitRates — 소스별 검증 집계(GROUP BY source)', () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      seedOutcome(p, 'a', 'news', true); seedOutcome(p, 'b', 'news', true); seedOutcome(p, 'c', 'news', false);
      seedOutcome(p, 'd', 'community', false); seedOutcome(p, 'e', 'community', false);
      const hr = p.sourceHitRates();
      expect(hr.news!.verified).toBe(3);
      expect(hr.news!.hitRate).toBeCloseTo(2 / 3);
      expect(hr.community!.hitRate).toBe(0);
    } finally { p.close(); }
  });

  test('applyLearnedTrust — pending 신호만 factor 로 재가중(bounded·비파괴)', () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      p.ingest(sig({ eventId: 'p1', source: 'news', trust: 0.8 }));      // pending(severity NULL)
      p.ingest(sig({ eventId: 'p2', source: 'community', trust: 0.6 }));
      p.ingest(sig({ eventId: 'g1', source: 'news', trust: 0.8 }));
      p.markSeverity('g1', 'S2', 'gated');                               // 이미 게이트됨 → 재가중 제외

      const res = p.applyLearnedTrust({ news: 1.1, community: 0.7, other: 1 });
      expect(res.adjusted).toBe(2);                                      // p1·p2만(g1 제외·factor 1 제외)
      const p1 = p.listUnclassified().find(s => s.eventId === 'p1')!;
      const p2 = p.listUnclassified().find(s => s.eventId === 'p2')!;
      expect(p1.trust).toBeCloseTo(0.88);                               // 0.8×1.1
      expect(p2.trust).toBeCloseTo(0.42);                               // 0.6×0.7
      // 게이트된 g1 은 무변경.
      expect(p.listBySeverity('S2')[0]!.trust).toBe(0.8);
    } finally { p.close(); }
  });

  test('trust 는 [0,1] clamp', () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      p.ingest(sig({ eventId: 'p1', source: 'news', trust: 0.95 }));
      p.applyLearnedTrust({ news: 1.15 });                              // 0.95×1.15=1.09 → clamp 1
      expect(p.listUnclassified()[0]!.trust).toBe(1);
    } finally { p.close(); }
  });
});
