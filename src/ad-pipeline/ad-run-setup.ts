import { createHiggsfieldBackend, type CommandRunner } from './higgsfield-backend.js';
import { parseMeasuredModelContracts } from './model-contracts.js';
import { adMasterName, adProjectDir, type AdOutputPathResult } from './output-path.js';
import type { AdProductionDeps } from './run.js';
import type { DurationRule, ReferenceDelivery } from './shoot-plan.js';

export interface AdRunSetupInput {
  readonly home: string;
  readonly slug: string;
  readonly date: string;
  readonly version: number;
  readonly aspect: string;
  readonly contractsJson: string;
  /** The explicitly injected command runner; production dependencies are omitted without it. */
  readonly runner?: CommandRunner;
  /** Higgsfield submissions remain blocked unless this explicit opt-in is true. */
  readonly allowSpend?: boolean;
  readonly higgsfieldCliPath?: string;
  readonly higgsfieldSubmitTimeoutMs?: number;
  /** Clock used for retention expiry decisions; defaults to the setup execution time. */
  readonly now?: () => Date;
  readonly assembly?: AdProductionDeps['assembly'];
  readonly assemblyMaterials?: AdProductionDeps['assemblyMaterials'];
  readonly captionFontPath?: AdProductionDeps['captionFontPath'];
  readonly musicBedPath?: AdProductionDeps['musicBedPath'];
  readonly qcThresholds?: AdProductionDeps['qcThresholds'];
  readonly voiceover?: AdProductionDeps['voiceover'];
  readonly soundtrack?: AdProductionDeps['soundtrack'];
  readonly referenceAssets?: AdProductionDeps['referenceAssets'];
  readonly shootRunOptions?: AdProductionDeps['shootRunOptions'];
  readonly ground?: AdProductionDeps['ground'];
  readonly invariants?: AdProductionDeps['invariants'];
}

export interface AdRunSetup {
  readonly workDir: string;
  readonly outputName: string;
  readonly durationRules: Readonly<Record<string, DurationRule>>;
  readonly creditsPerSecond: Readonly<Record<string, number>>;
  readonly referenceDelivery: Readonly<Record<string, ReferenceDelivery>>;
  /** Models the contracts file marks unmeasured; callers must not fill these. */
  readonly unknownModels: readonly string[];
  /** Production inputs the caller did not provide; the setup factory never invents them. */
  readonly missingProductionInputs: readonly (keyof Pick<AdProductionDeps, 'assembly' | 'assemblyMaterials' | 'captionFontPath' | 'musicBedPath' | 'qcThresholds' | 'voiceover' | 'soundtrack' | 'referenceAssets' | 'shootRunOptions' | 'ground' | 'invariants'>)[];
  /** Fully wired production dependencies, present only when a runner is explicitly injected. */
  readonly production?: AdProductionDeps;
}

type AdRunSetupError = Exclude<AdOutputPathResult, string>;
type MissingProductionInput = keyof Pick<AdProductionDeps, 'assembly' | 'assemblyMaterials' | 'captionFontPath' | 'musicBedPath' | 'qcThresholds' | 'voiceover' | 'soundtrack' | 'referenceAssets' | 'shootRunOptions' | 'ground' | 'invariants'>;

const optionalProductionInputs: readonly MissingProductionInput[] = [
  'assembly',
  'assemblyMaterials',
  'captionFontPath',
  'musicBedPath',
  'qcThresholds',
  'voiceover',
  'soundtrack',
  'referenceAssets',
  'shootRunOptions',
  'ground',
  'invariants',
];

function isError(result: AdOutputPathResult): result is AdRunSetupError {
  return typeof result !== 'string';
}

export function buildAdRunSetup(input: AdRunSetupInput): AdRunSetup | AdRunSetupError {
  const workDir = adProjectDir(input);
  if (isError(workDir)) return workDir;

  const outputName = adMasterName(input.slug, input.version, input.aspect);
  if (isError(outputName)) return outputName;

  const contracts = parseMeasuredModelContracts(input.contractsJson);
  if ('error' in contracts) return contracts;

  const missingProductionInputs = optionalProductionInputs.filter((key) => input[key] === undefined);
  const production = input.runner
    ? {
      ...(input.assembly === undefined ? {} : { assembly: input.assembly }),
      ...(input.assemblyMaterials === undefined ? {} : { assemblyMaterials: input.assemblyMaterials }),
      ...(input.captionFontPath === undefined ? {} : { captionFontPath: input.captionFontPath }),
      ...(input.musicBedPath === undefined ? {} : { musicBedPath: input.musicBedPath }),
      ...(input.qcThresholds === undefined ? {} : { qcThresholds: input.qcThresholds }),
      ...(input.voiceover === undefined ? {} : { voiceover: input.voiceover }),
      ...(input.soundtrack === undefined ? {} : { soundtrack: input.soundtrack }),
      ...(input.referenceAssets === undefined ? {} : { referenceAssets: input.referenceAssets }),
      ...(input.shootRunOptions === undefined ? {} : { shootRunOptions: input.shootRunOptions }),
      ...(input.ground === undefined ? {} : { ground: input.ground }),
      ...(input.invariants === undefined ? {} : { invariants: input.invariants }),
      cut: createHiggsfieldBackend({
        runner: input.runner,
        allowSpend: input.allowSpend,
        cliPath: input.higgsfieldCliPath,
        submitTimeoutMs: input.higgsfieldSubmitTimeoutMs,
      }),
      durationRules: contracts.durationRules,
      creditsPerSecond: contracts.creditsPerSecond,
      referenceDelivery: contracts.referenceDelivery,
      shootClipRetention: {
        runner: input.runner,
        options: { workDir, s3Available: false, now: (input.now ?? (() => new Date()))().toISOString() },
      },
      clips: { runner: input.runner, workDir },
      render: input.runner,
    } satisfies AdProductionDeps
    : undefined;

  return {
    workDir,
    outputName,
    durationRules: contracts.durationRules,
    creditsPerSecond: contracts.creditsPerSecond,
    referenceDelivery: contracts.referenceDelivery,
    unknownModels: contracts.unknown,
    missingProductionInputs,
    ...(production ? { production } : {}),
  };
}
