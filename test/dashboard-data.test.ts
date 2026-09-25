// R4 — 대시보드 데이터층 + /v1/dashboard 핸들러 (fail-soft·경로 파서).

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dashboardSummary, dashboardTimeline, dashboardHeatmap, dashboardDigs, classifyAssetRow, dashboardSchedules,
} from '../src/domains/dashboard-data.js';
import { parseDashboardPath, handleDashboard, handleDashboardRefreshLive } from '../src/nexus/api/dashboard.js';
import { openSignalsDb } from '../src/domains/breaking-signals.js';
import { ensureDigTables } from '../src/domains/dig-engine.js';
import { openPulseDb } from '../src/domains/us-pulse.js';

let dir: string;
let paths: any;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dash-'));
  const signalsDb = join(dir, 'signals.db');
  const sdb = openSignalsDb(signalsDb);
  ensureDigTables(sdb);
  sdb.prepare(`INSERT INTO signals(id, ts, author, text, urgency, market, kr, sector, impact, alerted)
    VALUES ('s1', datetime('now','-2 hours'), 'A', '반도체 신호', 7, 8, 5, 'semis', 8, 1)`).run();
  sdb.prepare(`INSERT INTO signals(id, ts, author, text, urgency, market, kr, sector, impact)
    VALUES ('s2', datetime('now','-1 hours'), 'B', '잡음', 3, 3, 1, 'other', 2)`).run();
  sdb.prepare(`INSERT INTO dig_reports(ts, queue_id, topic, sector, verdict, confidence)
    VALUES (datetime('now'), 'signal:s1', '반도체 디깅', 'semis', '국면판단: ...', 'high')`).run();
  sdb.close();

  const pulseDb = join(dir, 'pulse.db');
  const pdb = openPulseDb(pulseDb);
  const ins = pdb.prepare(`INSERT INTO bars(symbol, date, close, volume) VALUES (?,?,?,?)`);
  ins.run('XLE', '2026-07-05', 100, null); ins.run('XLE', '2026-07-06', 103, null);
  ins.run('SPY', '2026-07-05', 620, null); ins.run('SPY', '2026-07-06', 622, null);
  pdb.close();

  const capstoneRegime = join(dir, 'regime.json');
  writeFileSync(capstoneRegime, JSON.stringify({ lastTarget: 'CASH_100', updatedAt: '2026-07-06T06:48:56Z' }));
  const alphaDir = join(dir, 'alpha'); mkdirSync(alphaDir);
  writeFileSync(join(alphaDir, '2026-07-06-weekly-alpha.md'), '# 알파');

  paths = { signalsDb, pulseDb, scoresDb: join(dir, 'absent-scores.db'), capstoneRegime, capstoneSignals: join(dir, 'absent-capstone.json'), alphaDir };
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('dashboard-data (R4)', () => {
  test('summary — 캡스톤·신호통계·디깅·알파 (scores 부재 fail-soft)', () => {
    const s = dashboardSummary(paths);
    expect(s.capstone).toEqual({ target: 'CASH_100', updatedAt: '2026-07-06T06:48:56Z' });
    expect(s.signals!.day.total).toBe(2);
    expect(s.digs!.week).toBe(1);
    expect(s.alpha!.latest).toBe('2026-07-06-weekly-alpha.md');
  });

  test('timeline — floor 필터·최신순', () => {
    const t = dashboardTimeline(48, 6, paths);
    expect(t.length).toBe(1);
    expect(t[0].id).toBe('s1');
    expect(dashboardTimeline(48, 1, paths).length).toBe(2);
  });

  test('heatmap — usSectors 계산 · scores.db 부재 시 attractiveness=null', () => {
    const h = dashboardHeatmap(paths);
    expect(h.attractiveness).toBeNull();
    expect(h.usSectors!.date).toBe('2026-07-06');
    expect(h.usSectors!.sectors.find((s: any) => s.symbol === 'XLE')!.dayPct).toBeCloseTo(3, 0);
    expect(h.newsSectors!.some((s: any) => s.sector === 'semis')).toBe(true);
  });

  test('digs 피드 + 전 소스 부재 시 빈/널 (throw 없음)', () => {
    expect(dashboardDigs(20, paths).length).toBe(1);
    const empty = { signalsDb: join(dir, 'no.db'), pulseDb: join(dir, 'no2.db'), scoresDb: join(dir, 'no3.db'), capstoneRegime: join(dir, 'no.json'), capstoneSignals: join(dir, 'no-cap.json'), alphaDir: join(dir, 'noDir') };
    const s = dashboardSummary(empty);
    expect(s.capstone).toBeNull();
    expect(dashboardTimeline(48, 6, empty)).toEqual([]);
    expect(dashboardDigs(20, empty)).toEqual([]);
  });

  test('classifyAssetRow — 섹터/국가/자산 휴리스틱', () => {
    expect(classifyAssetRow('financials', 'XLF.US')).toBe('sector');
    expect(classifyAssetRow('jp', 'EWJ.US')).toBe('country');
    expect(classifyAssetRow('equities_kr', 'EWY.US')).toBe('country'); // EWY = 국가 ETF 패턴
    expect(classifyAssetRow('crypto', 'IBIT.US')).toBe('asset');
  });
});

