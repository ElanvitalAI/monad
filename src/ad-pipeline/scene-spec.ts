export type CameraMove = 'dolly-in' | 'dolly-out' | 'pan' | 'tilt' | 'tracking' | 'crane' | 'drone' | 'push-in' | 'static';

export type ShotSize = 'wide' | 'medium' | 'close-up';

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4';

export type ProductionCheck =
  | { readonly kind: 'reference'; readonly what: string; readonly count: number }
  | { readonly kind: 'legible-writing'; readonly what: string }
  | { readonly kind: 'identity-check' }
  | { readonly kind: 'bgm-enter' }
  | { readonly kind: 'static-impact' }
  | { readonly kind: 'end-card'; readonly text: string };

export interface Beat {
  readonly role: 'hook' | 'buildup' | 'climax' | 'transition';
  readonly startSec: number;
  readonly endSec: number;
  readonly emotion: { readonly primary: string; readonly secondary: string };
  readonly camera: { readonly move: CameraMove; readonly shotSize: ShotSize };
  readonly model: string;
  readonly audio: boolean;
  readonly promptCore: string;
  readonly checks: readonly ProductionCheck[];
  readonly transitionIn?: { readonly kind: 'hard-cut' | 'match-cut' | 'hold' | 'dissolve'; readonly intent: string };
}

export interface FiveAxes {
  readonly hook: string;
  readonly totalSeconds: number;
  readonly lock: {
    readonly lens: string;
    readonly lighting: string;
    readonly grade: string;
    readonly texture: string;
    readonly identity?: { readonly kind: 'soul-id' | 'hero-frame'; readonly ref: string };
  };
}

export interface SceneSpec {
  readonly beats: readonly Beat[];
  readonly axes: FiveAxes;
  readonly aspectRatio: AspectRatio;
  readonly forbidden: readonly string[];
  readonly provenance: 'real' | 'generated';
}

export interface SceneSpecValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface SceneSpecOptions {
  /** Minimum clip length in seconds supplied by the caller. */
  readonly minGeneratableSeconds?: number;
}

const ASPECT_RATIOS: readonly AspectRatio[] = ['16:9', '9:16', '1:1', '4:3', '3:4'];

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

export function validateSceneSpec(scene: SceneSpec, options?: SceneSpecOptions): SceneSpecValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (scene.beats.length < 3 || scene.beats.length > 6) {
    errors.push('SceneSpec beats must contain between 3 and 6 beats.');
  }
  if (!ASPECT_RATIOS.includes(scene.aspectRatio)) {
    errors.push(`SceneSpec aspectRatio must be a supported model ratio; received ${scene.aspectRatio}.`);
  }

  let totalSeconds = 0;
  for (const [index, beat] of scene.beats.entries()) {
    const name = `Beat ${index + 1}`;
    const duration = beat.endSec - beat.startSec;
    totalSeconds += duration;

    if (!Number.isFinite(beat.startSec) || !Number.isFinite(beat.endSec) || duration <= 0) {
      errors.push(`${name} must have a positive finite time range.`);
    }
    if (!nonEmpty(beat.emotion.primary) || !nonEmpty(beat.emotion.secondary)) {
      errors.push(`${name} emotion requires non-empty primary and secondary values.`);
    }
    if (!nonEmpty(beat.model)) {
      errors.push(`${name} model must be non-empty.`);
    }
    if (duration < 5 || duration > 7) {
      warnings.push(`${name} duration ${duration}s is outside the recommended 5–7 seconds.`);
    }
    if (options?.minGeneratableSeconds !== undefined && duration < options.minGeneratableSeconds) {
      warnings.push(`${name} duration ${duration}s is shorter than the ${options.minGeneratableSeconds}s generatable clip minimum; 최소 길이로 올려 찍고 편집에서 트림, 앞 비트에 붙여 한 클립으로 찍는다, 또는 생성하지 않는다 — 스틸 ⊕ 페이드로 편집에서 만든다.`);
    }
  }

  if (totalSeconds !== scene.axes.totalSeconds) {
    errors.push(`SceneSpec beat duration sum ${totalSeconds}s must equal totalSeconds ${scene.axes.totalSeconds}s.`);
  }

  return { valid: errors.length === 0, errors, warnings };
}
