// ── URL route executor (shared orchestrator) ──
//
// PLAN-url-triage-routing-2026-07-22 · P4.
//
// Both main interactive surfaces (TUI dashboard + Telegram) call this to
// turn a UrlRouteDecision into skill run(s). It owns the "빠른→상세
// 자동연속" (quick→detailed two-stage) composition so neither surface
// re-implements it.
//
// ⚠️ No single skill natively does "quick then detailed" — each
// executeSkill call produces one depth. This orchestrator composes two
// sequential runs (brief → detailed+save) by handing the skill an
// intent phrase its own SKILL.md router understands (짧게/상세/저장).
// The absorb path (yt-vault) is single-pass — absorb IS the detailed
// endpoint.
//
// Cost note: two-stage = two LLM tool-loops (the "extract-once, reuse
// transcript" optimization via --only transcript / --transcript-file is
// a documented future refinement; kept out here to avoid brittle
// intermediate-file plumbing through the executeSkill indirection).

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { homedir } from 'node:os';
import { parseSkillMd, executeSkill } from './runner.js';
import type { UrlRouteDecision } from './url-router.js';
import { extractObsidianPath, distillSummary, stripProcessNoise } from './url-route-curate.js';
import { createMarkdownPublishService, type MarkdownPublishDeps } from '../nexus/api/markdown-publish.js';
import { isS3Available, s3PublicBase } from '../storage/s3.js';
import { debug } from '../debug/log.js';

export type UrlStageKind = 'quick' | 'detailed' | 'absorb' | 'summary';

export interface UrlStageResult {
  kind: UrlStageKind;
  /** Raw skill output (with process narration — kept for observability). */
  text: string;
  /** Curated, send-ready message (distilled 요약 for quick/summary, Obsidian
   *  link for detailed/absorb). This is what chat surfaces post. */
  curated: string;
  /** Obsidian save path extracted from the run, when present. */
  obsidianPath?: string;
  /** Public share URL (S3) when the detailed/absorb note was published for
   *  external sharing. Absent when publishing was skipped/failed (fail-soft). */
  publicUrl?: string;
}

export interface RunUrlRouteOpts {
  /** Streaming callback per stage — surfaces render each stage as its
   *  own message/edit (telegram: separate messages; TUI: appended). */
  onStage?: (kind: UrlStageKind, delta: string, full: string) => void;
  /** Fired once when a stage completes with the CURATED (clean) text —
   *  surfaces post this. Raw output + obsidian path passed as meta. */
  onStageDone?: (kind: UrlStageKind, curated: string, meta: { raw: string; obsidianPath?: string }) => void;
  signal?: AbortSignal;
  modelOverride?: string;
  priorConversation?: Array<{ role: 'user' | 'assistant'; text: string }>;
  /** Skip LLM distillation (deterministic strip only). Default false. */
  noDistill?: boolean;
  /** Publish the saved detailed/absorb note for external sharing → public URL
   *  (or null to skip). Test-injection seam; defaults to publishMarkdownForShare
   *  (external-markdown publishing → S3 public URL). */
  publishForShare?: (markdown: string, title: string) => string | null;
  /** Read the saved note's markdown for publishing. Test seam; defaults to
   *  reading obsidianPath from disk (null on any error → publish skipped). */
  readMarkdownForShare?: (path: string) => string | null;
}

export interface RunUrlRouteResult {
  ok: boolean;
  skill: string;
  stages: UrlStageResult[];
  error?: string;
}

/** Human phrase describing the save targets, folded into the intent so
 *  the skill's own router picks the right --target. Empty when no
 *  targets (skill uses its default). */
function saveClause(targets: string[]): string {
  const t = targets.map(s => s.toLowerCase());
  if (t.includes('obsidian')) return ' 옵시디언에 저장해줘.';
  if (t.length > 0) return ` ${targets.join('/')}로 저장해줘.`;
  return '';
}

/** Build the $ARGUMENTS intent string for one stage. The URL leads so
 *  the skill's URL detection fires; the NL suffix steers format/target. */
function stageArgs(dec: UrlRouteDecision, kind: UrlStageKind): string {
  const save = saveClause(dec.targets);
  switch (kind) {
    case 'quick':
      // Fast first feedback — brief, no save (the detailed stage saves).
      return `${dec.url} 짧게 핵심만 빠르게 요약해줘. 저장은 하지 마.`;
    case 'detailed':
      return `${dec.url} 상세하게 분석해서 정리해줘.${save}`;
    case 'absorb':
      return `${dec.url} 흡수해서 지식화하고${save || ' 저장해줘.'}`;
    case 'summary':
    default:
      return `${dec.url} 요약해서 정리해줘.${save}`;
  }
}

