#!/usr/bin/env bun
// ── 야간 DocOps 실행 entry (미션 668871 arc4 · 2026-07-14) ──────────────────────
//
// runNightlyDocOpsCycle 를 실 조각(scanDocs·lintDocLinks·wiki-claim·doc-curate 큐)에 배선한 야간
// 실행 진입점. arc2(의미 supersede) descoped 라 외부 검색/Ollama 챗 없이 **결정론 조각만**으로 성립
// (미션 불변식: 클라우드 LLM 0·로컬 전용·비파괴·HITL 큐). cron 이 이 스크립트를 야간 호출한다.
//   bun scripts/nightly-docops.ts            # 1 사이클 실행(제안 큐 기록·자동 적용 없음)
//   ELANOUS_GROUNDING… 무관 · 산출 = ~/.elanous/doc-curation/PROPOSAL-wiki-*.json (HITL 승인 대기)

import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getLocalLLMUrl } from '../src/config.js';
import { scanDocs } from '../src/autopilot/discovery/doc-inventory.js';
import { createGitHubIssueCommentFetchStatus, lintDocLinks, lintGitHubIssueCommentPointers } from '../src/autopilot/discovery/doc-lint.js';
import { proposeWikiClaimsFromHandoff, type Claim } from '../src/autopilot/discovery/wiki-claim-proposer.js';
import { runNightlyDocOpsCycle, assertLoopbackModelUrl } from '../src/autopilot/discovery/nightly-docops-runner.js';
import { assessDocsStaleness, defaultStalenessRevisions } from '../src/autopilot/discovery/doc-staleness.js';
import { debug } from '../src/debug/log.js';
import { registerStandaloneLogSink } from '../src/domains/standalone-log-sink.js';
import {
  buildTopicClusterPairs, proposeSemanticSupersede, buildSemanticSupersedeProposal, type ClusterDoc, type DocRef,
} from '../src/autopilot/discovery/semantic-supersede.js';

const repoRoot = join(import.meta.dir, '..');
const docsDir = join(repoRoot, 'docs');
const outDir = join(homedir(), '.elanous', 'doc-curation');
const ckDir = join(outDir, 'checkpoints');
const nowDate = new Date().toLocaleDateString('sv-SE');
const nowIso = new Date().toISOString();

const fileExists = (rel: string): boolean => existsSync(join(repoRoot, rel));
const readText = (rel: string): string | null => { try { return readFileSync(join(repoRoot, rel), 'utf-8'); } catch { return null; } };

const vaultDocs = scanDocs(docsDir);
const vaultFiles = vaultDocs.map((entry) => entry.path);
// findWikiPage — 결정론 topic 매칭(내부 문서 `WIKI-*` 중 claim 주제어 겹침 최다). 외부 검색 없음.
const wikiPages = vaultDocs.filter((e) => e.prefix === 'WIKI');
const findWikiPage = (claim: Claim): string | null => {
  const kw = (claim.text.toLowerCase().match(/[a-z0-9]{4,}|[가-힣]{2,}/g) ?? []).slice(0, 6);
  let best: string | null = null;
  let bestHit = 0;
  for (const w of wikiPages) {
    const hit = kw.filter((k) => w.topic.includes(k) || w.filename.toLowerCase().includes(k)).length;
    if (hit > bestHit) { bestHit = hit; best = w.path; }
  }
  return bestHit >= 1 ? best : null;
};

const githubHeaders: Record<string, string> = { Accept: 'application/vnd.github+json' };
if (process.env.GITHUB_TOKEN) githubHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
const issueCommentFetchStatus = createGitHubIssueCommentFetchStatus(fetch, githubHeaders);

export function formatNightlyDocOpsCompletion(metrics: Awaited<ReturnType<typeof runNightlyDocOpsCycle>>): string {
  const stalenessLine = metrics.staleness?.status === 'measured'
    ? `늙음 검사 ${metrics.staleness.checked}·사라진 식별자 ${metrics.staleness.byAxis.removedIdentifiers}·깨진 링크 ${metrics.staleness.byAxis.brokenLinks}·superseded ${metrics.staleness.byAxis.supersededMarked}·staleScore ${metrics.staleness.byAxis.staleScoreOverThreshold}·문서목록 ${metrics.staleness.removedIdentifierDocuments.length}${metrics.staleness.removedIdentifierDocumentsTruncated ? '+' : ''}`
    : metrics.staleness?.status === 'failed'
      ? `늙음 측정 실패(${metrics.staleness.error})`
      : '늙음 측정 미지정';
  return `[nightly-docops] 완료 — 처리 ${metrics.processed}·후보 ${metrics.candidates}·제안 ${metrics.proposals}·억제 ${metrics.suppressed}·에러 ${metrics.errors}·${stalenessLine}·${metrics.durationMs}ms → ${outDir} (HITL 승인 대기)`;
}

