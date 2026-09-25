// W6 Y4 · Thinker model selector — task kind → cloud/local spec.
// Cf. ROADMAP §4.5. Cloud-first (depth + long-context priority).

export type ThinkerTaskKind =
  | 'workflow_proposal'      // S19 · long context
  | 'template_draft'         // S22 · long context
  | 'pattern_detect'         // routine extraction · local OK
  | 'personalization'        // voice/motion/timing learn · local OK
  | 'prompt_patch'           // self-improving · accuracy critical
  | 'mission_decision'       // S2 · cheap default
  | 'cross_workflow_pattern' // S5 retro
  | 'next_action_predict';   // S11

export type ThinkerProvider = 'cloud' | 'local';

export interface ThinkerModelSpec {
  provider: ThinkerProvider;
  model: string;
  /** True when long-context (>32k) is required. Caller respects model availability. */
  longContext: boolean;
}

export interface ThinkerModelSelectorDeps {
  /** Caller's view — pool slot for qwen-32b. */
  local2Available: () => boolean;
  pins?: Partial<{
    cloudLong: string;
    cloudAccurate: string;
    cloudCheap: string;
    local2: string;
  }>;
}

const DEFAULT_PINS = {
  cloudLong: 'gemini-2.5-pro',
  cloudAccurate: 'claude-sonnet',
  cloudCheap: 'gemini-flash',
  local2: 'lm-studio/qwen-32b',
};

export class ThinkerModelSelector {
  private readonly local2Available: () => boolean;
  private readonly pins: typeof DEFAULT_PINS;

  constructor(deps: ThinkerModelSelectorDeps) {
    this.local2Available = deps.local2Available;
    this.pins = { ...DEFAULT_PINS, ...deps.pins };
  }

  select(kind: ThinkerTaskKind): ThinkerModelSpec {
    switch (kind) {
      case 'workflow_proposal':
      case 'template_draft':
      case 'cross_workflow_pattern':
        return { provider: 'cloud', model: this.pins.cloudLong, longContext: true };
      case 'pattern_detect':
      case 'personalization':
        if (this.local2Available()) {
          return { provider: 'local', model: this.pins.local2, longContext: false };
        }
        return { provider: 'cloud', model: this.pins.cloudCheap, longContext: false };
      case 'prompt_patch':
        return { provider: 'cloud', model: this.pins.cloudAccurate, longContext: false };
      case 'mission_decision':
      case 'next_action_predict':
        return { provider: 'cloud', model: this.pins.cloudCheap, longContext: false };
    }
  }
}
