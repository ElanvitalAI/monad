import {
  parseScenarioYaml,
  type Scenario,
  type ScenarioResult,
  type ScenarioStatus,
} from '../playground-scenario/index.js';
import { listThemes } from '../themes/index.js';
import { listPresets } from '../../plugins/iul-presets/registry.js';
import type { AffectiveChromeState } from '../ui/chrome/affective-chrome-state.js';
import type { ModalChromeWidgetTokens } from '../theme/tokens.js';

export interface PlaygroundScenarioPaletteEntry {
  id: string;
  title: string;
  tags: string[];
  stepCount: number;
}

export interface PlaygroundThemeOptionEntry {
  name: string;
  isDark: boolean;
  isPastel: boolean;
}

export interface PlaygroundPresetOptionEntry {
  id: string;
  label: string;
  description: string;
  rowCount: number;
}

export interface PlaygroundShowcaseEntry {
  id: string;
  label: string;
  pluginId: string;
  description: string;
}

export interface PlaygroundThemeGenOptionEntry {
  id: string;
  label: string;
  description: string;
  goal: string;
  observe: string;
  nextStep: string;
}

export interface PlaygroundPopupLabOptionEntry {
  id: string;
  label: string;
  description: string;
  goal: string;
  observe: string;
  nextStep: string;
}

export interface PlaygroundMotionLabOptionEntry {
  id: string;
  label: string;
  description: string;
  goal: string;
  observe: string;
  nextStep: string;
}

export type PlaygroundChromeMotionMode = 'auto' | 'reduced' | 'off';
export type PlaygroundChromeVariant = NonNullable<ModalChromeWidgetTokens['chromeVariant']>;
export type PlaygroundChromeTarget = NonNullable<ModalChromeWidgetTokens['chromeTarget']>;

export interface PlaygroundLabFeedback {
  level: 'info' | 'success' | 'error';
  title: string;
  lines: string[];
  at: number;
  scenarioId?: string;
  status?: ScenarioStatus;
}

export interface PlaygroundEditableScenarioResolution {
  ok: boolean;
  scenario?: Scenario;
  feedback: PlaygroundLabFeedback;
}

export const PLAYGROUND_AFFECTIVE_STATES: readonly AffectiveChromeState[] = [
  'neutral',
  'thinking',
  'listening',
  'replying',
  'urgent',
  'approval-required',
  'tentative',
] as const;

export const PLAYGROUND_CHROME_MOTION_MODES: readonly PlaygroundChromeMotionMode[] = [
  'auto',
  'reduced',
  'off',
] as const;

export const PLAYGROUND_CHROME_VARIANTS: readonly PlaygroundChromeVariant[] = [
  'plain',
  'rounded',
  'double',
  'heavy',
] as const;

export const PLAYGROUND_CHROME_TARGETS: readonly PlaygroundChromeTarget[] = [
  'frame',
  'title-bar',
  'frame-and-title',
] as const;

export function buildScenarioPaletteEntries(
  scenarios: readonly Scenario[],
): PlaygroundScenarioPaletteEntry[] {
  return [...scenarios]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      tags: [...(scenario.tags ?? [])],
      stepCount: scenario.steps.length,
    }));
}

export function buildThemeOptionEntries(): PlaygroundThemeOptionEntry[] {
  return listThemes().map((theme) => ({
    name: theme.name,
    isDark: theme.isDark,
    isPastel: theme.isPastel,
  }));
}

export function buildPresetOptionEntries(): PlaygroundPresetOptionEntry[] {
  return listPresets().map((preset) => ({
    id: preset.id,
    label: preset.label,
    description: preset.description,
    rowCount: preset.rows.length,
  }));
}

export function nextAffectiveChromeState(
  current: AffectiveChromeState,
): AffectiveChromeState {
  const idx = PLAYGROUND_AFFECTIVE_STATES.indexOf(current);
  if (idx === -1) return PLAYGROUND_AFFECTIVE_STATES[0]!;
  return PLAYGROUND_AFFECTIVE_STATES[(idx + 1) % PLAYGROUND_AFFECTIVE_STATES.length]!;
}