/**
 * ⛔⭐⭐⭐ **배선을 «주입 가능»하게 뽑는다**(리뷰 must-fix · Goodhart 제거).
 *   종전 테스트는 진입점 «소스 문자열»에 `assessDocsStaleness` 가 있나만 봤다 —
 *   ***주석에 있어도, 안 불려도 통과***한다. 그게 이 저장소가 오늘 네 번 밟은 「자가 흐리다」의 한 얼굴이다.
 *   ⇒ 그래서 실제 호출을 «실행»으로 물 수 있게 인자로 뺀다. 기본값은 실물이라 운영 경로는 그대로다.
 */
export function buildStalenessStage(
  root: string,
  deps: {
    assess?: typeof assessDocsStaleness;
    revisions?: typeof defaultStalenessRevisions;
  } = {},
) {
  const assess = deps.assess ?? assessDocsStaleness;
  const revisions = deps.revisions ?? defaultStalenessRevisions;
  return () => {
    const summary = assess(root, revisions(root));
    return {
      checked: summary.checked,
      byAxis: summary.byAxis,
      // ⛔⭐⭐⭐ **여기서 «자르지 않는다»** — 자르는 것은 runner 의 일이다(2026-08-12 실측 회귀로 배웠다).
      //   초판에서 내가 `.slice(0, 20)` 을 여기 넣었더니 runner 의
      //     `removedIdentifierDocumentsTruncated: staleness.removedIdentifierDocuments.length > 상한`
      //   비교가 «항상 거짓»이 됐고, 목록 20개 · 실제 48편인데 ***`truncated: false`***가 나왔다.
      //   ⇒ 📌 ***절단을 «미리» 하면 절단을 «알릴 수» 없다.*** 「잘린 것을 안 잘린 것처럼」의 실물이다.
      //   ✅ 전량을 넘기고 상한·표시는 runner 한 곳에서만 정한다.
      removedIdentifierDocuments: summary.documents
        .filter((document) => document.removedIdentifiers.length > 0)
        .map((document) => document.path),
    };
  };
}

/**
 * ⛔ 「없음」을 「측정됨」으로 «접지 않는다»(리뷰 should-fix) — 셋은 서로 다른 사실이다.
 *   종전엔 `status === 'failed' ? failed : measured` 라 ***단계를 안 넘긴 경우도 `measured`*** 였다.
 */
export function stalenessEventName(staleness: { status: string } | undefined): string {
  if (!staleness) return 'staleness-skipped';
  return staleness.status === 'failed' ? 'staleness-failed' : 'staleness-measured';
}

