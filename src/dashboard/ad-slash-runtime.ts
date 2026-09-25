import { readFileSync } from 'node:fs';

import { classifyIntake } from '../ad-pipeline/intake.js';
import type { AdMode } from '../ad-pipeline/mode.js';
import type { StepReadiness } from '../ad-pipeline/production.js';
import type { QcResult } from '../ad-pipeline/qc.js';
import type { SurveyResult } from '../ad-pipeline/survey.js';
import { buildShootPlan } from '../ad-pipeline/shoot-plan.js';
import { COLLECT_SNIPPET } from '../product-grounding/collect.js';
import {
  createAdPipelineDeps,
  createAdPipelinePlan,
  parseGroundingFacts,
  runAdPipeline,
  type AdGate,
  type AdPipelinePlan,
  type AdProductionDeps,
} from '../ad-pipeline/run.js';

export interface DashboardAdApprovalContext {
  readonly candidateId?: string;
  readonly candidateLabel?: string;
  readonly candidateReason?: string;
}

export interface DashboardAdSlashRuntimeDeps {
  readonly approve?: (gate: AdGate, plan: AdPipelinePlan, context?: DashboardAdApprovalContext) => boolean | Promise<boolean>;
  readonly report: (line: string) => void;
  readonly muted: (text: string) => string;
  readonly warning: (text: string) => string;
  /** Production selected for a specific /ad invocation's explicit spending intent. */
  readonly productionForSpend?: (allowSpend: boolean) => AdProductionDeps | undefined;
  readonly production?: AdProductionDeps;
  /** Setup failures are surfaced by /ad after approval rather than preventing dashboard boot. */
  readonly outputSetupError?: string;
  /** Caller-produced inputs that keep this run from producing a master output. */
  readonly missingProductionInputs?: readonly string[];
  /** Runs the browser-side grounding snippet for a sales URL and returns its raw DOM measurements. */
  readonly collectGroundingFacts?: (url: string, snippet: typeof COLLECT_SNIPPET) => Promise<unknown>;
}

export interface DashboardAdSlashRuntime {
  run(args: string[]): Promise<void>;
}

/** ⛔ 「사유가 없다」와 「사유가 빈 문자열이다」를 같은 값으로 접지 않는다 —
 *  `?? ` 는 null·undefined 만 잡고 `''`·공백은 «그대로 통과»시켜 `—  —` 가 화면에 남는다. */
function qcReason(reason: string | undefined): string {
  return reason?.trim() ? reason.trim() : '사유 없음';
}

export function reportAdQc(result: QcResult | undefined, report: (line: string) => void, muted: (text: string) => string): void {
  if (!result) {
    report(muted('  ⚪ QC 를 「돌리지 않았다」'));
    return;
  }

  report(muted(`  /ad QC verdict: ${result.verdict}  (기계: ${result.automatedVerdict} · 사람 대기: ${result.manualReviewPending.length}축)`));
  for (const finding of result.findings) {
    if (finding.verdict === 'ok' || result.manualReviewPending.includes(finding.name)) continue;
    if (finding.verdict === 'unmeasured') {
      report(muted(`  ⚪ 못 쟀다: ${finding.name} — ${qcReason(finding.reason)} — 「없다」가 «아니다»`));
    } else {
      report(muted(`  /ad QC ${finding.verdict}: ${finding.name}`));
    }
  }
  if (result.captioned) {
    for (const finding of result.captioned.findings) {
      if (finding.verdict === 'ok') continue;
      if (finding.verdict === 'unmeasured') {
        report(muted(`  ⚪ 못 쟀다 (자막본): ${finding.name} — ${qcReason(finding.reason)} — 「없다」가 «아니다»`));
      } else {
        report(muted(`  /ad QC (자막본) ${finding.verdict}: ${finding.name}`));
      }
    }
  }
  if (result.manualReviewPending.length > 0) report(muted(`  👤 사람 검토 대기: ${result.manualReviewPending.join(', ')}`));
}