/** The ordered stage plan for a decision — each entry is a skill run
 *  with its $ARGUMENTS intent string. Exported so surfaces that own
 *  their own skill-execution UI (the TUI dashboard) can iterate the
 *  same plan through their native runner instead of re-deriving it. */
export function urlStagePlan(dec: UrlRouteDecision): { kind: UrlStageKind; args: string }[] {
  const stages: UrlStageKind[] =
    dec.absorb ? ['absorb'] :
    dec.twoStage ? ['quick', 'detailed'] :
    ['summary'];
  return stages.map(kind => ({ kind, args: stageArgs(dec, kind) }));
}

/** 외부 공유 가능한 공개 URL 인지 판정 — 공개 http(s) 만 통과. 내부 제어면
 *  (nexus /d/:id 서빙 경로·localhost·사설/링크로컬 IP) 은 거부해 telegram 등
 *  외부 표면에 절대 노출하지 않는다(보안 원칙: 공개=S3 정적만·제어면 비노출). */
export function isShareablePublicUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const h = u.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1') return false;
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false; // 사설
  if (/^169\.254\./.test(h)) return false;                                                            // 링크로컬
  if (u.pathname === '/d' || u.pathname.startsWith('/d/')) return false;                              // 내부 서빙 경로
  return true;
}

/** Obsidian 저장 파일명 → 게시 제목. 날짜 프리픽스/언더스코어 정리. */
function deriveShareTitle(obsidianPath: string): string {
  const base = basename(obsidianPath).replace(/\.md$/i, '');
  return base.replace(/^\d{8}_/, '').replace(/_+/g, ' ').trim() || 'Summary';
}

// 외부 공개 게시 전용 서비스(싱글턴) — canonical origin = S3 공개 base(https).
// getDefaultMarkdownPublishService 는 nexus 내부 서빙(localhost·http)용이라 렌더러의
// HTTPS canonical 요구에 걸린다 → 공유 게시는 S3 base origin 서비스를 따로 쓴다.
let _shareService: MarkdownPublishDeps | null = null;
function shareService(): MarkdownPublishDeps {
  if (!_shareService) {
    const root = process.env.ELANOUS_PUBLISH_ROOT || `${homedir()}/.elanous/publishing`;
    _shareService = createMarkdownPublishService({ root, origin: s3PublicBase() });
  }
  return _shareService;
}

/** 마크다운을 external-markdown publishing 으로 외부 공개 게시하고 공개 URL(S3) 을 반환.
 *  실패(S3 미가용·게시 예외) 시 null(fail-soft·계측). canonical origin = S3 공개 base(https). */
export function publishMarkdownForShare(markdown: string, title: string): string | null {
  if (!isS3Available()) { debug.log('url-route.publish', 'skip-no-s3', {}); return null; }
  try {
    const svc = shareService();
    if (!svc.store || !svc.publishToS3) return null;
    const result = svc.publisher.publish({ markdown, title, target: 'funnel' });
    const html = svc.store.readPublicArtifact(result.id, 'funnel');
    const url = svc.publishToS3(result.id, html) ?? null;
    debug.log('url-route.publish', 'published', { id: result.id, title: title.slice(0, 60), hasUrl: !!url });
    return url;
  } catch (e) {
    debug.log('url-route.publish', 'error', { title: title.slice(0, 60), error: (e as Error).message?.slice(0, 160) }, { level: 'error' });
    return null;
  }
}

/** ★ Obsidian(또는 임의) 마크다운 파일 경로를 바로 외부 공개 게시하고 공개 URL 을 반환.
 *  경로에 공백·한글이 있어도 안전 — fs 는 문자열 경로를 그대로 받고(셸 미경유), S3 업로드는
 *  stdin(파일경로 미전달)·publish id 는 ASCII 랜덤이라 경로 문자가 S3 키/명령에 새지 않는다.
 *  파일 없음/빈 파일 시 null(계측). title 은 파일명에서 유도. */