describe('/v1/dashboard 핸들러', () => {
  test('경로 파서 — 등록 섹션만·그 외 null', () => {
    expect(parseDashboardPath('/v1/dashboard/summary')).toBe('summary');
    expect(parseDashboardPath('/v1/dashboard/heatmap')).toBe('heatmap');
    expect(parseDashboardPath('/v1/dashboard/ops')).toBe('ops'); // P4 운영 상황판
    expect(parseDashboardPath('/v1/dashboard/nope')).toBeNull();
    expect(parseDashboardPath('/v1/dashboards')).toBeNull();
  });

  test('ops 섹션 — GET 응답 shape(health·health.healthy) · POST 405', async () => {
    const get = new Request('http://x/v1/dashboard/ops');
    const r = await handleDashboard(get, 'ops').json() as any;
    expect(r.ok).toBe(true);
    expect(r.ops).toBeTruthy();
    expect(typeof r.ops.health.healthy).toBe('boolean');
    expect(handleDashboard(new Request('http://x/v1/dashboard/ops', { method: 'POST' }), 'ops').status).toBe(405);
  });

  test('GET 응답 shape · OPTIONS 204 · POST 405 · auth seam', async () => {
    const get = new Request('http://x/v1/dashboard/digs?limit=5');
    const r = await handleDashboard(get, 'digs').json() as any;
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.digs)).toBe(true);

    expect(handleDashboard(new Request('http://x/v1/dashboard/summary', { method: 'OPTIONS' }), 'summary').status).toBe(204);
    expect(handleDashboard(new Request('http://x/v1/dashboard/summary', { method: 'POST' }), 'summary').status).toBe(405);
    expect(handleDashboard(get, 'digs', { checkAuth: () => false }).status).toBe(401);
  });

  test('refresh-live — 인증 seam·응답 shape (장중 여부에 따라 started|market_closed)', async () => {
    const post = new Request('http://x/v1/dashboard/refresh-live', { method: 'POST' });
    expect(handleDashboardRefreshLive(post, { checkAuth: () => false }).status).toBe(401);
    let spawned = 0;
    const r = await handleDashboardRefreshLive(post, { spawnCollector: () => { spawned++; } }).json() as any;
    expect(r.ok).toBe(true);
    // 장중이면 started(seam 호출) 또는 fresh(3분 가드), 휴장이면 market_closed
    expect(r.started === true || ['fresh', 'market_closed'].includes(r.reason)).toBe(true);
    if (r.started) expect(spawned).toBe(1);
  });
});

describe('dashboardSchedules (B1 — 스케줄러 카드)', () => {
  test('구조 + 내부 스케줄 편입 + 파서', () => {
    const s: any = dashboardSchedules({ schedulesDb: join(dir, 'sched.db') });
    expect(s).not.toBeNull();
    expect(typeof s.total).toBe('number');
    expect(Array.isArray(s.jobs)).toBe(true);
    expect(typeof s.byCategory).toBe('object');
    expect(typeof s.bySource).toBe('object');
    expect(typeof s.adopted).toBe('number');
    // 내부 스케줄(daily-reflection)은 crontab과 무관하게 항상 편입 — 결정론.
    const dr = s.jobs.find((j: any) => j.source === 'daily-reflection');
    expect(dr?.cron).toBe('0 21 * * *');
    expect(dr?.runVia).toBe('daemon');
    // 라우팅 파서
    expect(parseDashboardPath('/v1/dashboard/schedules')).toBe('schedules');
  });
});