function reportAdReasons(
  result: Extract<Awaited<ReturnType<typeof runAdPipeline>>, { readonly status: 'gates-approved' }>,
  report: (line: string) => void,
  muted: (text: string) => string,
): void {
  const plan = result.plan;
  if (!plan) return;
  if (plan.disclosure) report(muted(`  /ad disclosure: ${plan.disclosure.text}`));
  if (plan.sceneWarnings?.length) report(muted(`  /ad scene warnings: ${plan.sceneWarnings.join(' · ')}`));
  const copyProvenance = plan.concept?.copyProvenance;
  if (copyProvenance) {
    const verbatimLines = copyProvenance.lines.filter((line) => line.verbatim).length;
    const longestSharedRun = Math.max(0, ...copyProvenance.lines.map((line) => line.longestSharedRun));
    report(muted(`  /ad copy provenance: ${copyProvenance.sourceId} · 원문 그대로 ${verbatimLines}/${copyProvenance.lines.length}줄 (가장 긴 공유 ${longestSharedRun}자)`));
  }
  if (plan.shotParse) report(muted(`  /ad shot parse: ${plan.shotParse.formatMismatch ?? plan.shotParse.missing.join(', ')}`));
  for (const unpriced of result.unpriced ?? []) {
    report(muted(`  /ad shooting skipped: Beat ${unpriced.beatIndex + 1} — ${unpriced.reason}`));
  }
  if (result.captionBlocked?.length) report(muted(`  /ad captions blocked: ${result.captionBlocked.join(', ')}`));
  if (plan.masterAudioReason) report(muted(`  /ad master audio: ${plan.masterAudioReason}`));
  for (const asset of result.shootAssets ?? []) {
    if (asset.limitedBy) report(muted(`  /ad shooting limited by: ${asset.limitedBy}`));
  }
}

function totalEstimatedCredits(production: AdProductionDeps | undefined): number | undefined {
  const scene = production?.assembly?.scene;
  if (!scene || !production?.durationRules || !production.creditsPerSecond) return undefined;
  return buildShootPlan(scene, {
    mode: 'medium',
    durationRules: production.durationRules,
    creditsPerSecond: production.creditsPerSecond,
    referenceAssets: production.referenceAssets,
    referenceDelivery: production.referenceDelivery,
  }).totalEstimatedCredits;
}

const PRODUCT_NAME_NOISE = /^(?:(?:(?:배송|교환|반품)[/·,\s]*)+(?:안내|정보|상세)?|(?:상품|제품)?\s*(?:안내|정보|상세|품번|문의|리뷰))$/;

function cleanedProductName(value: string): string | undefined {
  const name = value
    .replace(/\s*[|｜].*$/, '')
    .replace(/\s*[-–—]\s*(사이즈\s*&\s*후기|후기|상품\s*상세).*$/i, '')
    .trim();
  return name && !PRODUCT_NAME_NOISE.test(name) && !/^https?:/i.test(name) ? name : undefined;
}

function productNameFromGrounding(facts: Extract<ReturnType<typeof parseGroundingFacts>, { ok: true }>['facts']): string | undefined {
  return cleanedProductName(facts.title)
    ?? facts.nameCandidates.map(cleanedProductName).find((candidate): candidate is string => candidate !== undefined);
}

