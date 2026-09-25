import { runAdPipeline, type AdGate, type AdPipelineDeps, type AdPipelineResult, type AdProductionDeps } from '../src/ad-pipeline/run.js';
import type { CommandRunner } from '../src/ad-pipeline/higgsfield-backend.js';
import type { Intake } from '../src/ad-pipeline/intake.js';

export interface AdDryChainMeasurement {
  readonly approvalCount: number;
  readonly approvedGates: readonly AdGate[];
  readonly stageCount: number;
  readonly stagedGates: readonly AdGate[];
  readonly groundingCount: number;
  readonly shellCommandCount?: number;
  readonly vendorSubmitCount?: number;
  readonly vendorCreateCount?: number;
}

export type AdDryChainDiagnostic =
  | { readonly code: 'gates-approved'; readonly message: 'All requested gates were approved.' }
  | { readonly code: 'gate-rejected'; readonly message: string; readonly stoppedGate: AdGate }
  | { readonly code: 'pipeline-blocked'; readonly message: string }
  | { readonly code: 'vendor-spend-observed'; readonly message: string }
  | { readonly code: 'pipeline-error'; readonly message: string };

export type AdDryChainResult =
  | {
    readonly ok: true;
    readonly pipeline: AdPipelineResult;
    readonly measurement: AdDryChainMeasurement;
    readonly diagnostic: Exclude<AdDryChainDiagnostic, { readonly code: 'pipeline-error' | 'vendor-spend-observed' }>;
  }
  | {
    readonly ok: false;
    readonly measurement: AdDryChainMeasurement;
    readonly diagnostic: Extract<AdDryChainDiagnostic, { readonly code: 'pipeline-error' | 'vendor-spend-observed' }>;
    readonly error?: { readonly name: string; readonly message: string };
  };

export interface AdDryChainDependencies {
  readonly approve?: AdPipelineDeps['approve'];
  readonly stage?: AdPipelineDeps['stage'];
  readonly onGrounding?: AdPipelineDeps['onGrounding'];
  readonly production?: AdPipelineDeps['production'];
  readonly clipSourceDir?: string;
  readonly runPipeline?: (intake: Intake, deps: AdPipelineDeps) => Promise<AdPipelineResult>;
}

function emptyMeasurement(): AdDryChainMeasurement {
  return {
    approvalCount: 0,
    approvedGates: [],
    stageCount: 0,
    stagedGates: [],
    groundingCount: 0,
  };
}

const SPEND_ARGV = ['generate', 'create'] as const;

function isSpendArgv(argv: readonly string[]): boolean {
  return argv.some((value, index) => value === SPEND_ARGV[0] && argv[index + 1] === SPEND_ARGV[1]);
}

function countCommands(
  runner: CommandRunner,
  increment: () => void,
  observeArgv: (argv: readonly string[]) => void,
): CommandRunner {
  return {
    run: async (argv, options) => {
      increment();
      observeArgv(argv);
      return runner.run(argv, options);
    },
  };
}

function instrumentProduction(
  production: AdProductionDeps | undefined,
  clipSourceDir: string | undefined,
  incrementShellCommand: () => void,
  incrementVendorSubmit: () => void,
  observeVendorCreate: (argv: readonly string[]) => void,
): AdProductionDeps | undefined {
  if (!production) return undefined;
  const clips = production.clips && {
    ...production.clips,
    runner: countCommands(production.clips.runner, incrementShellCommand, observeVendorCreate),
    ...(clipSourceDir === undefined ? {} : { workDir: clipSourceDir }),
  };
  return {
    ...production,
    ...(production.cut ? {
      cut: {
        ...production.cut,
        submit: async (command) => {
          incrementVendorSubmit();
          return production.cut!.submit(command);
        },
      },
    } : {}),
    ...(production.shootClipRetention ? {
      shootClipRetention: {
        ...production.shootClipRetention,
        runner: countCommands(production.shootClipRetention.runner, incrementShellCommand, observeVendorCreate),
      },
    } : {}),
    ...(production.voiceover?.runner ? {
      voiceover: { ...production.voiceover, runner: countCommands(production.voiceover.runner, incrementShellCommand, observeVendorCreate) },
    } : {}),
    ...(production.soundtrack ? { soundtrack: countCommands(production.soundtrack, incrementShellCommand, observeVendorCreate) } : {}),
    ...(clips ? { clips } : {}),
    ...(production.render ? { render: countCommands(production.render, incrementShellCommand, observeVendorCreate) } : {}),
  };
}