export function nextPlaygroundChromeMotionMode(
  current: PlaygroundChromeMotionMode,
): PlaygroundChromeMotionMode {
  const idx = PLAYGROUND_CHROME_MOTION_MODES.indexOf(current);
  if (idx === -1) return PLAYGROUND_CHROME_MOTION_MODES[0]!;
  return PLAYGROUND_CHROME_MOTION_MODES[(idx + 1) % PLAYGROUND_CHROME_MOTION_MODES.length]!;
}

export function nextPlaygroundChromeVariant(
  current: PlaygroundChromeVariant | null | undefined,
): PlaygroundChromeVariant {
  const normalized = current ?? PLAYGROUND_CHROME_VARIANTS[0]!;
  const idx = PLAYGROUND_CHROME_VARIANTS.indexOf(normalized);
  if (idx === -1) return PLAYGROUND_CHROME_VARIANTS[0]!;
  return PLAYGROUND_CHROME_VARIANTS[(idx + 1) % PLAYGROUND_CHROME_VARIANTS.length]!;
}

export function nextPlaygroundChromeTarget(
  current: PlaygroundChromeTarget | null | undefined,
): PlaygroundChromeTarget {
  const normalized = current ?? PLAYGROUND_CHROME_TARGETS[0]!;
  const idx = PLAYGROUND_CHROME_TARGETS.indexOf(normalized);
  if (idx === -1) return PLAYGROUND_CHROME_TARGETS[0]!;
  return PLAYGROUND_CHROME_TARGETS[(idx + 1) % PLAYGROUND_CHROME_TARGETS.length]!;
}

export function buildShowcaseEntries(): PlaygroundShowcaseEntry[] {
  return [
    {
      id: 'canvas-sketch',
      label: 'Canvas Sketch',
      pluginId: 'iul-canvas',
      description: 'Mouse sketch canvas → materialize widget lane',
    },
    {
      id: 'runtime-signals',
      label: 'Runtime Signals',
      pluginId: 'widget-demo',
      description: 'Sparkline · fader · inspector · heatmap showcase',
    },
  ];
}

export function buildThemeGenOptionEntries(): PlaygroundThemeGenOptionEntry[] {
  return [
    {
      id: 'candidate-stack',
      label: 'Candidate Stack',
      description: 'Compare generated palettes in a stacked shortlist before apply',
      goal: 'Keep 3-5 generated candidates in one lane before committing to a single theme.',
      observe: 'Whether shortlist ordering and preview readability are enough without opening another VW.',
      nextStep: 'Add stack scoring, badge emphasis, and candidate freeze controls.',
    },
    {
      id: 'side-by-side-compare',
      label: 'Side-by-side Compare',
      description: 'Compare two or three generated palettes against the current shell',
      goal: 'Make contrast and chrome differences obvious without losing the current baseline theme.',
      observe: 'How much width the shell can spend on compare mode before detail readability collapses.',
      nextStep: 'Prototype 2-up and 3-up compare cards inside the detail surface.',
    },
    {
      id: 'apply-preview',
      label: 'Apply Preview',
      description: 'Stage theme application as a reversible preview before save',
      goal: 'Let the operator try a candidate theme without turning it into durable state yet.',
      observe: 'Whether preview/apply vocabulary needs a stronger active-state cue in the shell.',
      nextStep: 'Wire preview apply/revert actions to a temporary shell token override.',
    },
    {
      id: 'revert-preview',
      label: 'Revert Preview',
      description: 'Return the shell to its baseline theme after a staged preview',
      goal: 'Make preview experiments safe by keeping a clear way back to the pre-apply shell.',
      observe: 'Whether revert needs its own lane action or should piggyback on preview state directly.',
      nextStep: 'Attach revert to the same temporary token override used by apply preview.',
    },
    {
      id: 'save-export',
      label: 'Save / Export',
      description: 'Define how accepted candidates become stored presets or exported themes',
      goal: 'Close the loop from experiment to durable artifact without leaving the IUL shell.',
      observe: 'Whether save/export deserves a separate confirmation popup or an inline detail step.',
      nextStep: 'Add export target choices and a stored-theme result summary.',
    },
  ];
}