if (import.meta.main) {
await registerStandaloneLogSink('scheduler');
mkdirSync(ckDir, { recursive: true });
const metrics = await runNightlyDocOpsCycle({
  // ★ 로컬 전용 가드(fail-closed) — 로컬 모델 URL 이 loopback 아니면 사이클 자체 중단.
  assertLocalOnly: () => assertLoopbackModelUrl(getLocalLLMUrl()),
  // 배치 — 오래된 handoff/recap 부터(생존 지식 추출 대상).
  selectBatch: (limit) => vaultDocs
    .filter((e) => (e.prefix === 'HANDOFF' || e.prefix === 'RECAP') && e.date)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    .slice(0, limit).map((e) => ({ path: e.path })),
  // ① docs-lint 링크·anchor·GitHub issuecomment 포인터 정합 → finding 수.
  lintStage: async (item) => {
    const t = readText(item.path);
    if (!t) return 0;
    const linkWarnings = lintDocLinks(item.path, t, { fileExists, readText, vaultFiles });
    const issueCommentWarnings = await lintGitHubIssueCommentPointers(item.path, t, {
      repository: { owner: 'ElanvitalAI', repo: 'monad-agent' },
      fetchStatus: issueCommentFetchStatus,
    });
    // ⛔⭐ **분류와 대상을 보존해 찍는다**(리뷰 2R should-fix) — 숫자만 합산하면 운영자가
    //    *"어느 포인터가 진짜 404 인가"* 를 야간 산출에서 **알 수 없다**(= 관측이 없는 것과 같다).
    // ⛔⭐ **canonical 분류를 그대로 보존한다**(리뷰 3R must-fix) — `mismatched` 와 `unverifiable` 을
    //    *"확인 불가"* 로 합치면 운영자가 **다른 사실 둘**을 같은 것으로 읽는다.
    for (const w of issueCommentWarnings) {
      const label = w.rule === 'missing-issuecomment' ? '⛔ missing'
        : w.rule === 'mismatched-issuecomment' ? '⚠️ mismatched'
        : '⚠️ unverifiable';
      console.log(`[nightly-docops] ${label} ${w.file} → ${w.target}`);
    }
    return linkWarnings.length + issueCommentWarnings.length;
  },
  // ②③ claim 추출 + WIKI 대상 선택(결정론) → proposal.
  proposeStage: (item) => {
    const t = readText(item.path);
    if (!t) return null;
    const p = proposeWikiClaimsFromHandoff(t, item.path, { findWikiPage, readWikiPage: readText }, { nowIso, nowDate });
    return p.items.length ? p : null;
  },
  // ④ doc-curate 큐 기록(파일 존재 = 멱등 억제). 자동 적용 없음(HITL).
  recordStage: (p) => {
    const jsonPath = join(outDir, `PROPOSAL-wiki-${nowDate}-${p.idempotencyKey.slice(0, 8)}.json`);
    if (existsSync(jsonPath)) return { suppressed: true };
    writeFileSync(jsonPath, JSON.stringify(p, null, 2));
    return { suppressed: false };
  },
  checkpoint: (item, ok) => { try { appendFileSync(join(ckDir, `${nowDate}.log`), `${item.path}\t${ok ? 'ok' : 'err'}\n`); } catch { /* fail-soft */ } },
  stalenessStage: () => buildStalenessStage(repoRoot)(),
  emitMetrics: (m) => {
    debug.log('autopilot.discovery.nightly-docops', stalenessEventName(m.staleness), { staleness: m.staleness });
    console.log('[nightly-docops] metrics', JSON.stringify(m));
  },
}, { batchLimit: 15, maxRetryPerItem: 1 });

console.log(formatNightlyDocOpsCompletion(metrics));
}

// ── arc2 되살리기 · 의미 supersede 계층 (gemma-4 · 제목/토픽 클러스터 bounded · 미션 668871) ──
//
// runner 의 proposeStage 는 동기·per-item 이라, 문서 쌍 교차 + async gemma 판정은 여기 별도 패스로 붙인다
// (런너/결정론 사이클 무접촉 — 미션 불변식: 새 엔진 없이 기존 조각 재사용). 같은 doc-curate 큐로 흘려보냄.
// 로컬 챗(gemma-4) 없으면 judgeSupersedeRelation 이 no_match 로 graceful 스킵 → 제안 0(비파괴·fail-soft).
type SemanticProposal = ReturnType<typeof buildSemanticSupersedeProposal>;

export interface SemanticQueueDeps {
  readDir: (path: string) => string[];
  readFile: (path: string) => string;
  exists: (path: string) => boolean;
  writeExclusive: (path: string, content: string) => void;
  log: (message: string) => void;
}

const semanticQueueDeps: SemanticQueueDeps = {
  readDir: readdirSync,
  readFile: (path) => readFileSync(path, 'utf-8'),
  exists: existsSync,
  writeExclusive: (path, content) => writeFileSync(path, content, { flag: 'wx' }),
  log: console.log,
};

