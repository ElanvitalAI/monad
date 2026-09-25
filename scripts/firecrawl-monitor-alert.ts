#!/usr/bin/env bun
// ── Firecrawl Monitors → 텔레그램 알림 폴러 (2026-07-06) ────────────────
// Firecrawl /monitor는 웹훅(public URL 필요) 또는 이메일 알림만 지원 →
// 우리는 tailscale 내부망이라 **폴링**: 이 크론이 모니터별 최신 완료 체크를
// 조회해 새 체크에 changed/new 페이지가 있으면 /v1/outbound(텔레그램)로 발송.
// 모니터 생성/관리는 omni-crawl 스킬: `npx tsx scripts/monitor.ts create|list|…`.
//
// cron: */30 * * * *  (모니터 자체 스케줄과 독립 — 폴러는 "완료된 체크"만 읽음.
//        변경 없으면 무발송·저비용: GET checks는 무과금, 체크 과금은 Firecrawl측 스케줄)
//
// state: ~/.monad/conatus/firecrawl_monitor_state.json — 모니터별 마지막 처리 checkId.

import { sendOutbound } from '../src/domains/outbound-alert.js';
import {
  extractDiffHeadlines, refineHeadlines, judgeMonitorHeadlines, renderDiffHeadlines,
} from '../src/domains/monitor-diff.js';
import { llmOnce } from '../src/domains/signal-dedup.js';
import { openSignalsDb, recentSentSignals } from '../src/domains/breaking-signals.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// 크론 최소 PATH 자립 (koru-reentry-alert 패턴).
// 07-07 관찰 수리: homebrew/bun 주입만으론 부족(node=nvm 전용) — nvm bin 동적 주입.
import { ensureCronNodePath } from '../src/domains/cron-path.js';
ensureCronNodePath();

const BASE = 'https://api.firecrawl.dev/v2';
const STATE = join(homedir(), '.monad/conatus/firecrawl_monitor_state.json');

// 키: env 우선 → omni-crawl 스킬 .env self-load (데몬/크론 env 비의존 — kr-flow 패턴).
function firecrawlKey(): string {
  const fromEnv = process.env.FIRECRAWL_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const envPath = join(homedir(), '.claude', 'skills', 'omni-crawl', '.env');
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.trim().match(/^FIRECRAWL_API_KEY=(.+)$/);
      if (m) return m[1].trim();
    }
  } catch { /* fall through */ }
  return '';
}

async function api(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${KEY}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return res.json();
}

type StateMap = Record<string, string>; // monitorId → last handled checkId
function loadState(): StateMap {
  try { return existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf-8')) : {}; } catch { return {}; }
}
function saveState(s: StateMap): void {
  if (!existsSync(dirname(STATE))) mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(s, null, 2));
}

const KEY = firecrawlKey();
if (!KEY) { console.log('FIRECRAWL_API_KEY 없음(env·omni-crawl .env) — skip'); process.exit(0); }

const state = loadState();
const monitors: any[] = (await api('/monitor'))?.data ?? [];
if (!monitors.length) { console.log('모니터 없음 — skip'); process.exit(0); }

// 공통 필터 파이프 입력 (2026-07-07 대표 피드백: "필터링 로직을 기본으로") —
// 발송 floor(x_watchlist digestFloor 재사용·기본 6) + 최근 6h 기발송(크로스 dedup).
function monitorFloor(): number {
  try {
    const wl = JSON.parse(readFileSync(join(homedir(), '.monad/conatus/x_watchlist.json'), 'utf-8'));
    if (typeof wl.digestFloor === 'number') return wl.digestFloor;
  } catch { /* default */ }
  return 6;
}
const floor = monitorFloor();
const sigDb = openSignalsDb();
const recentSent = recentSentSignals(sigDb, 6);

