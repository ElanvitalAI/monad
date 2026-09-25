#!/usr/bin/env bun
// ── X/텔레그램 긴급 경제·정치 속보 → 긴급도 판정 → 텔레그램 알림 (2026-07-06) ──
//
// 소스 2계열 (dedup 공유):
//   A) X 워치리스트 — apify tweet-scraper `from:` 결합쿼리 1회 run (@DeItaone 등)
//   B) 텔레그램 공개 미러채널 — t.me/s/<ch> 웹 프리뷰 폴링 (Walter Bloomberg·
//      FinancialJuice — MTProto/전화인증 불필요, 조사로 실존·스크랩 가능 검증됨)
//
// 긴급도 필터 (대표 지시 — "긴급도 분석 로직 상시"):
//   신규 항목을 LLM이 4차원 판정 — urgency·market(전체 시장 영향)·semis(반도체
//   영향)·kr(한국 영향) 0~10. 판정 체인: grok budget tier(콜당 ~$0.002·
//   상시가용) → 로컬 LM Studio(:1234·nexus config rotation의 local provider — 무료·
//   GUI앱 의존이라 폴백) → 둘 다 실패 시 상위 N건 '판정불가' 태그로 발송(속보 유실 방지).
//
// 주기: cron */15 + 내부 세션 적응 — US/KR 라이브 15분·그 외 30분·주말 60분.
// 워치리스트: ~/.monad/conatus/x_watchlist.json (텔레그램에서 자연어 관리 — 리소스맵 §9)
// state: ~/.monad/conatus/x_breaking_state.json (seen ID dedup·lastRun)

import { tierModel } from '../src/llm/model-defaults.js';
import { sendOutbound } from '../src/domains/outbound-alert.js';
import { marketSessions } from '../src/domains/finance.js';
import { openSignalsDb, dedupeByText, isNearDuplicate, recentAlertedTexts, recentSentSignals } from '../src/domains/breaking-signals.js';
import { dedupeSignalsSemantic } from '../src/domains/signal-dedup.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// 07-07 관찰 수리: homebrew/bun 주입만으론 부족(node=nvm 전용) — nvm bin 동적 주입.
import { ensureCronNodePath } from '../src/domains/cron-path.js';
import { unknownCronFlag } from '../src/domains/cron-flag-contract.js';

const unknownFlag = unknownCronFlag(process.argv.slice(2), { boolean: ['--collect-only'], valued: [] });
if (unknownFlag) { console.error(`⛔ 모르는 플래그: ${unknownFlag}`); process.exit(1); }

ensureCronNodePath();

// ★ A1c — 수집/알림 분리(적응형 투자): --collect-only 면 breaking_signals 전량 적재만 하고
//   즉시 발송 skip(알림은 signal pool 게이트/라우터 독점). 미지정 시 기존 동작(적재+초긴급 발송).
const COLLECT_ONLY = process.argv.includes('--collect-only');

const WATCHLIST = join(homedir(), '.monad/conatus/x_watchlist.json');
const STATE = join(homedir(), '.monad/conatus/x_breaking_state.json');
const OMNI_ENV = join(homedir(), '.claude/skills/omni-crawl/.env');

// ── env self-load (omni-crawl .env — APIFY_TOKEN·XAI_API_KEY) ──
function skillEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    for (const line of readFileSync(OMNI_ENV, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq > 0) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
  } catch { /* fail-soft */ }
  return env;
}
const SENV = skillEnv();
const APIFY_TOKEN = process.env.APIFY_TOKEN || SENV.APIFY_TOKEN || '';
const XAI_KEY = process.env.XAI_API_KEY || SENV.XAI_API_KEY || '';