function diagnosticFor(result: AdPipelineResult): Exclude<AdDryChainDiagnostic, { readonly code: 'pipeline-error' | 'vendor-spend-observed' }> {
  if (result.status === 'gates-approved') return { code: 'gates-approved', message: 'All requested gates were approved.' };
  if (result.status === 'rejected') return { code: 'gate-rejected', message: `Gate rejected: ${result.stoppedGate}.`, stoppedGate: result.stoppedGate };
  return { code: 'pipeline-blocked', message: result.reason };
}

function errorContract(error: unknown): { readonly name: string; readonly message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'Error', message: String(error) };
}

export async function runAdDryChain(intake: Intake, dependencies: AdDryChainDependencies = {}): Promise<AdDryChainResult> {
  const approvedGates: AdGate[] = [];
  const stagedGates: AdGate[] = [];
  let groundingCount = 0;
  let shellCommandCount = 0;
  let vendorSubmitCount = 0;
  let vendorCreateCount = 0;
  const observedSpendArgvs: string[] = [];
  const measurement = (): AdDryChainMeasurement => ({
    ...emptyMeasurement(),
    approvalCount: approvedGates.length,
    approvedGates,
    stageCount: stagedGates.length,
    stagedGates,
    groundingCount,
    ...(production ? { shellCommandCount, vendorSubmitCount, vendorCreateCount } : {}),
  });
  const runner = dependencies.runPipeline ?? runAdPipeline;
  const production = instrumentProduction(
    dependencies.production,
    dependencies.clipSourceDir,
    () => { shellCommandCount += 1; },
    () => { vendorSubmitCount += 1; },
    (argv) => {
      if (isSpendArgv(argv)) {
        vendorCreateCount += 1;
        observedSpendArgvs.push(argv.join(' '));
      }
    },
  );
  const deps: AdPipelineDeps = {
    approve: async (gate, plan) => {
      const approved = dependencies.approve ? await dependencies.approve(gate, plan) : true;
      if (approved) approvedGates.push(gate);
      return approved;
    },
    stage: async (gate, plan) => {
      await dependencies.stage?.(gate, plan);
      stagedGates.push(gate);
    },
    onGrounding: async (outcome) => {
      groundingCount += 1;
      await dependencies.onGrounding?.(outcome);
    },
    ...(production ? { production } : {}),
  };

  try {
    const pipeline = await runner(intake, deps);
    if (vendorCreateCount > 0) {
      return {
        ok: false,
        measurement: measurement(),
        diagnostic: { code: 'vendor-spend-observed', message: `Vendor spending observed; would run: ${observedSpendArgvs.join('; ')}` },
      };
    }
    return { ok: true, pipeline, measurement: measurement(), diagnostic: diagnosticFor(pipeline) };
  } catch (caught) {
    const error = errorContract(caught);
    if (vendorCreateCount > 0) {
      return {
        ok: false,
        measurement: measurement(),
        diagnostic: { code: 'vendor-spend-observed', message: `Vendor spending observed; would run: ${observedSpendArgvs.join('; ')}` },
        error,
      };
    }
    return {
      ok: false,
      measurement: measurement(),
      diagnostic: { code: 'pipeline-error', message: error.message },
      error,
    };
  }
}

export async function main(
  intake: Intake = { kind: 'text', brief: 'ad dry chain' },
  dependencies: AdDryChainDependencies = {},
): Promise<AdDryChainResult> {
  return runAdDryChain(intake, dependencies);
}

if (import.meta.main) {
  const result = await main();
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}
