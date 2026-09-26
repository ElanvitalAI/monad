// src/cli/autopilot-run.ts
//
// ROADMAP-ipad-companion-autopilot-priority §D1.3 — CLI entry for the
// autopilot loop driver. Headless mission runner used for dogfood +
// future TestFlight-equivalent verification of D1.1–D1.2 substrate.
//
// Usage (registered in src/index.ts):
//   elanous autopilot run "<mission>" [--backend claude] [--max-iterations 8]
//     [--max-wallclock-ms 300000] [--max-output-chars 200000] [--cwd .]
//     [--verbose]
//
// Output:
//   stdout — agent text deltas (concatenated, no framing).
//   stderr — envelope events (one JSON per line) + termination summary.
//   exit code:
//     0 — termination.kind === 'success'
//     1 — anything else (budget · stuck · cancelled · risky · error)

import { AcpAgent, type AcpAgentOpts } from '../acp/client.js';
import { AcpAgentManager } from '../acp/agent-manager.js';
import { DEFAULT_REVIEW_BACKEND } from '../agent-substrate/acp-reviewer.js';
import { AutopilotLoopDriver, type AutopilotResult } from '../autopilot/agent-loop.js';
import { AcpTurnRunner } from '../autopilot/runner.js';
import { heuristicPlanConfig } from '../autopilot/planner.js';
import type { FeedbackEnvelope } from '../feedback/envelope.js';

export interface AutopilotRunOptions {
  mission: string;
  backend?: string;
  maxIterations?: number;
  maxWallClockMs?: number;
  maxOutputChars?: number;
  cwd?: string;
  /** When true, every envelope is mirrored to stderr (one JSON per line). */
  verbose?: boolean;
  /** Test-only agent factory. Injected agents remain caller-owned. */
  createAgent?: (opts: AcpAgentOpts) => AcpAgent;
  /** Test-only manager seam. Injected managers remain externally owned. */
  agentManager?: Pick<AcpAgentManager, 'getAgent'>;
  /** Test-only factory for the per-run manager. */
  createAgentManager?: () => AcpAgentManager;
  /**
   * D1.4b — When true, the mission is parsed with `parseHeuristicPlan`
   * and the resulting plan is forwarded to `AutopilotLoopDriver.plan`.
   * Each iteration then takes its prompt from a plan step. No-op when
   * the mission has no numbered/bulleted markers.
   */
  autoPlan?: boolean;
}

export interface AutopilotRunOutcome {
  exitCode: 0 | 1;
  result: AutopilotResult;
}

export async function acquireAutopilotRunAgent(
  backend: string,
  agentOpts: Omit<AcpAgentOpts, 'backendId'>,
  opts: Pick<AutopilotRunOptions, 'createAgent' | 'agentManager'> = {},
): Promise<{ agent: AcpAgent; callerOwnsLifecycle: boolean }> {
  if (opts.createAgent) {
    const agent = opts.createAgent({ backendId: backend, ...agentOpts });
    try {
      await agent.start();
    } catch (error) {
      await agent.stop().catch(() => {});
      throw error;
    }
    return { agent, callerOwnsLifecycle: true };
  }
  if (!opts.agentManager) throw new Error('agentManager-required');
  return {
    agent: await opts.agentManager.getAgent(backend, agentOpts),
    callerOwnsLifecycle: false,
  };
}

/**
 * Runs a single mission against an ACP backend end-to-end. Caller is
 * responsible for converting the outcome into a process exit code
 * (see {@link AutopilotRunOutcome.exitCode}).
 *
 * Loop semantics:
 *   - Single iteration by default (\`maxIterations\` 1) — the CLI is for
 *     smoke tests, not multi-turn autonomous runs. Override with
 *     \`--max-iterations N\` for longer cascades.
 *   - No \`onIterationEnd\` hook — without a follow-up planner, the loop
 *     terminates with \`{ kind: 'success', reason: 'no follow-up hook' }\`
 *     after the first turn resolves naturally.
 */
export async function runAutopilotMission(
  opts: AutopilotRunOptions,
): Promise<AutopilotRunOutcome> {
  // ⛔⭐⭐ 리뷰어·심판과 **같은 상수**(`DEFAULT_REVIEW_BACKEND` = codex · `JDG-S9`).
  //   정식 매니저가 이 backend의 transport를 선택하고 캐시 수명도 소유한다.
  //   ⛔ 이름이 `REVIEW`지만 이것은 **ACP 기본 백엔드**다 — 세 경로가 한 값을 공유해야 갈리지 않는다.
  const backend = opts.backend ?? DEFAULT_REVIEW_BACKEND;
  const log = opts.verbose
    ? (msg: string) => process.stderr.write(`[acp] ${msg}\n`)
    : () => {};

  const agentOpts: Omit<AcpAgentOpts, 'backendId'> = {
    cwd: opts.cwd,
    log,
  };
  const ownedManager = !opts.createAgent && !opts.agentManager
    ? (opts.createAgentManager?.() ?? new AcpAgentManager())
    : undefined;
  const agentManager = opts.agentManager ?? ownedManager;
  let acquired: { agent: AcpAgent; callerOwnsLifecycle: boolean } | undefined;

  try {
    acquired = await acquireAutopilotRunAgent(backend, agentOpts, { ...opts, agentManager });
    const { agent } = acquired;
    const sessionId = await agent.newSession();

    const onEnvelope = (env: FeedbackEnvelope): void => {
      // One JSON per line — easy to pipe into jq for inspection.
      process.stderr.write(JSON.stringify(env) + '\n');
    };

    // D1.4b — `--auto-plan` 시 mission 의 numbered/bulleted list 를
    // AutopilotPlan 으로 split. 자동 multi-iter. marker 없으면 plan 미주입.
    const planConfig = opts.autoPlan ? heuristicPlanConfig(opts.mission) : {};
    if (opts.autoPlan && planConfig.plan) {
      process.stderr.write(
        `--- auto-plan: ${planConfig.plan.steps.length} steps detected\n`,
      );
    } else if (opts.autoPlan) {
      process.stderr.write(`--- auto-plan: no markers detected · single-shot\n`);
    }

    const driver = new AutopilotLoopDriver({
      runner: new AcpTurnRunner(agent, sessionId),
      sessionId,
      mission: opts.mission,
      maxIterations: opts.maxIterations ?? 1,
      maxWallClockMs: opts.maxWallClockMs ?? Number.POSITIVE_INFINITY,
      maxOutputChars: opts.maxOutputChars ?? Number.POSITIVE_INFINITY,
      onEnvelope,
      onUpdate: (update) => {
        if (
          update.sessionUpdate === 'agent_message_chunk' &&
          update.content?.type === 'text' &&
          typeof update.content.text === 'string'
        ) {
          process.stdout.write(update.content.text);
        }
      },
      ...planConfig,
    });

    const result = await driver.run();
    // Trailing newline so the terminator JSON line is on its own row.
    process.stdout.write('\n');
    process.stderr.write(`--- termination: ${JSON.stringify(result.termination)}\n`);
    process.stderr.write(`--- iterations: ${result.iterations}\n`);
    return {
      exitCode: result.termination.kind === 'success' ? 0 : 1,
      result,
    };
  } finally {
    if (acquired?.callerOwnsLifecycle) {
      try {
        await acquired.agent.stop();
      } catch {
        // best-effort — driver may have already triggered cancel
      }
    }
    try {
      await ownedManager?.dispose();
    } catch {
      // best-effort — cleanup must not replace the mission outcome
    }
  }
}
