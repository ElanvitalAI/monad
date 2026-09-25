// ── 신호 라우터 — 적응형 투자 오토파일럿 A3 (2026-07-11) ──────────────────────
//
// 2차 게이트가 확정(confirmed critical)한 신호를 **두 출구**로 라우팅한다(대표 §0 게이팅):
//   ① interrupt — 스케줄 이탈 즉시 알림(발신 채널). S4 긴급 또는 2차 권고 alert/adjust.
//   ② batch     — 정규 다이제스트로 모아 1회 발송. 권고 watch(관망) → 배치.
//
// 이 라우터가 "조율 오케스트레이터(supervisor)"의 라우팅 함수 — 공유 신호 보드(SignalPool)를
// 전체 조망하여 즉시/배치로 낸다. (계약 의도 fan-in·리스크예산 밸런싱은 mandate 재-arm 후 A4/A5.)
//
// ★ shadow/live 이원화: send seam 미주입 = shadow(미리보기만·DB 무변경·무발송), 주입 = live
//   (발송 + routed_at/digested_at 소진). 첫 라이브는 shadow 로 pool 검증 후 대표 확인해 플립.
//
// 안전: 무매매(라우팅=알림/다이제스트만·mandate 정지). freshness 게이트로 stale 확정의
//   즉시-알림 스팸을 배치로 강등. 중복발사 제어는 하류 outbound delivery-ledger(dedup) 재사용.
//
// 설계: 내부 문서 `DESIGN-adaptive-investment-autopilot-2026-07-11` §5·§1.5·§12.6.

import { renderToString } from '@antv/infographic/ssr';
import type { CdpClient } from '../browser-cdp/client.js';
import { debug } from '../debug/log.js';
import type { Signal } from './signal-pool.js';
import { SignalPool } from './signal-pool.js';

export type Route = 'interrupt' | 'batch';

export interface RouteDecision { route: Route; reason: string; }

/** 확정 신호를 즉시 알림(interrupt) vs 배치(batch)로 분류 — 순수.
 *  ★ 디깅 피드백(대표 지시 2026-07-15): 반응형 렌즈(B1)가 저신뢰(low·데이터 모순/보류)로 판정한
 *    신호는 시스템이 스스로 의심하는 것 → 즉시알림을 억제(배치 강등). 디깅이 "이건 가짜/불확실"이라
 *    했는데 알림이 나가던 결함(오늘 유령 급락 알림 폭주) 방지. */
export function classifyRoute(s: Signal): RouteDecision {
  if (s.digConfidence === 'low') return { route: 'batch', reason: '디깅 저신뢰(모순/보류) → 배치 강등' };
  if (s.severity === 'S4') return { route: 'interrupt', reason: 'S4 긴급(보유·서킷)' };
  const rec = s.recommendation;
  if (rec === 'alert' || rec === 'adjust') return { route: 'interrupt', reason: `2차 권고 ${rec}` };
  return { route: 'batch', reason: `권고 ${rec ?? 'watch'} → 배치` };
}

/** 디깅 유예 창(분) — 미디깅 critical 을 이 시간 안에선 라우팅 유보(디깅이 먼저 검증). 넘으면 라우팅. */
export const DIG_GRACE_MIN = 20;

/** gate2At 이 freshnessMin 을 넘었나(오래된 확정 → 즉시-알림 스팸 방지). */
export function isStale(gate2At: string | undefined, now: number, freshnessMin: number): boolean {
  if (!gate2At) return true;              // 판정시각 불명 → 보수적으로 stale
  const t = Date.parse(gate2At);
  if (Number.isNaN(t)) return true;
  return now - t > freshnessMin * 60_000;
}

/** 즉시 알림 메시지(interrupt) — 간결·근거 포함. */
export function formatAlert(s: Signal): string {
  const lines = ['🚨 적응형 투자 · 즉시 알림 (confirmed critical)', ''];
  lines.push(`[${s.severity ?? '?'}] ${s.asset ? `${s.asset} · ` : ''}${s.source} (${s.origin})`);
  lines.push(s.raw.slice(0, 300));
  if (s.gate2Reason) lines.push(`판정: ${s.gate2Reason}`);
  // 반응형 렌즈(B1) 심화 verdict — 있으면 알림에 보강(dig-engine 심층분석).
  if (s.digVerdict) lines.push(`🔬 심화[${s.digConfidence ?? '?'}]: ${s.digVerdict.slice(0, 400)}`);
  if (s.evidenceUrl) lines.push(s.evidenceUrl);
  lines.push('', `권고: ${s.recommendation ?? 'watch'} · trust ${s.trust}`);
  lines.push('※ 무매매 · 관측/판단 알림(매매 mandate 정지)');
  return lines.join('\n');
}