/** 날짜가 달라도 semantic proposal의 안정 키가 이미 큐에 있으면 재기록하지 않는다. */
export function recordSemanticProposal(
  proposal: SemanticProposal,
  jsonPath: string,
  outDir: string,
  deps: SemanticQueueDeps = semanticQueueDeps,
): { suppressed: boolean; existingFile?: string; queueReadFailed: boolean } {
  let existingFile: string | undefined;
  let queueReadFailed = false;
  let unreadableCandidates = 0;
  let directoryReadFailed = false;
  try {
    for (const filename of deps.readDir(outDir)) {
      if (!/^PROPOSAL-semantic-.*\.json$/.test(filename)) continue;
      try {
        const candidate = JSON.parse(deps.readFile(join(outDir, filename))) as { idempotencyKey?: unknown };
        if (candidate.idempotencyKey === proposal.idempotencyKey) {
          existingFile = filename;
          break;
        }
      } catch (error) {
        queueReadFailed = true;
        unreadableCandidates += 1;
        deps.log(`[nightly-docops] semantic — 큐 후보 읽기 실패 key=${proposal.idempotencyKey} candidate=${filename}: ${error instanceof Error ? error.message.slice(0, 100) : ''}`);
      }
    }
  } catch (error) {
    queueReadFailed = true;
    directoryReadFailed = true;
    deps.log(`[nightly-docops] semantic — 큐 읽기 실패 key=${proposal.idempotencyKey}: ${error instanceof Error ? error.message.slice(0, 100) : ''}`);
  }
  if (existingFile) {
    deps.log(`[nightly-docops] semantic — 멱등 억제 key=${proposal.idempotencyKey} existing=${existingFile}`);
    return { suppressed: true, existingFile, queueReadFailed };
  }
  if (directoryReadFailed) {
    try {
      if (deps.exists(jsonPath)) {
        const filename = jsonPath.split('/').pop() ?? jsonPath;
        deps.log(`[nightly-docops] semantic — 큐 읽기 실패·기존 대상 억제 key=${proposal.idempotencyKey} existing=${filename}`);
        return { suppressed: true, existingFile: filename, queueReadFailed };
      }
    } catch (error) {
      deps.log(`[nightly-docops] semantic — 대상 존재 확인 실패·기록 억제 key=${proposal.idempotencyKey}: ${error instanceof Error ? error.message.slice(0, 100) : ''}`);
      return { suppressed: true, queueReadFailed };
    }
  }
  try {
    deps.writeExclusive(jsonPath, JSON.stringify(proposal, null, 2));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      const filename = jsonPath.split('/').pop() ?? jsonPath;
      deps.log(`[nightly-docops] semantic — 배타 기록 충돌·기존 대상 억제 key=${proposal.idempotencyKey} existing=${filename}`);
      return { suppressed: true, existingFile: filename, queueReadFailed };
    }
    throw error;
  }
  if (unreadableCandidates > 0) {
    deps.log(`[nightly-docops] semantic — 큐 후보 ${unreadableCandidates}개 읽기 실패에도 기록 key=${proposal.idempotencyKey}`);
  } else {
    deps.log(`[nightly-docops] semantic — 큐 기록 key=${proposal.idempotencyKey}`);
  }
  return { suppressed: false, queueReadFailed };
}

async function runSemanticSupersedePass(): Promise<void> {
  try {
    assertLoopbackModelUrl(getLocalLLMUrl()); // 로컬 전용 사전 가드(fail-closed) — 위반이면 패스 자체 스킵
    const allDocs = scanDocs(docsDir).filter((e) => !e.path.includes('/_archive/'));
    const { pairs, truncated } = buildTopicClusterPairs(allDocs, { maxPairs: 40, minSharedTokens: 2 });
    if (!pairs.length) { console.log('[nightly-docops] semantic — 클러스터 후보 쌍 0(스킵)'); return; }
    if (truncated > 0) console.log(`[nightly-docops] semantic — 후보 캡 ${pairs.length}쌍 처리·${truncated}쌍 초과 절단(다음 사이클)`);
    const toDocRef = (e: ClusterDoc): DocRef => {
      const body = readText(e.path) ?? '';
      return { path: e.path, title: e.topic || e.filename, excerpt: body.slice(0, 1500), ...(e.date ? { date: e.date } : {}) };
    };
    const items = await proposeSemanticSupersede(pairs.map(({ a, b }) => ({ a: toDocRef(a), b: toDocRef(b) })));
    if (!items.length) { console.log(`[nightly-docops] semantic — ${pairs.length}쌍 판정·supersede/duplicate/contradicts 0(제안 없음)`); return; }
    const proposal = buildSemanticSupersedeProposal(items, { nowIso, scanned: pairs.length });
    const jsonPath = join(outDir, `PROPOSAL-semantic-${nowDate}-${proposal.idempotencyKey.slice(0, 8)}.json`);
    const record = recordSemanticProposal(proposal, jsonPath, outDir);
    if (record.suppressed) return;
    console.log(`[nightly-docops] semantic supersede — ${pairs.length}쌍 판정 → 제안 ${items.length}건 큐 기록 (HITL 승인 대기)`);
  } catch (e) {
    console.log(`[nightly-docops] semantic — 패스 스킵(fail-soft): ${e instanceof Error ? e.message.slice(0, 100) : ''}`);
  }
}

if (import.meta.main) await runSemanticSupersedePass();