let alerted = 0;
for (const m of monitors) {
  if (m.enabled === false) continue;
  try {
    const checks: any[] = (await api(`/monitor/${m.id}/checks?limit=1`))?.data ?? [];
    const c = checks[0];
    if (!c || c.status !== 'completed') { console.log(`[${m.name}] 완료 체크 없음/진행중 — skip`); continue; }
    if (state[m.id] === c.id) { console.log(`[${m.name}] 신규 체크 없음(${c.id.slice(0, 8)}) — skip`); continue; }

    // 첫 폴링(state 미존재) = baseline: 첫 체크의 'new'는 기준선 생성이라
    // 알림 노이즈 → 상태만 기록하고 무발송.
    if (!state[m.id]) {
      console.log(`[${m.name}] baseline 체크(${c.id.slice(0, 8)}) — 상태 기록·무발송`);
      state[m.id] = c.id;
      continue;
    }

    // 신규 완료 체크 — changed/new 페이지 추출.
    const detail = (await api(`/monitor/${m.id}/checks/${c.id}`))?.data ?? {};
    const pages: any[] = detail.pages ?? [];
    const interesting = pages.filter(p => p.status === 'changed' || p.status === 'new');

    if (interesting.length === 0) {
      console.log(`[${m.name}] 변경 없음(check ${c.id.slice(0, 8)}) — 상태만 갱신`);
      state[m.id] = c.id; // 무변경 체크도 처리 완료로 마킹(재조회 방지)
      continue;
    }

    // ── 공통 필터 파이프 (07-07 대표 피드백 2탄): ①구조 필터(내비/시세위젯/
    // 무의미 제목 → slug 복원) ②LLM 배치 판정(중요도+한국어 해석+6h 기발송
    // 중복) ③floor 미만·중복 접기 ④전부 접히면 알림 자체 skip — "변경 감지만"
    // 알림은 더 이상 없음. LLM 전멸 시 fail-open(판정불가 태그·구조필터 통과분만).
    const heads = refineHeadlines(
      interesting.flatMap((p: any) => typeof p.diff?.text === 'string' ? extractDiffHeadlines(p.diff.text, 8) : []),
    ).slice(0, 12);
    if (heads.length === 0) {
      console.log(`[${m.name}] 구조 필터 후 기사 없음(내비/위젯뿐) — 상태만 갱신·무발송`);
      state[m.id] = c.id;
      continue;
    }
    const judged = await judgeMonitorHeadlines(heads, recentSent, llmOnce);
    const passing = judged.filter(j => !j.dupOfRecent && (j.importance === null || j.importance >= floor));
    const folded = judged.length - passing.length;
    if (passing.length === 0) {
      console.log(`[${m.name}] 전 건 필터(중복/중요도<${floor}) ${judged.length}건 — 상태만 갱신·무발송`);
      state[m.id] = c.id;
      continue;
    }
    const lines = [
      `🔔 [모니터] ${m.name} — 유의 기사 ${passing.length}건${folded > 0 ? ` (중복·저중요 ${folded}건 접힘)` : ''}`,
      renderDiffHeadlines(passing),
      `(check ${c.id.slice(0, 8)} · floor ${floor}+ · READ-ONLY 정보 알림)`,
    ];
    const msg = lines.join('\n');
    console.log(msg);
    if (sendOutbound(msg, 'alert')) {
      state[m.id] = c.id;
      alerted++;
      // 발송분을 signals DB에 기록 — 이후 6h 창에서 속보/다이제스트/타 모니터와
      // 크로스 dedup (recentSentSignals가 자동 포함).
      try {
        const ins = sigDb.prepare(`INSERT OR IGNORE INTO signals
          (id, ts, source, author, text, url, urgency, market, kr, sector, impact, reason, judged_by, alerted)
          VALUES (?, ?, 'monitor', ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'monitor-judge', 1)`);
        const now = new Date().toISOString();
        passing.forEach((h, i) => {
          ins.run(`monitor:${c.id}:${i}`, now, m.name, h.title.slice(0, 300), h.url,
            h.importance ?? null, h.importance ?? null, String(m.name).slice(0, 40), h.importance ?? null,
            h.reason ? String(h.reason).slice(0, 200) : null);
        });
      } catch (e: any) { console.log(`signals 기록 실패(무해): ${e?.message?.slice(0, 60)}`); }
    } else {
      console.log(`[${m.name}] 발송 실패 — 상태 미갱신(다음 주기 재시도)`);
    }
  } catch (e: any) {
    console.log(`[${m.name}] 조회 실패: ${e?.message?.slice(0, 100)} — skip (fail-soft)`);
  }
}

sigDb.close();
saveState(state);
console.log(`완료: ${monitors.length}개 모니터 · ${alerted}건 발송`);