export function publishObsidianFile(path: string): string | null {
  let markdown: string;
  try {
    markdown = readFileSync(path, 'utf8');
  } catch (e) {
    debug.log('url-route.publish', 'read-error', { path: basename(path), error: (e as Error).message?.slice(0, 120) }, { level: 'error' });
    return null;
  }
  if (!markdown.trim()) { debug.log('url-route.publish', 'empty-file', { path: basename(path) }); return null; }
  return publishMarkdownForShare(markdown, deriveShareTitle(path));
}

/** detailed/absorb 의 Obsidian 저장분을 게시해 공개 링크를 curated 메시지에 덧붙인다.
 *  순수 — 게시·파일읽기는 주입(테스트 mock). fail-soft: obsidianPath 없음·파일읽기 실패·
 *  게시 실패·비공개(제어면) URL 이면 원본 curated 를 그대로 돌려준다(요약 발송을 막지 않음). */
export function appendPublicShareLink(
  curated: string,
  obsidianPath: string | undefined,
  deps: {
    publish: (markdown: string, title: string) => string | null;
    readMarkdown: (path: string) => string | null;
  },
): { curated: string; publicUrl?: string } {
  if (!obsidianPath) return { curated };
  const markdown = deps.readMarkdown(obsidianPath);
  if (!markdown) return { curated };
  const publicUrl = deps.publish(markdown, deriveShareTitle(obsidianPath));
  if (!isShareablePublicUrl(publicUrl)) return { curated };
  return { curated: `${curated}\n🌐 공개 링크: ${publicUrl}`, publicUrl };
}

/** 기본 파일 읽기 — obsidianPath 의 .md 내용. 실패 시 null(게시 스킵). */
function defaultReadMarkdownForShare(path: string): string | null {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

/** Run the decision's skill, composing quick→detailed when requested.
 *  Interactive-only (R7) — callers gate on surface before calling. */
export async function runUrlRoute(
  dec: UrlRouteDecision,
  opts: RunUrlRouteOpts = {},
): Promise<RunUrlRouteResult> {
  const manifest = parseSkillMd(dec.skill);
  if (!manifest) {
    return { ok: false, skill: dec.skill, stages: [], error: `skill "${dec.skill}" not found under ~/.claude/skills/` };
  }

  const plan = urlStagePlan(dec);
  const results: UrlStageResult[] = [];
  for (const { kind, args } of plan) {
    if (opts.signal?.aborted) break;
    let text = '';
    try {
      const r = await executeSkill(
        manifest,
        args,
        (_delta, full) => { text = full; opts.onStage?.(kind, _delta, full); },
        {
          signal: opts.signal,
          modelOverride: opts.modelOverride,
          priorConversation: opts.priorConversation,
        },
      );
      text = r.fullResponse || text;
    } catch (e) {
      // Fail-soft: return what we have; caller falls back to LLM turn.
      return {
        ok: false,
        skill: dec.skill,
        stages: results,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    // ── Curate (P4b · the "UX 정제 에이전트") ──
    // Strip skill-execution noise. detailed/absorb → the note lives in the
    // vault, so post only the Obsidian link. quick/summary → distill to a
    // clean 요약. Falls back to a deterministic strip if the distiller errors.
    const obsidianPath = extractObsidianPath(text) ?? undefined;
    let curated: string;
    let publicUrl: string | undefined;
    if (kind === 'detailed' || kind === 'absorb') {
      curated = obsidianPath
        ? `📄 상세 분석 저장됨\n${obsidianPath}`
        : (opts.noDistill ? stripProcessNoise(text) : await distillSummary(text, { signal: opts.signal, model: opts.modelOverride }));
      // ★ E2 — 상세 분석을 external-markdown 으로 게시하고 공개 링크를 curated 에 덧붙인다.
      //   fail-soft(게시 실패해도 Obsidian 링크 유지) · publicUrl(S3 공개) 만 노출(제어면 URL 금지).
      const shared = appendPublicShareLink(curated, obsidianPath, {
        publish: opts.publishForShare ?? publishMarkdownForShare,
        readMarkdown: opts.readMarkdownForShare ?? defaultReadMarkdownForShare,
      });
      curated = shared.curated;
      publicUrl = shared.publicUrl;
    } else {
      curated = opts.noDistill
        ? stripProcessNoise(text)
        : await distillSummary(text, { signal: opts.signal, model: opts.modelOverride });
    }

    results.push({ kind, text, curated, obsidianPath, ...(publicUrl ? { publicUrl } : {}) });
    opts.onStageDone?.(kind, curated, { raw: text, obsidianPath });
  }

  return { ok: true, skill: dec.skill, stages: results };
}