/** 배치 다이제스트 메시지 — pending 신호를 심각도별로 묶어 1회. */
export function formatDigest(signals: Signal[]): string {
  const lines = [`📋 적응형 투자 · 다이제스트 (${signals.length}건)`, ''];
  const bySev = new Map<string, Signal[]>();
  for (const s of signals) {
    const k = s.severity ?? '?';
    (bySev.get(k) ?? bySev.set(k, []).get(k)!).push(s);
  }
  for (const sev of ['S4', 'S3', 'S2', 'S1', 'S0', '?']) {
    const grp = bySev.get(sev);
    if (!grp || grp.length === 0) continue;
    lines.push(`── ${sev} (${grp.length}) ──`);
    for (const s of grp) {
      const head = `${s.asset ? `${s.asset} ` : ''}${s.source}`;
      lines.push(`• ${head}: ${s.raw.slice(0, 120)}${s.recommendation ? ` [${s.recommendation}]` : ''}`);
    }
    lines.push('');
  }
  lines.push('※ 무매매 · 정규 배치 알림');
  return lines.join('\n');
}

/** 발송 seam — live 시 sendOutbound 주입. 반환=발송 성공. */
export type SendFn = (text: string, kind: string) => boolean;

/** PNG 배달 seam — live 시 sendReportPhotoBuffer 주입. 실패는 호출측 fail-soft. */
export type SendPhotoFn = (png: Buffer, opts?: { caption?: string }) => Promise<boolean> | boolean;

/** CDP 클라이언트 팩토리 — 기본은 createCdpClient(headless). 시험은 fake 주입. */
export type CreateCdpClientFn = () => Promise<CdpClient>;

export interface RoutedItem { eventId: string; route: Route; reason: string; preview: string; sent?: boolean; }
export interface RunRouterResult {
  mode: 'shadow' | 'live';
  total: number; interrupt: number; batch: number; sent: number; staleDowngraded: number;
  /** 디깅 대기로 이번 사이클 라우팅 유보한 수(미디깅 fresh critical). */
  digDeferred: number;
  items: RoutedItem[];
}

export interface RouterDeps {
  /** 발송기 — 미주입 = shadow(미리보기만·DB 무변경). 주입 = live. */
  send?: SendFn;
  now?: () => string;
  /** 즉시-알림 최신성 게이트(분·기본 360=6h). 초과 확정은 배치로 강등. */
  freshnessMin?: number;
  limit?: number;
  /** 인포그래픽 PNG 배달 — 부가. 미주입·실패·예외는 텍스트 소진 판정을 바꾸지 않는다. */
  sendPhoto?: SendPhotoFn;
  /** SVG→PNG 래스터라이저. 미주입이면 createCdpClient(headless) 기본. */
  createCdpClient?: CreateCdpClientFn;
  /** SVG 렌더러 주입(시험). 기본=@antv/infographic/ssr renderToString. */
  renderSvg?: (syntax: string) => Promise<string>;
}

/** 미라우팅 확정 신호를 즉시/배치로 라우팅. interrupt 는 즉시 발송(live), batch 는 다이제스트 대기.
 *  shadow(send 미주입) = 미리보기만·DB 무변경 → 검증 후 live 로 안전 플립. */
