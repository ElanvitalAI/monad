// ── Phase A (Capture Fabric · X2/X4 closure) — Posture sidecar text ──
//
// Convert ScreenshotWithMeta (composeScreenshotMeta result) into a
// LLM-friendly system-note text block. Vision LLMs receive both the
// PNG block and a separate text describing posture / recent intents,
// so they can reason about *what state the screen was in* rather than
// just *what pixels were captured*.
//
// Why a separate file from `screenshot-with-meta.ts`?
//   - `screenshot-with-meta.ts` is the data-shape composer (Phase 2).
//   - This file is the *consumer-side* text formatter — different
//     concern, separate test surface, and easier to extend with other
//     formats later (markdown · JSON · ACP system-note).
//
// Bilingual on purpose: the runtime can choose locale based on user's
// `voice.language` config or LLM target language. Default: English
// (Claude/Gemini default · stable across models).

import type { ScreenshotWithMeta, ScreenshotIntentMeta, ScreenshotPostureMeta } from './screenshot-with-meta.js';

export type SidecarLocale = 'en' | 'ko';

export interface SidecarTextOpts {
  /** UI/LLM language for the sidecar text. Default 'en'. */
  locale?: SidecarLocale;
  /** Cap on intents listed (newest last). Default 10 — large enough
   *  for typical reverse-feedback context, small enough to not blow
   *  the LLM's context budget. */
  maxIntents?: number;
  /** Wall-clock formatter override (test seam). */
  formatTime?: (ms: number) => string;
}

const DEFAULT_MAX_INTENTS = 10;

function defaultFormatTime(ms: number): string {
  // ISO-like, locale-stable. e.g. "2026-05-03T14:23:11Z"
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function formatPosture(posture: ScreenshotPostureMeta | null, locale: SidecarLocale): string {
  if (!posture) {
    return locale === 'ko'
      ? '표면 미식별 (전체 화면 캡처 또는 미등록 surface)'
      : 'no surface (whole-screen capture or unregistered surface)';
  }
  const exp = posture.exposure?.userExposure ?? 'unknown';
  const cap = posture.capability;
  // user 시점 4 capability flag — vision LLM 이 "이 화면에서 실제로 뭘
  // 할 수 있는지" 알게 한다. canRead/canWrite/canInspect 가 핵심 신호.
  const flags: string[] = [];
  if (cap) {
    if (cap.canRead) flags.push('read');
    if (cap.canWrite) flags.push('write');
    if (cap.canInspect) flags.push('inspect');
    if (cap.canInterrupt) flags.push('interrupt');
  }
  const flagStr = flags.length > 0 ? flags.join(',') : 'none';
  return `surface=${posture.surfaceId} · exposure=${exp} · cap=[${flagStr}]`;
}

function formatIntent(intent: ScreenshotIntentMeta, formatTime: (ms: number) => string): string {
  const ts = intent.ts !== undefined ? formatTime(intent.ts) : '?';
  return `  · ${intent.kind}@${intent.surfaceId} (r${intent.row}c${intent.col}) ${ts}`;
}

/**
 * Render the sidecar as a LLM-friendly text block.
 * Designed to be placed *before* the PNG block as a system-note so
 * the model sees "context first, image after" — better grounding.
 */
export function sidecarToSystemNote<TBase>(
  withMeta: ScreenshotWithMeta<TBase>,
  opts: SidecarTextOpts = {},
): string {
  const locale = opts.locale ?? 'en';
  const maxIntents = opts.maxIntents ?? DEFAULT_MAX_INTENTS;
  const formatTime = opts.formatTime ?? defaultFormatTime;

  const composedAt = formatTime(withMeta.composedAt);
  const postureLine = formatPosture(withMeta.posture, locale);
  const intents = withMeta.recentIntents.slice(-maxIntents);

  const header = locale === 'ko' ? '[캡처 메타데이터]' : '[Capture metadata]';
  const composedLabel = locale === 'ko' ? '캡처 시각' : 'composed at';
  const postureLabel = locale === 'ko' ? 'posture' : 'posture';
  const intentsHeader = locale === 'ko'
    ? `최근 intents (${intents.length}/${withMeta.recentIntents.length})`
    : `recent intents (${intents.length}/${withMeta.recentIntents.length})`;

  const lines: string[] = [
    header,
    `${composedLabel}: ${composedAt}`,
    `${postureLabel}: ${postureLine}`,
    intentsHeader + (intents.length === 0 ? ' — none' : ':'),
  ];
  for (const intent of intents) lines.push(formatIntent(intent, formatTime));

  return lines.join('\n');
}

/**
 * One-line summary — fits voice TTS or single-line log.
 * Short enough that a TTS engine doesn't speak for 30 seconds.
 */
export function sidecarToSummaryLine<TBase>(
  withMeta: ScreenshotWithMeta<TBase>,
  opts: { locale?: SidecarLocale } = {},
): string {
  const locale = opts.locale ?? 'en';
  if (!withMeta.posture) {
    return locale === 'ko'
      ? `캡처: surface 미식별 · intents=${withMeta.recentIntents.length}`
      : `capture: no-surface · intents=${withMeta.recentIntents.length}`;
  }
  const sid = withMeta.posture.surfaceId;
  const exp = withMeta.posture.exposure?.userExposure ?? 'unknown';
  if (locale === 'ko') {
    return `캡처: ${sid} (${exp}) · intents=${withMeta.recentIntents.length}`;
  }
  return `capture: ${sid} (${exp}) · intents=${withMeta.recentIntents.length}`;
}