// ── watchlist / state ──
interface Watchlist {
  xAccounts: string[];
  tgChannels: string[];
  /** 즉시(🚨) 알림 임계 — "정말 긴급한 것만" (대표 지시 2026-07-06).
   *  ⚠️ 초긴급 = 전시장 매크로급(urgency/market)만. 섹터 impact는 즉시 발동에서
   *  제외(대표 지적 2026-07-06 밤 — 독일 재무장 defense9가 시장7인데 승격된 결함).
   *  impact는 digestFloor·다이제스트 랭킹에는 계속 반영. */
  immediate: { urgency: number; market: number };
  /** 다이제스트에 실리는 최소 점수(max(urgency,market,impact) 기준). 미만=DB만. */
  digestFloor: number;
  maxPerRun: number;
}
const DEFAULT_WL: Watchlist = {
  // 소스 축소(대표): DeItaone 제외(2026-07-06 — t.me/WalterBloomberg 동일 운영자 미러) ·
  // financialjuice 제외(2026-07-07 — FirstSquawk 와 헤드라인 중복 과다).
  xAccounts: ['FirstSquawk', 'unusual_whales', 'yonhaptweet'],
  tgChannels: ['WalterBloomberg'],
  immediate: { urgency: 9, market: 9 },
  digestFloor: 6,
  maxPerRun: 4,
};
function loadWatchlist(): Watchlist {
  try {
    if (existsSync(WATCHLIST)) {
      const raw = JSON.parse(readFileSync(WATCHLIST, 'utf-8'));
      delete raw.thresholds; // 구 스키마(v1 thresholds{7,7,6}) 제거 — immediate/digestFloor로 대체
      if (raw.immediate) delete raw.immediate.impact; // v2 스키마 — 섹터 impact 즉시발동 은퇴(대표 지적)
      const wl = { ...DEFAULT_WL, ...raw };
      writeFileSync(WATCHLIST, JSON.stringify(wl, null, 2)); // 스키마 마이그레이션 반영
      return wl;
    }
  } catch { /* fall through */ }
  mkdirSync(dirname(WATCHLIST), { recursive: true });
  writeFileSync(WATCHLIST, JSON.stringify(DEFAULT_WL, null, 2));
  return DEFAULT_WL;
}

interface State { seenIds: string[]; lastRunAt: string }
function loadState(): State {
  try { if (existsSync(STATE)) return JSON.parse(readFileSync(STATE, 'utf-8')); } catch { /* */ }
  return { seenIds: [], lastRunAt: '' };
}
function saveState(s: State): void {
  s.seenIds = s.seenIds.slice(-800); // 최근 800개만 유지
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(s, null, 2));
}

// ── 세션 적응 스킵 (cron은 */15 고정 — 여기서 실효 주기 결정) ──
function minIntervalMin(): number {
  const s = marketSessions();
  const anyLive = s.usLive || s.usOvernight || s.krLive || s.kr === 'OPEN';
  const day = new Date().getDay(); // 0=일 6=토 (로컬=KST)
  if (day === 0 || day === 6) return 60;
  return anyLive ? 15 : 30;
}

// ── 소스 A: apify from: 결합쿼리 ──
interface Item { id: string; source: string; author: string; text: string; url: string }
async function fetchX(accounts: string[]): Promise<Item[]> {
  if (!APIFY_TOKEN || accounts.length === 0) return [];
  const q = `(${accounts.map(a => `from:${a}`).join(' OR ')}) -filter:replies -filter:retweets`;
  const res = await fetch(`https://api.apify.com/v2/acts/apidojo~tweet-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ searchTerms: [q], sort: 'Latest', maxItems: 30, minimumFavorites: 0 }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`apify HTTP ${res.status}`);
  const data: any[] = await res.json();
  return data.map((it: any) => ({
    id: `x:${it.id ?? it.url ?? it.tweetUrl ?? ''}`,
    source: 'X',
    // apidojo 실응답: author.userName + fullText (user/text 아님 — 실측 확인)
    author: `@${it.author?.userName ?? it.author?.username ?? it.user?.username ?? '?'}`,
    text: String(it.fullText ?? it.text ?? '').replace(/\s+/g, ' ').trim(),
    url: it.url || it.tweetUrl || '',
  })).filter(i => i.text && i.id !== 'x:');
}

// ── 소스 B: t.me/s/<channel> 공개 웹 프리뷰 ──
async function fetchTg(channel: string): Promise<Item[]> {
  const res = await fetch(`https://t.me/s/${channel}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return [];
  const html = await res.text();
  const items: Item[] = [];
  // 메시지 블록: data-post="Channel/12345" ... <div class="tgme_widget_message_text ...">TEXT</div>
  const re = /data-post="([^"]+)"[\s\S]*?tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = m[2].replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ').trim();
    if (text) items.push({ id: `tg:${m[1]}`, source: 'TG', author: channel, text, url: `https://t.me/${m[1]}` });
  }
  return items;
}