export function createDashboardAdSlashRuntime(
  deps: DashboardAdSlashRuntimeDeps,
): DashboardAdSlashRuntime {
  return {
    async run(args): Promise<void> {
      const allowSpend = args.includes('--spend');
      const modeIndexes = args.flatMap((arg, index) => arg === '--mode' ? [index] : []);
      const modeValue = modeIndexes.length === 1 ? args[modeIndexes[0]! + 1]?.trim() : undefined;
      if (modeIndexes.length > 1 || (modeIndexes.length === 1 && modeValue !== 'quick' && modeValue !== 'medium' && modeValue !== 'quality')) {
        deps.report(deps.warning('  Cannot run /ad: --mode must be one of quick, medium, quality.'));
        return;
      }
      const mode = modeValue as AdMode | undefined;
      const modeIndex = modeIndexes[0] ?? -1;
      const categoryIndexes = args.flatMap((arg, index) => arg === '--category' ? [index] : []);
      if (categoryIndexes.length > 1) {
        deps.report(deps.warning('  Cannot run /ad: --category may be specified only once.'));
        return;
      }
      const categoryIndex = categoryIndexes[0] ?? -1;
      const categoryValue = categoryIndex >= 0 ? args[categoryIndex + 1]?.trim() : undefined;
      if (categoryIndex >= 0 && (!categoryValue || categoryValue.startsWith('--'))) {
        deps.report(deps.warning('  Cannot run /ad: --category requires a non-option value.'));
        return;
      }
      const category = categoryValue;
      const factsIndexes = args.flatMap((arg, index) => arg === '--facts' ? [index] : []);
      if (factsIndexes.length > 1) {
        deps.report(deps.warning('  Cannot run /ad: --facts may be specified only once.'));
        return;
      }
      const factsIndex = factsIndexes[0] ?? -1;
      const factsPath = factsIndex >= 0 ? args[factsIndex + 1]?.trim() : undefined;
      if (factsIndex >= 0 && (!factsPath || factsPath.startsWith('--'))) {
        deps.report(deps.warning('  Cannot run /ad: --facts requires a non-option value.'));
        return;
      }
      const shotsIndexes = args.flatMap((arg, index) => arg === '--shots' ? [index] : []);
      if (shotsIndexes.length > 1) {
        deps.report(deps.warning('  Cannot run /ad: --shots may be specified only once.'));
        return;
      }
      const shotsIndex = shotsIndexes[0] ?? -1;
      const shotsPath = shotsIndex >= 0 ? args[shotsIndex + 1]?.trim() : undefined;
      if (shotsIndex >= 0 && (!shotsPath || shotsPath.startsWith('--'))) {
        deps.report(deps.warning('  Cannot run /ad: --shots requires a non-option value.'));
        return;
      }
      const voiceIndexes = args.flatMap((arg, index) => arg === '--voice' ? [index] : []);
      if (voiceIndexes.length > 1) {
        deps.report(deps.warning('  Cannot run /ad: --voice may be specified only once.'));
        return;
      }
      const voiceIndex = voiceIndexes[0] ?? -1;
      const voiceId = voiceIndex >= 0 ? args[voiceIndex + 1]?.trim() : undefined;
      if (voiceIndex >= 0 && (!voiceId || voiceId.startsWith('--'))) {
        deps.report(deps.warning('  Cannot run /ad: --voice requires a non-option value.'));
        return;
      }
      if (!category && (shotsPath || voiceId)) {
        deps.report(deps.warning('  Cannot run /ad: --shots and --voice require --category.'));
        return;
      }
      let shotMarkdown: string | undefined;
      if (shotsPath) {
        try {
          shotMarkdown = readFileSync(shotsPath, 'utf8');
        } catch (error) {
          deps.report(deps.warning(`  Cannot run /ad: 샷 마크다운을 못 읽었다: ${(error as Error).message}`));
          return;
        }
      }
      const intakeArgs = args.filter((arg, index) => arg !== '--spend'
        && (modeIndex < 0 || (index !== modeIndex && index !== modeIndex + 1))
        && (categoryIndex < 0 || (index !== categoryIndex && index !== categoryIndex + 1))
        && (factsIndex < 0 || (index !== factsIndex && index !== factsIndex + 1))
        && (shotsIndex < 0 || (index !== shotsIndex && index !== shotsIndex + 1))
        && (voiceIndex < 0 || (index !== voiceIndex && index !== voiceIndex + 1)));
      const production = deps.productionForSpend
        ? deps.productionForSpend(allowSpend)
        : deps.production;
      const classified = classifyIntake({ values: intakeArgs });
      if (!classified.ok) {
        deps.report(deps.warning(`  Cannot run /ad: ${classified.message}`));
        return;
      }
      let facts: Extract<ReturnType<typeof parseGroundingFacts>, { ok: true }>['facts'] | undefined;
      if (factsPath) {
        if (classified.intake.kind !== 'url') {
          deps.report(deps.warning('  Cannot run /ad: --facts 는 판매 URL 갈래에서만 쓴다.'));
          return;
        }
        let raw: unknown;
        try {
          raw = JSON.parse(readFileSync(factsPath, 'utf8'));
        } catch (error) {
          deps.report(deps.warning(`  Cannot run /ad: 접지 사실 JSON 을 못 읽었다: ${(error as Error).message}`));
          return;
        }
        const checked = parseGroundingFacts(raw, classified.intake.url);
        if (!checked.ok) {
          deps.report(deps.warning(`  Cannot run /ad: ${checked.reason}`));
          return;
        }
        facts = checked.facts;
      } else if (classified.intake.kind === 'url' && deps.collectGroundingFacts) {
        try {
          const checked = parseGroundingFacts(
            await deps.collectGroundingFacts(classified.intake.url, COLLECT_SNIPPET),
            classified.intake.url,
          );
          if (!checked.ok) {
            deps.report(deps.warning(`  Cannot run /ad: ${checked.reason}`));
            return;
          }
          facts = checked.facts;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          deps.report(deps.warning(`  Cannot run /ad: 접지 사실을 수집하지 못했다: ${reason}`));
          return;
        }
      }

      const productionWithGround = facts ? { ...production, ground: facts } : production;

      if (!allowSpend && deps.productionForSpend) {
        const estimate = totalEstimatedCredits(productionWithGround);
        deps.report(deps.warning(`  ⚠️ /ad: spending is closed for this run${estimate === undefined ? '' : ` — estimated ${estimate} credits`}; add --spend to enable it.`));
      }

      if (deps.missingProductionInputs?.length) {
        deps.report(deps.warning(
          `  ⚠️ /ad: this run cannot produce a master — ${deps.missingProductionInputs.length} missing inputs: ${deps.missingProductionInputs.join(', ')}`,
        ));
      }

      if (!deps.approve) {
        const plan = createAdPipelinePlan(classified.intake, { production: productionWithGround, mode, hasGroundingFacts: facts !== undefined });
        deps.report(deps.muted(`  /ad plan only: ${JSON.stringify(plan)}`));
        deps.report(deps.warning('  /ad execution was not started because the approval UI is unavailable.'));
        return;
      }

      const approve = deps.approve;
      const groundedProductName = facts ? productNameFromGrounding(facts) : undefined;
      const brand = groundedProductName ?? (classified.intake.kind === 'url' ? classified.intake.url : classified.intake.brief);
      const front = category
        ? await (async () => {
          const { createOmniCrawlSurveyCollector } = await import('../ad-pipeline/survey.js');
          const { createDefaultConceptGenerator } = await import('../ad-pipeline/concept.js');
          return {
            frontStage: {
              survey: { category, ...(brand ? { brand } : {}) },
              ...(facts ? { skuGrounding: { specRows: facts.specRows } } : {}),
              ...(shotMarkdown !== undefined ? { shotMarkdown } : {}),
              ...(voiceId ? { voiceId } : {}),
            },
            collectSurvey: createOmniCrawlSurveyCollector(),
            selectSurveyCandidate: async (survey: SurveyResult) => {
              deps.report(deps.muted(`  조사 후보: ${JSON.stringify(survey.candidates)}`));
              const selectionPlan = createAdPipelinePlan(classified.intake, { production: productionWithGround, mode, frontRequested: true, hasGroundingFacts: facts !== undefined });
              for (const candidate of survey.candidates) {
                deps.report(deps.muted(`  조사 후보 선택: ${JSON.stringify(candidate)}`));
                if (await approve('CONCEPT_OK', selectionPlan, {
                  candidateId: candidate.id,
                  candidateLabel: candidate.label,
                  candidateReason: candidate.reason,
                })) return candidate.id;
              }
              throw new Error('Survey candidate selection rejected at CONCEPT_OK.');
            },
            generateConcept: createDefaultConceptGenerator(),
          };
        })()
        : {};
      const result = await runAdPipeline(classified.intake, createAdPipelineDeps({
        ask: deps.approve,
        report: (line) => { deps.report(deps.muted(`  ${line}`)); },
        production: productionWithGround,
        mode,
        outputSetupError: deps.outputSetupError,
        ...(facts ? { collectPageFacts: () => facts } : {}),
        ...front,
      }));
      if (result.status === 'rejected') {
        deps.report(deps.warning(`  /ad stopped: approval rejected at ${result.stoppedGate}.`));
      } else if (result.status === 'blocked') {
        deps.report(deps.warning(`  /ad blocked: ${result.reason}`));
      } else if (result.masterPath) {
        deps.report(deps.muted(`  /ad production completed: ${result.masterPath}`));
        if (result.safezonePath) {
          deps.report(deps.muted(`  /ad safezone frame: ${result.safezonePath} — 위·아래·오른쪽 띠가 가리는 영역을 확인하세요.`));
        }
        reportAdReasons(result, deps.report, deps.muted);
      } else {
        reportAdReasons(result, deps.report, deps.muted);
        const readiness = (result as { readonly productionReadiness?: readonly StepReadiness[] }).productionReadiness;
        if (!readiness) {
          deps.report(deps.warning(`  /ad production incomplete: ${result.unwiredProduction.join(', ') || 'no master output'}.`));
        } else {
          const needsInput = readiness.filter((step) => step.status === 'needs-input');
          const unwired = readiness.filter((step) => step.status === 'unwired');
          if (needsInput.length) {
            deps.report(deps.warning(`  /ad production incomplete: ${needsInput.map((step) => `${step.step} (${step.missing})`).join(', ')}.`));
          }
          if (unwired.length) {
            deps.report(deps.muted(`  /ad production not yet implemented: ${unwired.map((step) => step.step).join(', ')}.`));
          }
        }
      }
      reportAdQc(result.status === 'gates-approved' ? result.qc : undefined, deps.report, deps.muted);
    },
  };
}
