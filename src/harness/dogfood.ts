// Headless dev-harness dogfood adapter. It deliberately delegates lifecycle work
// to RunDevHarness so target routing, shadow staging, gates, diff confirmation,
// backup, and in-place apply retain their existing safety contracts.

import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import type { DaemonToolDispatchCtx } from '../boot/daemon-tools/types.js';
import { debug } from '../debug/log.js';
import type { ConfirmChannel } from '../hitl/confirm.js';
import { CLI_HARNESS_DOGFOOD_ENTRANCE, retiredEntranceNotice } from '../self-dev/entrance-registry.js';
import { dispatchRunDevHarness, type DevHarnessDeps } from '../skills/tools/dev-harness.js';

/** ⛔⭐ 옛 `harness dogfood` 는 ***«문장»***을 받았다(`dogfood <target> <objective...>`).
 *  그런데 `harness ask` 는 ***이미 저작된 골 문서***를 요구한다 ⇒ 안내를 그것 «하나»로 두면
 *  ***문장을 든 사람에게 갈 곳이 없다***(2026-09-02 · 🅣 136차 실측 · 그래서 둘로 갈랐다).
 *  ⭐ 두 문은 «흐름»이 같다 — `runDefaultAskFileLaunchFlow`(`src/index.ts:274`)가
 *  `dev --ask` 와 같은 `runAskLaunchFlow` 를 탄다. 갈리는 것은 ***입력 종류***뿐이다. */
export const HARNESS_DOGFOOD_REPLACEMENT_FROM_SENTENCE = 'monad harness say "<요청>"';
export const HARNESS_DOGFOOD_REPLACEMENT_FROM_GOAL_FILE = 'monad harness ask <골문서>';
/** @deprecated 갈래를 안 가리는 옛 이름. 새 코드는 위 둘 중 «든 것»에 맞는 쪽을 쓴다. */
export const HARNESS_DOGFOOD_REPLACEMENT = HARNESS_DOGFOOD_REPLACEMENT_FROM_GOAL_FILE;
export const HARNESS_DOGFOOD_DEPRECATION_NOTICE = `ℹ️  \`monad harness dogfood\`은 deprecated 입구입니다 — 손에 «무엇이 있나»로 갈립니다:\n`
  + `   • 요청이 «문장»이면(예전 \`dogfood <target> <objective...>\` 처럼) → \`${HARNESS_DOGFOOD_REPLACEMENT_FROM_SENTENCE}\`\n`
  + `   • 골 문서가 «이미 있으면» → \`${HARNESS_DOGFOOD_REPLACEMENT_FROM_GOAL_FILE}\``;

export interface HarnessDogfoodCliRefuse {
  ok: false;
  message: string;
  exitCode: number;
}

/** CLI 입구가 불렸을 때 안내만 내고 옛 디스패치를 타지 않는다. 어댑터 본문(`runHarnessDogfood`)은 그대로 둔다. */
export function refuseHarnessDogfoodCli(opts: {
  onDeprecationNotice?: (notice: string) => void;
} = {}): HarnessDogfoodCliRefuse {
  try {
    const printNotice = opts.onDeprecationNotice ?? ((line: string) => process.stderr.write(`${line}\n`));
    const retirementNotice = retiredEntranceNotice(CLI_HARNESS_DOGFOOD_ENTRANCE);
    if (retirementNotice) printNotice(retirementNotice);
    printNotice(HARNESS_DOGFOOD_DEPRECATION_NOTICE);
  } catch { /* fail-open — guidance print must not swallow the closed entrance */ }
  return { ok: false, message: HARNESS_DOGFOOD_DEPRECATION_NOTICE, exitCode: 1 };
}

export interface HarnessDogfoodOptions {
  objective: string;
  target: string;
  configDir?: string;
  dispatch?: typeof dispatchRunDevHarness;
  deps?: DevHarnessDeps;
}

export interface HarnessDogfoodResult {
  target: string;
  autoDrive: 'on';
  output: string;
  observability: readonly string[];
}

/** ★ 안전 가드(C·2026-07-21) — dogfood 의 auto-approve 채널은 apply-in-place HITL(#25 auto금지
 *  안전벽)을 우회한다. 따라서 target 을 **시스템 temp 하위(throwaway)** 로 제약한다 — 실경로(홈·repo 등)
 *  는 refuse. 실 대상을 개발하려면 CLI 경로를 쓴다; 모델 표면은 기본으로 내려가 있으며
 *  tools.runDevHarness.modelSurface 로 복원할 수 있고, CLI 는 apply HITL 을 유지한다. */
export function assertThrowawayTarget(target: string): void {
  const abs = resolve(target);
  const tmp = resolve(tmpdir());
  if (abs !== tmp && !abs.startsWith(tmp + sep)) {
    throw new Error(
      `harness dogfood: target must be a throwaway path under the system temp dir (${tmp}). ` +
      `The auto-approve channel bypasses the apply-in-place HITL safety, so real paths are refused — ` +
      `for a real target use the CLI path; its model surface is disabled by default and can be restored with ` +
      `tools.runDevHarness.modelSurface, while the CLI keeps the HITL diff confirmation.`,
    );
  }
}

/** Explicit dogfood-only HITL channel: the caller intentionally requests a fully
 * headless run, while the underlying membrane still owns every confirmation gate. */
export function autoApproveConfirmChannel(): ConfirmChannel {
  return {
    name: 'harness-dogfood-auto-approve',
    async request() { return true; },
    cancel() {},
  };
}

export async function runHarnessDogfood(opts: HarnessDogfoodOptions): Promise<HarnessDogfoodResult> {
  const objective = opts.objective.trim();
  const target = opts.target.trim();
  if (!objective) throw new Error('harness dogfood: objective required');
  if (!target) throw new Error('harness dogfood: target required');
  assertThrowawayTarget(target);   // ★ C — auto-approve 우회 위험 → throwaway temp 타겟만 허용.

  const observability = ['harness.target:dogfood.start', 'harness.target:dogfood.done'] as const;
  debug.log('harness.target', 'dogfood.start', { target: target.slice(-96), autoDrive: 'on', configDir: opts.configDir ?? null });
  const ctx = { surfaceHitlChannels: [autoApproveConfirmChannel()] } as unknown as DaemonToolDispatchCtx;
  const dispatch = opts.dispatch ?? dispatchRunDevHarness;
  const result = await dispatch(
    { objective, target, auto_drive: 'on' },
    ctx,
    opts.deps,
  );
  debug.log('harness.target', 'dogfood.done', { target: target.slice(-96), autoDrive: 'on', output: result.output.slice(0, 240) });
  return { target, autoDrive: 'on', output: result.output, observability };
}

function tableCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

export function formatHarnessDogfoodReport(result: HarnessDogfoodResult): string {
  return [
    '| field | result |',
    '| --- | --- |',
    `| target | ${tableCell(result.target)} |`,
    `| auto_drive | ${result.autoDrive} |`,
    `| lifecycle | ${tableCell(result.output)} |`,
    `| harness.target observability | ${result.observability.map(tableCell).join('<br>')} |`,
  ].join('\n');
}