// ── 긴급도 판정 (grok → 로컬 LM Studio 폴백) ──
interface Verdict { i: number; urgency: number; market: number; kr: number; sector: string; impact: number; reason: string }
function judgePrompt(items: Item[]): string {
  const list = items.map((it, i) => `${i + 1}. [${it.author}] ${it.text.slice(0, 300)}`).join('\n');
  // 토탈 알파(대표 지시): 반도체 고정이 아니라 주영향 섹터/자산을 동적 태깅 —
  // 머니무브먼트 순환 관찰의 원료. sector는 아래 태그 중 쉼표 복수 허용.
  // 시장 연관성 원칙(대표 지시 2026-07-07): 관심 시장=미국·한국. 제3국 로컬 뉴스
  // (쿠바 정전류)는 글로벌 파급/관심섹터 직접영향 없으면 저채점 → floor(6) 게이트가 거름.
  return `다음 속보들의 투자 관점 영향도를 판정해 JSON 배열만 출력(설명 금지). 각 항목: {"i":번호,"urgency":0-10(긴급도),"market":0-10(글로벌 시장 전체 영향),"kr":0-10(한국 시장 영향),"sector":"주영향 섹터/자산 태그(semis|sw|power|crypto|commodity|energy|bonds|fx|defense|healthcare|consumer|financials|other 중, 쉼표 복수 가능)","impact":0-10(해당 섹터/자산 영향도),"reason":"한국어 한 줄 = 헤드라인 번역 + 함의(대시보드 타이틀로 쓰임 — 예: '독일 8000억유로 재무장 차입 — 유럽 방산주 강세 재료')"}

채점 원칙(엄수):
- 관심 시장은 **미국·한국**이다. 두 시장(또는 글로벌 매크로: Fed·달러·미국채·유가·금·BTC·반도체 공급망)에 닿지 않는 뉴스는 낮게 채점하라.
- **제3국 로컬 사건**(예: 소국 정전·지역 선거·국지 사고·개별국 내정)은 ①글로벌 자산가격 파급이 구체적이거나 ②관심 섹터(반도체·에너지 공급망 등)에 직접 영향일 때만 5 이상. 아니면 urgency/market/impact 전부 0~3.
- 애매하면 낮게 — 과소채점이 과대채점보다 낫다(노이즈가 신호를 죽인다).

${list}

JSON 배열만:`;
}
function parseVerdicts(text: string, n: number): Verdict[] | null {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return null;
    return arr.filter((v: any) => typeof v?.i === 'number' && v.i >= 1 && v.i <= n);
  } catch { return null; }
}
async function judgeGrok(items: Item[]): Promise<Verdict[] | null> {
  if (!XAI_KEY) return null;
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${XAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: tierModel('budget', 'grok'), temperature: 0, messages: [{ role: 'user', content: judgePrompt(items) }] }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`grok HTTP ${res.status}`);
  const d: any = await res.json();
  return parseVerdicts(String(d?.choices?.[0]?.message?.content ?? ''), items.length);
}
/** 로컬 LM Studio — nexus config(llm.rotation의 provider:'local')에서 baseUrl 해석. */
function localLlmBase(): string {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.monad/config.json'), 'utf-8'));
    const local = (cfg?.llm?.rotation ?? []).find((r: any) => r?.provider === 'local');
    if (local?.baseUrl) return String(local.baseUrl).replace(/\/$/, '');
  } catch { /* fall through */ }
  return 'http://localhost:1234/v1';
}
async function judgeLocal(items: Item[]): Promise<Verdict[] | null> {
  const base = localLlmBase();
  // 로드된 모델 확인 (config 모델과 실로드가 다를 수 있음 — gemma 우선)
  const models: any = await (await fetch(`${base}/models`, { signal: AbortSignal.timeout(5_000) })).json();
  const ids: string[] = (models?.data ?? []).map((m: any) => m.id);
  if (!ids.length) return null;
  const model = ids.find(id => /gemma/i.test(id)) ?? ids[0];
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0, messages: [{ role: 'user', content: judgePrompt(items) }] }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`local llm HTTP ${res.status}`);
  const d: any = await res.json();
  return parseVerdicts(String(d?.choices?.[0]?.message?.content ?? ''), items.length);
}