export function runRouter(pool: SignalPool, deps: RouterDeps = {}): RunRouterResult {
  const nowIso = (deps.now ?? (() => new Date().toISOString()))();
  const nowMs = Date.parse(nowIso);
  const freshnessMin = deps.freshnessMin ?? 360;
  const live = !!deps.send;
  const targets = pool.listUnrouted(deps.limit ?? 50);

  const items: RoutedItem[] = [];
  let interrupt = 0; let batch = 0; let sent = 0; let staleDowngraded = 0; let digDeferred = 0;

  for (const s of targets) {
    let { route, reason } = classifyRoute(s);
    // ★ dig-before-alert(대표 지시) — 미디깅 fresh critical 은 라우팅 유보(디깅이 먼저 검증하게).
    //   디깅이 데이터 모순을 잡았는데도 알림이 먼저 나가던 순서 결함 교정. bounded: grace(20분)
    //   넘게 미디깅이면 그냥 라우팅(무한 대기 금지). shadow 는 유보 표기만.
    const ageMin = s.gate2At ? (nowMs - Date.parse(s.gate2At)) / 60_000 : Infinity;
    if (route === 'interrupt' && !s.digVerdict && ageMin < DIG_GRACE_MIN) {
      digDeferred += 1;
      items.push({ eventId: s.eventId, route: 'batch', reason: '디깅 대기(유보·미라우팅)', preview: '[deferred] 디깅 전 유보' });
      continue;   // markRouted 안 함 → 다음 사이클 재시도(디깅 후 재판정)
    }
    // freshness — 오래된 확정의 즉시-알림은 배치로 강등(스팸 방지·§5 dedup/freshness).
    if (route === 'interrupt' && isStale(s.gate2At, nowMs, freshnessMin)) {
      route = 'batch'; reason += ' (stale→배치)'; staleDowngraded += 1;
    }
    const preview = route === 'interrupt' ? formatAlert(s) : `[batch] ${s.severity} ${s.source}: ${s.raw.slice(0, 80)}`;
    let didSend: boolean | undefined;
    if (route === 'interrupt') {
      interrupt += 1;
      if (live && deps.send) { didSend = deps.send(preview, 'alert'); if (didSend) sent += 1; }
    } else {
      batch += 1;
    }
    // live 만 상태 소진(shadow 는 무변경 → 재실행 미리보기 안전).
    if (live) pool.markRouted(s.eventId, route, nowIso);
    items.push({ eventId: s.eventId, route, reason, preview, ...(didSend !== undefined ? { sent: didSend } : {}) });
  }

  return { mode: live ? 'live' : 'shadow', total: targets.length, interrupt, batch, sent, staleDowngraded, digDeferred, items };
}

export interface RunDigestResult {
  mode: 'shadow' | 'live';
  count: number;
  sent: boolean;
  preview: string;
  /** PNG 부가 배달 실패를 이름으로 남긴다. 소진 판정과 독립. */
  photoError?: string;
}

export interface CommunityBuzzNarrative { narrative: string; count: number; lastAt: string; sample: string }

/** 커뮤니티 버즈 다이제스트 포맷(순수) — 상위 서사 요약. 매매 무관·가시화용(P5). */
export function formatCommunityBuzzDigest(narratives: CommunityBuzzNarrative[], windowHours: number): string {
  const head = `📣 커뮤니티 버즈 요약 (최근 ${windowHours}h · 상위 ${narratives.length}개 서사)`;
  const lines = narratives.map((n, i) => {
    const sample = n.sample.length > 70 ? n.sample.slice(0, 70) + '…' : n.sample;
    return `${i + 1}. ${n.narrative} · ${n.count}건\n   "${sample}"`;
  });
  return [head, '', ...lines, '', '※ 커뮤니티 정성 신호(S2)·매매 아님. 급증(dedup≥30)은 자동 2차 판정 회부.'].join('\n');
}

export interface RunBuzzDigestResult { mode: 'shadow' | 'live'; count: number; sent: boolean; preview: string }

/**
 * 최근 창 커뮤니티 버즈(S2·급증 미만)를 1회 요약 발송(live) 또는 미리보기(shadow) — P5.
 * 라우팅/소진 상태 안 건드림(read-only 가시화). 창 기반이라 매 사이클 현재 스냅샷을 낸다.
 */
export function runCommunityBuzzDigest(
  pool: SignalPool,
  deps: RouterDeps & { windowHours?: number; limit?: number } = {},
): RunBuzzDigestResult {
  const nowMs = deps.now ? Date.parse(deps.now()) : Date.now();
  const windowHours = deps.windowHours ?? 8;
  const sinceIso = new Date(nowMs - windowHours * 3_600_000).toISOString();
  const narratives = pool.topCommunityNarratives(sinceIso, deps.limit ?? 10);
  const live = !!deps.send;
  if (narratives.length === 0) return { mode: live ? 'live' : 'shadow', count: 0, sent: false, preview: '' };
  const preview = formatCommunityBuzzDigest(narratives, windowHours);
  let sent = false;
  if (live && deps.send) sent = deps.send(preview, 'report');
  return { mode: live ? 'live' : 'shadow', count: narratives.length, sent, preview };
}

/** YAML 스칼라 한 줄 — 라벨/설명이 구문을 깨지 않게 이스케이프. */
function yamlScalar(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/\r?\n/g, ' ')}'`;
}

/** 다이제스트 신호를 AntV infographic 구문으로 변환(결정론). */
export function digestInfographicSyntax(signals: Signal[]): string {
  const lines = [
    'infographic list-row-simple-horizontal-arrow',
    'data',
    `  title ${yamlScalar(`적응형 투자 · 다이제스트 (${signals.length}건)`)}`,
    '  desc 무매매 · 정규 배치 알림',
    '  lists',
  ];
  for (const s of signals) {
    const head = `${s.asset ? `${s.asset} ` : ''}${s.source}`;
    const rec = s.recommendation ? ` [${s.recommendation}]` : '';
    const label = `${s.severity ?? '?'} ${head}${rec}`.trim();
    const desc = s.raw.slice(0, 120);
    lines.push(`    - label ${yamlScalar(label)}`);
    lines.push(`      desc ${yamlScalar(desc)}`);
  }
  return lines.join('\n');
}