describe('dashboard-data — ontology (추천4)', () => {
  test('ontology 라우팅 등록', () => {
    expect(parseDashboardPath('/v1/dashboard/ontology')).toBe('ontology');
    expect(parseDashboardPath('/v1/dashboard/nope')).toBeNull();
  });
  test('dashboardOntology 임시 kg db → 요약 + 전파', async () => {
    const { Database } = await import('bun:sqlite');
    const { ensureKgTables, upsertNode, addEdge } = await import('../src/domains/kg-store.js');
    const { dashboardOntology } = await import('../src/domains/dashboard-data.js');
    const path = join(tmpdir(), `kg-dash-test-${Date.now()}.db`);
    const db = new Database(path); ensureKgTables(db);
    upsertNode(db, { id: 'chain:반도체', kind: 'chain', name: '반도체', firstSeen: '2026-07-08', lastSeen: '2026-07-08' });
    upsertNode(db, { id: 'company:NVDA', kind: 'company', market: 'US', name: '엔비디아', firstSeen: '2026-07-08', lastSeen: '2026-07-08' });
    upsertNode(db, { id: 'company:005930', kind: 'company', market: 'KR', name: '삼성전자', firstSeen: '2026-07-08', lastSeen: '2026-07-08' });
    addEdge(db, { src: 'company:NVDA', dst: 'company:005930', relation: 'correlates', weight: 0.85, leadLag: 3, validAt: '2026-07-08', sourceRef: 'batch:leadlag' });
    db.close();
    const o = dashboardOntology({ knowledgeDb: path }) as Record<string, any>;
    rmSync(path, { force: true });
    expect(o.stats.nodes).toBe(3);
    expect(o.chains).toContain('반도체');
    expect(o.propagation[0].from).toBe('엔비디아');
    expect(o.propagation[0].to).toBe('삼성전자');
    expect(o.propagation[0].dir).toBe('동조');
  });
  test('kg 테이블 없으면 null(fail-soft)', async () => {
    const { dashboardOntology } = await import('../src/domains/dashboard-data.js');
    expect(dashboardOntology({ knowledgeDb: '/nonexistent/x.db' })).toBeNull();
  });
});

describe('dashboard-data — loops (자율루프 관측)', () => {
  test('loops 라우팅 등록', () => {
    expect(parseDashboardPath('/v1/dashboard/loops')).toBe('loops');
    expect(parseDashboardPath('/v1/dashboard/loop')).toBeNull();
  });

  test('dashboardLoops — dig/replay run 상태 집계(오늘·byStatus·last)', async () => {
    const { Database } = await import('bun:sqlite');
    const { ensureDigGoalRunTable } = await import('../src/dispatch/dig-goal-armer.js');
    const { ensureReplayRunTable } = await import('../src/dispatch/replay-goal-armer.js');
    const { dashboardLoops } = await import('../src/domains/dashboard-data.js');
    const sigPath = join(tmpdir(), `loops-sig-${Date.now()}.db`);
    const db = new Database(sigPath);
    ensureDigGoalRunTable(db);
    ensureReplayRunTable(db);
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const todayRunningAt = `${today}T01:00:00Z`;
    const todayDoneAt = `${today}T02:00:00Z`;
    // 오늘(시험 실행일) 2건 — 최신은 done + topic(detail 결정론).
    db.run(`INSERT INTO dig_goal_runs(goal_slug, queue_id, topic, sector, armed_at, status) VALUES ('dig-a', 'q1', '', '', ?, 'running')`, [todayRunningAt]);
    db.run(`INSERT INTO dig_goal_runs(goal_slug, queue_id, topic, sector, armed_at, status) VALUES ('dig-b', 'q2', '반도체 AI', '반도체', ?, 'done')`, [todayDoneAt]);
    db.run(`INSERT INTO dig_goal_runs(goal_slug, queue_id, topic, sector, armed_at, status) VALUES ('dig-old', 'q-old', '어제 디깅', '반도체', ?, 'done')`, [`${yesterday}T23:00:00Z`]);
    db.run(`INSERT INTO replay_runs(goal_slug, armed_at, status) VALUES ('replay-x', ?, 'done')`, [`${today}T06:15:00Z`]);
    db.close();
    const r = dashboardLoops({ signalsDb: sigPath, backtestDb: '/nonexistent-bt.db' });
    rmSync(sigPath, { force: true });
    expect(r).not.toBeNull();
    const dig = r!.loops.find(l => l.name === 'dig')!;
    expect(dig.today).toBe(2);
    expect(dig.recent).toContainEqual({ at: `${yesterday}T23:00:00Z`, status: 'done', detail: '어제 디깅' });
    expect(dig.byStatus.done).toBe(2);
    expect(dig.byStatus.running).toBe(1);
    expect(dig.last).toEqual({ at: todayDoneAt, status: 'done', detail: '반도체 AI' });
    expect(typeof dig.armed).toBe('boolean'); // config arming 반영
    const replay = r!.loops.find(l => l.name === 'replay')!;
    expect(replay.byStatus.done).toBe(1);
    expect(replay.last?.status).toBe('done');
    // backtest.db 부재 → backtest 루프 없음.
    expect(r!.loops.find(l => l.name === 'backtest')).toBeUndefined();
  });

  test('테이블/파일 없으면 빈 loops(fail-soft)', async () => {
    const { dashboardLoops } = await import('../src/domains/dashboard-data.js');
    const r = dashboardLoops({ signalsDb: '/nonexistent-sig.db', backtestDb: '/nonexistent-bt.db' });
    expect(r).not.toBeNull();
    expect(r!.loops).toEqual([]);
  });
});
