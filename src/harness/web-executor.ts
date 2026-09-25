// 하니스 웹 도메인 executor — content-to-web 게시 (트랙 X/웹 · 2026-07-22)
//
// PLAN-execution-cycle-harness-expansion 트랙 X(도메인 executor). X1 DomainExecute seam 위에 얹는 **웹 게시**
// executor. ⚠️ 투자 집행(X3·execution-executor.ts)과 **정반대** — 대표 A3 확정: "웹 배포/게시=위험 없음·요청 시
// 게시·게이트 불필요"(돈 아님). 따라서 fail-closed/드라이런 규율을 복제하지 않고 **실배포 허용**.
//
// 흐름: objective → content-to-web 게시(HTML 생성+vercel 배포·publish seam) → URL → B2 CDP 렌더 검증
//       (verifyDeployedPage·#5065) → Q3 종결 published(changes:[]·ref=URL).
// ⚠️ Q3 published 종결 도달 조건 = **changes:[]**(워크트리 변경 0). HTML 은 워크트리 밖에 산출·배포되고
//    최종 성과는 게시 URL 이므로 changes 를 남기지 않는다(파일 PR 아님·게시). harness-seams deploy 가 nonCodeOutcome
//    소비→kind='published'.
// ⚠️ content-to-web 은 Write 필요(HTML 생성)·HARNESS_EXEC_ALLOWLIST 밖 → research isolation(Write deny) 경로
//    재사용 불가. publish seam 은 isolation 없이 skill 을 실행한다(전용 신규 경로).

import type { DomainExecuteCtx, DomainExecuteResult } from './skill-executor.js';
import { verifyDeployedPage, type DeployVerifyFinding, type DeployVerifyResult } from './browser-verify.js';
import { observeDeliverables, type UnmeasuredDeliverable } from './deliverable-observation.js';
import { debug } from '../debug/log.js';

const observe = (event: string, data: Record<string, unknown>): void => {
  try { debug.log('harness.web-executor', event, data); } catch { /* fail-soft */ }
};

export interface WebPublishResult {
  /** 게시된 URL(vercel 등). */
  url: string;
  /** 게시 상세(요약·프로젝트명 등). */
  detail: string;
}

export type WebVerifyResult = Pick<DeployVerifyResult, 'ok' | 'findings'>
  & Partial<Omit<DeployVerifyResult, 'ok' | 'findings' | 'url'>>;

export interface WebDomainDeps {
  /** content-to-web 게시(HTML 생성+배포)→URL. isolation 없이 실행(Write 허용). 실패/URL없음=null. */
  publish: (objective: string, onProgress?: (delta: string) => void) => Promise<WebPublishResult | null>;
  /** 배포 URL 렌더 검증(B2·기본 verifyDeployedPage). CDP 없으면 skip(fail-soft·게시 안 막음). */
  verify?: (url: string) => Promise<WebVerifyResult>;
}

export type WebDeployFindingObservation = {
  target: string;
  findings: readonly DeployVerifyFinding[];
};

export type WebDomainExecuteResult = DomainExecuteResult & {
  deployFindings?: ReadonlyMap<string, {
    target: string;
    findings?: readonly DeployVerifyFinding[];
  }>;
  /** Raw graded findings, retained even when the target is partly unmeasured and excluded from triage. */
  deployFindingObservations?: readonly WebDeployFindingObservation[];
  unmeasuredDeliverables?: readonly UnmeasuredDeliverable[];
};

export type WebDomainExecute = (ctx: DomainExecuteCtx) => Promise<WebDomainExecuteResult>;