export function buildPopupLabOptionEntries(): PlaygroundPopupLabOptionEntry[] {
  return [
    {
      id: 'modal-shells',
      label: 'Modal Shells',
      description: 'Compare dialog, modal window, and framed shell hierarchy',
      goal: 'Decide which shell family best fits approval, settings, and focused work surfaces.',
      observe: 'How title density, footer hints, and close controls differ across shell tiers.',
      nextStep: 'Attach concrete modal recipes and capture screenshots for each shell tier.',
    },
    {
      id: 'picker-popups',
      label: 'Picker Popups',
      description: 'Compare popup sizing, compact hints, and picker chrome parity',
      goal: 'Keep search/picker families visually consistent as they scale down to compact widths.',
      observe: 'Whether narrow-width hint compression still leaves enough affordance for fast use.',
      nextStep: 'Wire live picker samples with sizing toggles and hint vocabulary swaps.',
    },
    {
      id: 'companions',
      label: 'Companion Popups',
      description: 'Compare memo/detail/clipboard companion surfaces inside one VW',
      goal: 'Treat memo, detail, and clipboard popups as one coherent companion family.',
      observe: 'Whether status wording, rail width, and title controls still feel related across variants.',
      nextStep: 'Add side-by-side companion recipes with shared chrome tokens.',
    },
    {
      id: 'overlays',
      label: 'Overlay Flows',
      description: 'Compare approval, ask-user, request-user, and hover overlay entry points',
      goal: 'Map which overlay family should own each interruptive or contextual flow.',
      observe: 'Where entry friction changes once overlay type and focus ownership differ.',
      nextStep: 'Attach flow matrix notes and trigger one real overlay from each family.',
    },
  ];
}

export function buildMotionLabOptionEntries(): PlaygroundMotionLabOptionEntry[] {
  return [
    ...PLAYGROUND_AFFECTIVE_STATES.map((state) => ({
      id: `state:${state}`,
      label: `State · ${state}`,
      description: 'Compare shell chrome behavior under affective-state changes',
      goal: 'Make affective states legible without turning shells into noisy status dashboards.',
      observe: 'Whether this state needs stronger badge, border, or title emphasis than the others.',
      nextStep: 'Bind this state to a live shell sample and compare it against neutral.',
    })),
    ...PLAYGROUND_CHROME_MOTION_MODES.map((mode) => ({
      id: `mode:${mode}`,
      label: `Motion mode · ${mode}`,
      description: 'Compare auto / reduced / off motion policies in one shell',
      goal: 'Choose a motion policy vocabulary that still works across accessibility and compact-width constraints.',
      observe: 'How much motion can remain before reduced/off stops feeling like the same product family.',
      nextStep: 'Add a live shell toggle that cycles this mode across the same sample surface.',
    })),
    ...PLAYGROUND_CHROME_VARIANTS.map((variant) => ({
      id: `variant:${variant}`,
      label: `Chrome variant · ${variant}`,
      description: 'Compare frame vocabulary before widening to more shell families',
      goal: 'Choose where each chrome frame style belongs before spreading it to more widget families.',
      observe: 'Which variants preserve clarity when shells are dense, narrow, or stacked.',
      nextStep: 'Render the same content surface through each variant and compare hierarchy.',
    })),
    ...PLAYGROUND_CHROME_TARGETS.map((target) => ({
      id: `target:${target}`,
      label: `Chrome target · ${target}`,
      description: 'Compare whether motion and emphasis land on frame, title-bar, or both',
      goal: 'Decide where shell emphasis should live so motion cues stay intentional instead of decorative.',
      observe: 'Whether frame-only, title-only, or combined emphasis best supports quick scanning.',
      nextStep: 'Attach target toggles to one shared shell sample and record preference notes.',
    })),
  ];
}

