#!/usr/bin/env bun
// ── DART 공시 폴러 (2026-07-07 · 대표 지시) ─────────────────────────────
// 삼성·SK하이닉스(기본 · config raw dart.corps 오버라이드) 신규 공시를
// OpenDART로 감지 → 원문 다운로드 → LLM 요약 → 제목+요약+뷰어링크 알림.
// firecrawl DART 모니터("변경 감지 1건"만 오던 것)의 대체.
// cron: */30 7-19 * * 1-5 (KST 공시 시간대) · 야간무음은 sendOutbound 상속.

import { unknownCronFlag } from '../src/domains/cron-flag-contract.js';

// ⛔ 거부는 경로 설정과 모든 공시 처리보다 앞이다 — 최상위 throw는 크론 로그에 스택을 남긴다.
const unknownFlag = unknownCronFlag(process.argv, { boolean: ['--to-pool'], valued: [] });
if (unknownFlag) { console.error(`⛔ 모르는 플래그: ${unknownFlag}`); process.exit(1); }

// 07-07 관찰 수리: homebrew/bun 주입만으론 부족(node=nvm 전용) — nvm bin 동적 주입.
import { ensureCronNodePath } from '../src/domains/cron-path.js';
ensureCronNodePath();

import {
  resolveDartApiKey, resolveDartCorps, fetchDisclosures,
  downloadDisclosureText, summarizeDisclosure, loadSeen, saveSeen, viewerUrl,
  isRoutineDisclosure, resolveDartFloor,
} from '../src/domains/dart.js';
import { sendOutbound } from '../src/domains/outbound-alert.js';
import { SignalPool } from '../src/domains/signal-pool.js';

const MAX_PER_RUN = 3; // 원문 다운로드+LLM 요약은 건당 비용 — 런당 상한(나머지는 다음 주기)

// ★ 신규 버전(대표 지시): --to-pool 이면 발송 대신 signal pool 에 공시 신호 적재 → 과다신호
//   게이팅(gate2 luna)·라우터/코디네이터 조율. 공시=고가치 이벤트라 curated S3(중요도 8+=S4).
const TO_POOL = process.argv.includes('--to-pool');
// 발행사명 → 티커(focus 매칭·게이트체인 restrictToFocus). 미매핑=asset 없이 적재(신호는 유효).
const CORP_TICKER: Record<string, string> = {
  '삼성전자': '005930.KO', 'SK하이닉스': '000660.KO',
};
const pool = TO_POOL ? new SignalPool() : null;

const apiKey = resolveDartApiKey();
if (!apiKey) { console.error('DART_API_KEY 없음 — config raw dart.apiKey 또는 asset-attractiveness/.env'); process.exit(1); }

const kstNow = new Date(Date.now() + 9 * 3600_000);
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
const today = ymd(kstNow);
const yesterday = ymd(new Date(kstNow.getTime() - 86400_000));

const seen = loadSeen();
const fresh: Array<{ corp: string; d: import('../src/domains/dart.js').DartDisclosure }> = [];
for (const corp of resolveDartCorps()) {
  try {
    const list = await fetchDisclosures(apiKey, corp.corpCode, yesterday, today);
    for (const d of list) {
      if (seen.has(d.rcept_no)) continue;
      fresh.push({ corp: corp.name, d });
    }
  } catch (e) {
    console.error(`목록 조회 실패(${corp.name}): ${e instanceof Error ? e.message : String(e)}`);
  }
}

if (fresh.length === 0) { console.log('신규 공시 없음'); process.exit(0); }

// ── 중요도 필터 (대표 피드백 07-07: "무조건 공시 말고 중요한 것만") ──
// ① 룰 프리필터: 루틴 공시(지분 소소변동·IR개최 등)는 LLM 없이 접음(seen 기록).
const floor = resolveDartFloor();
let routineSkipped = 0;
const candidates = fresh.filter(({ corp, d }) => {
  if (isRoutineDisclosure(d.report_nm)) {
    seen.add(d.rcept_no);
    routineSkipped++;
    console.log(`루틴 skip: [${corp}] ${d.report_nm.trim()}`);
    return false;
  }
  return true;
});

// 접수번호 오름차순(오래된 것 먼저) — 런당 상한 초과분은 seen 미기록 → 다음 주기 처리
candidates.sort((a, b) => a.d.rcept_no.localeCompare(b.d.rcept_no));
let sent = 0, lowImportance = 0;
for (const { corp, d } of candidates.slice(0, MAX_PER_RUN)) {
  const title = d.report_nm.trim();
  const text = await downloadDisclosureText(apiKey, d.rcept_no);
  const j = text
    ? await summarizeDisclosure(title, text)
    : { summary: '(원문 다운로드 실패 — 뷰어 링크 참조)', importance: null };
  // ② LLM 중요도 floor — 미만은 DB(seen)만·무발송. 판정불가(null)는 발송(유실 방지).
  if (j.importance !== null && j.importance < floor) {
    seen.add(d.rcept_no);
    lowImportance++;
    console.log(`중요도 ${j.importance}<${floor} skip: [${corp}] ${title}`);
    continue;
  }
  const impTag = j.importance !== null ? `중요도 ${j.importance}` : '⚠️판정불가';
  const msg = [
    `📄 DART 공시 — ${corp} [${impTag}]`,
    `${title} (${d.rcept_dt.slice(4, 6)}/${d.rcept_dt.slice(6, 8)} · 제출 ${d.flr_nm.trim()})`,
    '',
    j.summary,
    '',
    viewerUrl(d.rcept_no),
    '(READ-ONLY 공시 알림 · 매매는 verify+HITL)',
  ].join('\n');
  if (TO_POOL && pool) {
    // 신규 버전 — pool 적재(발송 대신). 게이트가 알림/집행 독점.
    const sev = (j.importance !== null && j.importance >= 8) ? 'S4' : 'S3';   // 고중요=긴급
    const ticker = CORP_TICKER[corp];
    pool.ingest({
      eventId: `dart:${d.rcept_no}`,
      source: 'disclosure',
      ...(ticker ? { asset: ticker } : {}),
      observedAt: new Date().toISOString(), collectedAt: new Date().toISOString(),
      origin: `DART/${corp}`, evidenceUrl: viewerUrl(d.rcept_no),
      trust: 0.9, severity: sev, severityReason: `공시 ${impTag}`,
      dedupGroup: ticker ?? corp,
      raw: `[공시·${corp}${ticker ? ` ${ticker}` : ''}] ${title} — ${j.summary}`.slice(0, 500),
    });
    seen.add(d.rcept_no); sent++;
    console.log(`pool 적재[${sev}]: [${corp}·${impTag}] ${title}`);
  } else if (sendOutbound(msg, 'alert')) {
    seen.add(d.rcept_no);
    sent++;
    console.log(`발송: [${corp}·${impTag}] ${title} (${d.rcept_no})`);
  } else {
    console.error(`발송 실패: ${d.rcept_no} — seen 미기록(재시도)`);
  }
}
saveSeen(seen);
pool?.close();
const rest = candidates.length - Math.min(candidates.length, MAX_PER_RUN);
console.log(`완료: 신규 ${fresh.length}건 → 루틴 ${routineSkipped} · 저중요 ${lowImportance} 접음 · ${sent}건 ${TO_POOL ? 'pool 적재' : '발송'}${rest > 0 ? ` (잔여 ${rest}건 다음 주기)` : ''}`);