// ── main ──
const wl = loadWatchlist();
const state = loadState();

// 세션 적응 스킵
const interval = minIntervalMin();
if (state.lastRunAt) {
  const elapsedMin = (Date.now() - Date.parse(state.lastRunAt)) / 60_000;
  if (elapsedMin < interval - 1) {
    console.log(`세션 간격 ${interval}분 미달(${elapsedMin.toFixed(0)}분) — skip`);
    process.exit(0);
  }
}

// 수집 (fail-soft per source)
const collected: Item[] = [];
const results = await Promise.allSettled([
  fetchX(wl.xAccounts),
  ...wl.tgChannels.map(ch => fetchTg(ch)),
]);
for (const r of results) {
  if (r.status === 'fulfilled') collected.push(...r.value);
  else console.log(`소스 실패: ${String(r.reason).slice(0, 100)}`);
}
console.log(`수집 ${collected.length}건 (X ${collected.filter(i => i.source === 'X').length} · TG ${collected.filter(i => i.source === 'TG').length})`);

// dedup — 신규만
const seen = new Set(state.seenIds);
const fresh = collected.filter(i => !seen.has(i.id));
const firstRun = state.seenIds.length === 0;
for (const i of collected) if (!seen.has(i.id)) { seen.add(i.id); state.seenIds.push(i.id); }
state.lastRunAt = new Date().toISOString();

if (firstRun) {
  saveState(state);
  console.log(`baseline — ${fresh.length}건 기록·무발송 (다음 신규부터 알림)`);
  process.exit(0);
}
if (fresh.length === 0) {
  saveState(state);
  console.log('신규 없음 — skip');
  process.exit(0);
}

// 긴급도 판정 (grok → 로컬 → 판정불가)
const batch = fresh.slice(0, 20); // 판정 상한
let verdicts: Verdict[] | null = null;
let judgedBy = '';
try { verdicts = await judgeGrok(batch); judgedBy = 'grok'; } catch (e: any) { console.log(`grok 판정 실패: ${e?.message?.slice(0, 80)}`); }
if (!verdicts) {
  try { verdicts = await judgeLocal(batch); judgedBy = 'local-llm'; } catch (e: any) { console.log(`로컬 판정 실패: ${e?.message?.slice(0, 80)}`); }
}

