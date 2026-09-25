import { buildShootPlan, type ShootCommand, type ShootPlan } from '../src/ad-pipeline/shoot-plan.js';
import type { CommandRunner } from '../src/ad-pipeline/higgsfield-backend.js';
import type { SceneSpec } from '../src/ad-pipeline/scene-spec.js';

export interface InvalidCommand {
  readonly beatIndex: number;
  readonly error: string;
}

export interface PreflightResult {
  readonly invalidCommands: readonly InvalidCommand[];
  readonly unmeasuredCommands: readonly ShootCommand[];
  /** Sum of commands whose cost was successfully returned, even when the complete plan is not measurable. */
  readonly partialMeasuredCredits: number;
  /** Complete-plan total; absent until every command is measured. */
  readonly measuredCredits?: number;
  readonly plannedCredits?: number;
  /** Absent when the complete plan could not be measured. */
  readonly totalsMatch?: boolean;
  readonly approved: boolean;
}

const CREDIT_OUTPUT = /(?:^|\s)(\d+(?:\.\d+)?)\s+credits?\b/i;

function isUnmeasurable(command: ShootCommand): boolean {
  return command.jobType === 'RUN' || command.jobType.toLowerCase() === 'workflow';
}

function errorMessage(stderr: string, exitCode: number): string {
  return stderr.trim() || `generate cost exited with ${exitCode}.`;
}

function measuredCredits(stdout: string): number | undefined {
  const match = CREDIT_OUTPUT.exec(stdout);
  return match === null ? undefined : Number(match[1]);
}

export async function preflightShootPlan(plan: ShootPlan, runner: CommandRunner): Promise<PreflightResult> {
  const invalidCommands: InvalidCommand[] = [];
  const unmeasuredCommands: ShootCommand[] = [];
  let total = 0;

  for (const command of plan.commands) {
    if (isUnmeasurable(command)) {
      unmeasuredCommands.push(command);
      continue;
    }

    try {
      const result = await runner.run([
        'higgsfield', 'generate', 'cost', command.jobType, ...command.args, '--duration', String(command.durationSeconds),
      ]);
      if (result.exitCode !== 0) {
        invalidCommands.push({ beatIndex: command.beatIndex, error: errorMessage(result.stderr, result.exitCode) });
        continue;
      }

      const cost = measuredCredits(result.stdout);
      if (cost === undefined || !Number.isFinite(cost)) {
        invalidCommands.push({ beatIndex: command.beatIndex, error: 'generate cost returned no readable credit amount.' });
        continue;
      }
      total += cost;
    } catch (error) {
      invalidCommands.push({
        beatIndex: command.beatIndex,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const plannedCredits = plan.totalEstimatedCredits;
  const fullyMeasured = invalidCommands.length === 0 && unmeasuredCommands.length === 0;
  const totalsMatch = fullyMeasured && plannedCredits !== undefined ? total === plannedCredits : undefined;
  return {
    invalidCommands,
    unmeasuredCommands,
    partialMeasuredCredits: total,
    ...(fullyMeasured ? { measuredCredits: total } : {}),
    ...(plannedCredits === undefined ? {} : { plannedCredits }),
    ...(totalsMatch === undefined ? {} : { totalsMatch }),
    approved: fullyMeasured && totalsMatch === true,
  };
}

export function renderPreflight(result: PreflightResult): string {
  const lines = [
    `측정 합계: ${result.measuredCredits === undefined ? '측정 불가' : `${result.measuredCredits} cr`}`,
    `부분 측정 합계: ${result.partialMeasuredCredits} cr`,
    `계획 합계: ${result.plannedCredits === undefined ? '없음' : `${result.plannedCredits} cr`}`,
    `합계 일치: ${result.totalsMatch === undefined ? '측정 불가' : result.totalsMatch ? '예' : '아니오'}`,
    `무효 명령: ${result.invalidCommands.length}`,
    `못 잰 명령: ${result.unmeasuredCommands.length}`,
    `검사 승인: ${result.approved ? '예' : '아니오'}`,
  ];
  for (const invalid of result.invalidCommands) lines.push(`무효 beat ${invalid.beatIndex + 1}: ${invalid.error}`);
  for (const command of result.unmeasuredCommands) lines.push(`못 잰 beat ${command.beatIndex + 1}: ${command.jobType}`);
  return lines.join('\n');
}

export function createHiggsfieldCostRunner(): CommandRunner {
  return {
    async run(argv, options) {
      if (argv.slice(0, 3).join(' ') !== 'higgsfield generate cost') {
        throw new Error('Preflight runner permits only higgsfield generate cost.');
      }
      const child = Bun.spawn({ cmd: [...argv], stdout: 'pipe', stderr: 'pipe', ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }) });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { stdout, stderr, exitCode };
    },
  };
}

const fiveBeatScene: SceneSpec = {
  aspectRatio: '9:16',
  provenance: 'generated',
  forbidden: [],
  axes: { hook: 'product', totalSeconds: 31, lock: { lens: '50mm', lighting: 'soft', grade: 'neutral', texture: 'clean' } },
  beats: [
    { role: 'hook', startSec: 0, endSec: 5, emotion: { primary: 'calm', secondary: 'focus' }, camera: { move: 'static', shotSize: 'wide' }, model: 'kling3_0_turbo', audio: false, promptCore: 'Product introduction', checks: [] },
    { role: 'buildup', startSec: 5, endSec: 12, emotion: { primary: 'hope', secondary: 'warmth' }, camera: { move: 'pan', shotSize: 'medium' }, model: 'seedance_2_0', audio: false, promptCore: 'Product detail', checks: [] },
    { role: 'climax', startSec: 12, endSec: 20, emotion: { primary: 'joy', secondary: 'energy' }, camera: { move: 'push-in', shotSize: 'close-up' }, model: 'kling3_0_turbo', audio: false, promptCore: 'Product in motion', checks: [] },
    { role: 'transition', startSec: 20, endSec: 28, emotion: { primary: 'calm', secondary: 'clarity' }, camera: { move: 'static', shotSize: 'medium' }, model: 'seedance_2_0', audio: false, promptCore: 'Product benefit', checks: [] },
    { role: 'transition', startSec: 28, endSec: 31, emotion: { primary: 'rest', secondary: 'confidence' }, camera: { move: 'static', shotSize: 'medium' }, model: 'kling3_0_turbo', audio: false, promptCore: 'Product closing', checks: [] },
  ],
};

export function buildFiveBeatPlan(): ShootPlan {
  return buildShootPlan(fiveBeatScene, {
    mode: 'quality',
    durationRules: {
      kling3_0_turbo: { minimumSeconds: 3 },
      seedance_2_0: { minimumSeconds: 4 },
    },
    creditsPerSecond: { kling3_0_turbo: 1.5, seedance_2_0: 4.5 },
  });
}

export async function main(runner: CommandRunner = createHiggsfieldCostRunner(), write: (line: string) => void = console.log): Promise<PreflightResult> {
  const result = await preflightShootPlan(buildFiveBeatPlan(), runner);
  write(renderPreflight(result));
  return result;
}

if (import.meta.main) void main();