export function resolveEditableScenarioSource(
  source: string,
  fallbackId?: string,
): PlaygroundEditableScenarioResolution {
  const parsed = parseScenarioYaml(source);
  const targetId = parsed.scenario?.id?.trim() || fallbackId?.trim() || '';
  if (parsed.errors.length > 0) {
    return {
      ok: false,
      feedback: {
        level: 'error',
        title: 'Parse blocked',
        at: Date.now(),
        scenarioId: targetId || undefined,
        lines: [
          `source has ${parsed.errors.length} error(s); fix them before run/save`,
          ...parsed.errors.slice(0, 4).map((err) => `${err.line}:${err.col} [${err.severity}] ${err.message}`),
        ],
      },
    };
  }
  if (!parsed.scenario?.title?.trim()) {
    return {
      ok: false,
      feedback: {
        level: 'error',
        title: 'Missing title',
        at: Date.now(),
        scenarioId: targetId || undefined,
        lines: ['scenario title is required before run/save'],
      },
    };
  }
  if (!targetId) {
    return {
      ok: false,
      feedback: {
        level: 'error',
        title: 'Missing id',
        at: Date.now(),
        lines: ['scenario id is required before run/save'],
      },
    };
  }
  const scenario: Scenario = {
    id: targetId,
    title: parsed.scenario.title,
    description: parsed.scenario.description,
    tags: parsed.scenario.tags,
    setup: parsed.scenario.setup,
    steps: parsed.validSteps as Scenario['steps'],
  };
  return {
    ok: true,
    scenario,
    feedback: {
      level: 'success',
      title: 'Scenario ready',
      at: Date.now(),
      scenarioId: scenario.id,
      lines: [
        `${scenario.id} · ${scenario.title}`,
        `${scenario.steps.length} valid step(s)`,
        parsed.warnings.length > 0
          ? `${parsed.warnings.length} warning(s) still present`
          : 'no parse warnings',
      ],
    },
  };
}

export function buildScenarioSaveFeedback(
  scenario: Scenario,
  warningCount: number,
): PlaygroundLabFeedback {
  return {
    level: 'success',
    title: 'Scenario saved',
    at: Date.now(),
    scenarioId: scenario.id,
    lines: [
      `${scenario.id} registered in the live playground catalog`,
      `${scenario.steps.length} step(s)`,
      warningCount > 0 ? `${warningCount} warning(s) preserved` : 'no parse warnings',
    ],
  };
}

export function buildScenarioLoadFeedback(
  entry: PlaygroundScenarioPaletteEntry,
): PlaygroundLabFeedback {
  return {
    level: 'info',
    title: 'Scenario loaded',
    at: Date.now(),
    scenarioId: entry.id,
    lines: [
      `${entry.id} · ${entry.title}`,
      `${entry.stepCount} step(s)`,
      entry.tags.length > 0 ? `tags: ${entry.tags.join(', ')}` : 'untagged scenario',
    ],
  };
}

export function buildScenarioRunFeedback(result: ScenarioResult): PlaygroundLabFeedback {
  const icon = result.status === 'pass' ? 'PASS' : result.status === 'fail' ? 'FAIL' : 'ERROR';
  return {
    level: result.status === 'pass' ? 'success' : 'error',
    title: `Run ${icon}`,
    at: Date.now(),
    scenarioId: result.scenario.id,
    status: result.status,
    lines: [
      `${result.scenario.id} — ${icon} in ${result.durationMs}ms`,
      ...result.stepResults.slice(0, 8).map((step, idx) => {
        const prefix =
          step.status === 'pass' ? 'pass'
            : step.status === 'fail' ? 'FAIL'
              : step.status === 'error' ? 'ERROR'
                : 'skip';
        const detail = step.message ? ` — ${step.message}` : '';
        return `${prefix} · ${idx + 1} · ${step.step.action}${detail}`;
      }),
    ],
  };
}
