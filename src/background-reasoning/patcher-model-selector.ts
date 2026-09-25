// W5 Y3 · Patcher model selector — task kind → provider/model spec.
// Cf. ROADMAP-background-reasoning §3.5.
// Default: local-first. Cloud only when caller's BudgetGate signals
// local saturation AND the task kind escalates beyond log_normalize.

export type PatcherTaskKind =
  | 'log_normalize'
  | 'embedding'
  | 'entity_extract'
  | 'pattern_detect'
  | 'retrospective_synth'
  | 'unknown';

export type PatcherProvider = 'local' | 'cloud' | 'delegate';

export interface PatcherModelSpec {
  provider: PatcherProvider;
  /** Model id. Empty when `provider==='delegate'`. */
  model: string;
  /** Target subsystem when delegating (e.g. 'thinker'). */
  delegate?: string;
}

export interface PatcherModelSelectorDeps {
  /** Caller's view of pool saturation. Returns true when a local slot is free. */
  localAvailable: () => boolean;
  /** Optional override of default model pins. */
  pins?: Partial<{
    localLight: string;
    localMid: string;
    cloudCheap: string;
  }>;
}

const DEFAULT_PINS = {
  localLight: 'lm-studio/qwen-7b',
  localMid: 'lm-studio/qwen-14b',
  cloudCheap: 'gemini-flash',
};

export class PatcherModelSelector {
  private readonly localAvailable: () => boolean;
  private readonly pins: typeof DEFAULT_PINS;

  constructor(deps: PatcherModelSelectorDeps) {
    this.localAvailable = deps.localAvailable;
    this.pins = { ...DEFAULT_PINS, ...deps.pins };
  }

  select(kind: PatcherTaskKind): PatcherModelSpec {
    switch (kind) {
      case 'log_normalize':
      case 'embedding':
        return { provider: 'local', model: this.pins.localLight };
      case 'entity_extract':
      case 'pattern_detect':
        if (this.localAvailable()) {
          return { provider: 'local', model: this.pins.localMid };
        }
        return { provider: 'cloud', model: this.pins.cloudCheap };
      case 'retrospective_synth':
        // Deeper reasoning lives in Thinker (Y4) — Patcher hands off.
        return { provider: 'delegate', model: '', delegate: 'thinker' };
      case 'unknown':
      default:
        return { provider: 'local', model: this.pins.localLight };
    }
  }
}