/** DSL → SVG. @antv/infographic/ssr renderToString. live 배달도 이 함수만 탄다. */
export async function renderDigestSvg(
  signals: Signal[],
  renderSvg: (syntax: string) => Promise<string> | string = renderToString,
): Promise<string> {
  return renderSvg(digestInfographicSyntax(signals));
}

/** SVG 문자열을 data:text/html URL 로 감싼다(저장소 관용구). */
export function svgDataHtmlUrl(svg: string): string {
  const html = [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"></head>',
    '<body style="margin:0;background:#fff">',
    svg,
    '</body></html>',
  ].join('');
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/** CDP 로 SVG 를 PNG 로 찍는다. librsvg 격리 래스터 경로는 타지 않는다. */
export async function rasterizeSvgViaCdp(
  svg: string,
  createClient: CreateCdpClientFn,
): Promise<Buffer> {
  const client = await createClient();
  try {
    await client.navigate(svgDataHtmlUrl(svg));
    return await client.screenshot();
  } finally {
    await client.close();
  }
}

async function defaultCreateCdpClient(): Promise<CdpClient> {
  const { createCdpClient } = await import('../browser-cdp/client.js');
  return createCdpClient({ headless: true });
}

async function deliverDigestPhoto(pending: Signal[], preview: string, deps: RouterDeps): Promise<boolean> {
  if (!deps.sendPhoto) return true;
  const svg = await renderDigestSvg(pending, deps.renderSvg);
  const createClient = deps.createCdpClient ?? defaultCreateCdpClient;
  const png = await rasterizeSvgViaCdp(svg, createClient);
  return await deps.sendPhoto(png, { caption: preview.slice(0, 1024) });
}

const PNG_DELIVERY_FAILURE = 'png-delivery-failure';

function observePngDeliveryFailure(cause: string, extra: Record<string, unknown> = {}): string {
  try { debug.log('signal.digest', PNG_DELIVERY_FAILURE, { cause, ...extra }); } catch { /* fail-open */ }
  return PNG_DELIVERY_FAILURE;
}

/** batch 대기 신호를 1회 다이제스트로 발송(live) 또는 미리보기(shadow).
 *  소진 기준은 텍스트 배달 성공 하나. PNG 는 부가 — 미주입·false·예외는 관측만 남기고 소진을 바꾸지 않는다. */
export async function runDigest(pool: SignalPool, deps: RouterDeps = {}): Promise<RunDigestResult> {
  const nowIso = (deps.now ?? (() => new Date().toISOString()))();
  const live = !!deps.send;
  const pending = pool.listPendingDigest(deps.limit ?? 100);
  if (pending.length === 0) return { mode: live ? 'live' : 'shadow', count: 0, sent: false, preview: '' };
  const preview = formatDigest(pending);
  let sent = false;
  let photoError: string | undefined;
  if (live && deps.send) {
    try {
      sent = deps.send(preview, 'report');
    } catch {
      sent = false;
    }
    // ⛔⭐ **소진을 «PNG 앞»에서 한다** (무인 리뷰 must-fix · 2026-09-07).
    //   종전엔 사진 작업을 `await` 한 «뒤»에 소진해서, CDP·전송이 ***hang 하면 텍스트가 이미
    //   배달됐는데도 pending 이 남았다*** ⇒ 다음 사이클이 같은 텍스트를 다시 보낸다.
    //   🔑 그것은 이 파일이 스스로 못 박은 정책(「소진 기준은 텍스트 배달 성공 하나」)을 어긴다 —
    //     PNG 는 «부가»인데 그 지연이 소진을 붙잡고 있었다.
    //   ⚠️ 순서만 바꾼다. 판정은 그대로고, PNG 실패는 여전히 `photoError` 로 남는다.
    if (sent) pool.markDigested(pending.map((s) => s.eventId), nowIso);
    if (sent && deps.sendPhoto) {
      try {
        const photoOk = await deliverDigestPhoto(pending, preview, deps);
        if (photoOk === false) photoError = observePngDeliveryFailure('sendPhoto-false');
      } catch (err) {
        photoError = observePngDeliveryFailure('exception', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return {
    mode: live ? 'live' : 'shadow',
    count: pending.length,
    sent,
    preview,
    ...(photoError ? { photoError } : {}),
  };
}