/** vercel 배포 stdout 등에서 게시 URL 추출. */
export function parseVercelUrl(text: string): string | null {
  const m = text.match(/https:\/\/[a-z0-9][a-z0-9.-]*\.vercel\.app[^\s)"'`]*/i);
  return m ? m[0] : null;
}

/** 게시 성공의 감사 ref는 공백 없는 절대 HTTP(S) URL이어야 한다. */
export function validPublishedUrl(value: string): string | null {
  const url = value.trim();
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * ★ 웹 도메인 executor(A3 저위험·실배포 허용). content-to-web 게시→URL→B2 렌더 검증→published 종결.
 * changes:[] 로 반환(파일 PR 아님·게시). 렌더 문제(findings)는 summary 경고로만(게시 우선·A3).
 */
export function buildWebDomainExecute(deps: WebDomainDeps): WebDomainExecute {
  return async (ctx: DomainExecuteCtx): Promise<WebDomainExecuteResult> => {
    const verify = deps.verify ?? verifyDeployedPage;
    // rework 라운드면 이전 리뷰 지적을 objective 에 얹어 재게시(코드 executor 동형).
    const objective = ctx.priorFindings && ctx.priorFindings.length
      ? `${ctx.objective}\n\n[이전 지적 — 반영해 재게시]\n${ctx.priorFindings.map((f) => `- ${f}`).join('\n')}`
      : ctx.objective;

    let published: WebPublishResult | null;
    try {
      published = await deps.publish(objective);
    } catch (e) {
      observe('publish-failed', { error: String((e as { message?: string })?.message ?? e).slice(0, 120) });
      return { ok: false, summary: `웹 게시 실패: ${String((e as { message?: string })?.message ?? e).slice(0, 120)}`, changes: [] };
    }
    const publishedUrl = published ? validPublishedUrl(published.url) : null;
    if (!publishedUrl) {
      observe('publish-no-url', { objective: objective.slice(0, 80) });
      return { ok: false, summary: '웹 게시 실패: 유효한 게시 URL 산출 없음(content-to-web 출력에서 URL 미검출)', changes: [] };
    }

    // B2 렌더 검증 — CDP 없으면 skip(게시 안 막음).
    let verifyResult: DeployVerifyResult | undefined;
    const observed = await observeDeliverables([{ taskId: publishedUrl, target: publishedUrl }], {
      verify: async (url) => {
        const result = await verify(url);
        verifyResult = { ...result, url };
        return verifyResult;
      },
    });
    const observation = observed.deployFindings.get(publishedUrl);
    const unmeasured = observed.unmeasured;
    const deployFindingObservations = verifyResult?.structuredFindings?.length
      ? [{ target: publishedUrl, findings: verifyResult.structuredFindings }]
      : undefined;
    let verifyNote = '';
    if (unmeasured.some(({ reason }) => reason === 'no-cdp')) verifyNote = ' · 렌더검증 skip(CDP 없음)';
    else if (!verifyResult) verifyNote = ' · 렌더검증 오류(무시)';
    else if (!verifyResult.ok) verifyNote = ` · ⚠️ 렌더 경고: ${verifyResult.findings.join('; ').slice(0, 120)}`;
    else verifyNote = ' · ✅ 렌더 정상';
    observe('verified', {
      url: publishedUrl.slice(0, 80),
      ok: verifyResult?.ok ?? false,
      skipped: verifyResult?.skipped ?? null,
      findings: verifyResult?.findings.length ?? 0,
      deployFindings: observation?.findings ?? [],
      unmeasured: unmeasured.map(({ reason }) => reason),
    });

    observe('published', { url: publishedUrl.slice(0, 80) });
    // ⚠️ changes:[] 필수(published 종결 도달) — HTML 은 워크트리 밖·게시가 성과. A3: 렌더 경고여도 게시는 성공.
    return {
      ok: true,
      summary: `웹 게시: ${published?.detail ?? ''} → ${publishedUrl}${verifyNote}`,
      changes: [],
      outcome: 'published',
      ref: publishedUrl,
      nonCodeEvidence: 'published-url',
      deployFindings: observed.deployFindings,
      ...(deployFindingObservations ? { deployFindingObservations } : {}),
      ...(unmeasured.length ? { unmeasuredDeliverables: unmeasured } : {}),
    };
  };
}

/** production publish — content-to-web 을 isolation 없이 실행(Write 허용)해 게시하고 URL 추출.
 *  ⚠️ 실 vercel 배포(부작용)·A3 게이트 불필요. dev-harness domain='web' 명시 시에만 발동(대표 요청). */
export function defaultWebPublish(): WebDomainDeps['publish'] {
  return async (objective, onProgress) => {
    const { parseSkillMd, executeSkill } = await import('../skills/runner.js');
    const manifest = parseSkillMd('content-to-web');   // ★ withResearchIsolation 미적용 — Write 허용(HTML 생성)
    if (!manifest) { observe('skill-missing', { skill: 'content-to-web' }); return null; }
    let buffered = '';
    const result = await executeSkill(manifest, objective, (delta, full) => { buffered = full; onProgress?.(delta); });
    const output = result.fullResponse || buffered;
    const url = parseVercelUrl(output);
    if (!url) return null;
    return { url, detail: '웹 게시 완료' };
  };
}