// ── 전량 DB 적재 + 초긴급만 즉시 알림 (대표 지시: "정말 긴급한 것만, 나머지는 기록") ──
let toSend: Array<{ item: Item; v?: Verdict; dupSources?: number }> = [];
const db = openSignalsDb();
const ins = db.prepare(`INSERT OR IGNORE INTO signals
  (id, ts, source, author, text, url, urgency, market, kr, sector, impact, reason, judged_by, alerted)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const nowIso = new Date().toISOString();

if (verdicts) {
  const t = wl.immediate;
  const priorAlerted = recentAlertedTexts(db, 12); // 배치 INSERT 전 스냅샷 (자기매칭 방지)
  const priorSent = recentSentSignals(db, 6);      // 6h 의미 dedup 스냅샷 (2026-07-07 대표 피드백)
  for (const v of verdicts) {
    const item = batch[v.i - 1];
    if (!item) continue;
    // 초긴급 = 전시장 매크로급만(urgency/market). 섹터 impact 9는 다이제스트로 —
    // "방산주 일부 영향 ≠ 전세계 매크로" (대표 지적 2026-07-06 밤).
    const ultra = v.urgency >= t.urgency || v.market >= t.market;
    ins.run(item.id, nowIso, item.source, item.author, item.text.slice(0, 500), item.url,
      v.urgency ?? 0, v.market ?? 0, v.kr ?? 0, String(v.sector ?? 'other').slice(0, 80), v.impact ?? 0,
      String(v.reason ?? '').slice(0, 200), judgedBy, ultra ? 1 : 0);
    if (ultra) toSend.push({ item, v });
  }
  toSend.sort((a, b) => Math.max(b.v!.urgency, b.v!.market, b.v!.impact) - Math.max(a.v!.urgency, a.v!.market, a.v!.impact));
  // 동일 뉴스 dedup: ① 이번 배치 내 다중소스 접기(토큰) ② 최근 12h 기발송분 근사중복
  // ③ 6h 의미 dedup(한/영 교차·1보/종합 — LLM→임베딩→Jaccard 폴백 · 대표 피드백 07-07)
  const collapsed = dedupeByText(toSend, x => x.item.text)
    .filter(({ item }) => !priorAlerted.some(p => isNearDuplicate(p, item.item.text)));
  const sem = await dedupeSignalsSemantic(collapsed, priorSent, {
    getSignal: (x) => ({ text: x.item.text, reason: x.v?.reason ?? null }),
  });
  if (sem.suppressed > 0) console.log(`의미 dedup(${sem.method}): 기발송 중복 ${sem.suppressed}건 억제`);
  toSend = sem.kept.slice(0, wl.maxPerRun).map(({ item, sources }) => ({ ...item, dupSources: sources }));
  const digestible = verdicts.filter(v => Math.max(v.urgency, v.market, v.impact ?? 0) >= wl.digestFloor).length;
  console.log(`판정(${judgedBy}): 신규 ${batch.length}건 전량 DB 기록 → 초긴급 ${toSend.length}건 · 다이제스트 대기 ${digestible - toSend.length}건`);
} else {
  // 판정 체인 전멸 — 속보 유실 방지: 상위 3건 '판정불가' 발송 (점수 없이 기록)
  toSend = fresh.slice(0, 3).map(item => ({ item }));
  for (const { item } of toSend) {
    ins.run(item.id, nowIso, item.source, item.author, item.text.slice(0, 500), item.url,
      null, null, null, null, null, null, 'none', 1);
  }
  console.log(`판정 불가(양쪽 실패) — 상위 ${toSend.length}건 무필터 발송`);
}
db.close();

// ★ A1c collect-only — 적재 끝. 발송/다이제스트는 signal pool 게이트가 담당 → 여기서 종료.
if (COLLECT_ONLY) {
  saveState(state);
  console.log(`collect-only: breaking_signals 적재 완료 (발송 skip · 게이트가 알림 독점)`);
  process.exit(0);
}

if (toSend.length === 0) {
  saveState(state);
  console.log('초긴급 없음 — 즉시 발송 없음 (다이제스트 08/12/15/19 KST 배치로)');
  process.exit(0);
}

const lines = [
  `🚨 초긴급 속보 (${toSend.length}건${judgedBy ? ` · 판정: ${judgedBy}` : ' · ⚠️판정불가'})`,
  ...toSend.map(({ item, v, dupSources }) => {
    const tag = v ? `[긴급${v.urgency}·시장${v.market}·${v.sector ?? '?'}${v.impact}${v.kr >= 6 ? `·KR${v.kr}` : ''}]` : '[⚠️판정불가]';
    const multi = (dupSources ?? 1) > 1 ? ` (×${dupSources}개 소스 동일보도)` : '';
    const reason = v?.reason ? `\n  ↳ ${v.reason}` : '';
    return `\n${tag} ${item.author}${multi}\n${item.text.slice(0, 240)}${reason}\n${item.url}`;
  }),
  `\n(READ-ONLY 정보 알림 · 매매는 verify+HITL)`,
];
const msg = lines.join('\n');
console.log(msg);
if (sendOutbound(msg, 'alert')) {
  console.log('발송 완료');
} else {
  console.log('발송 실패 — state는 저장(중복 방지 우선)');
}
saveState(state);
