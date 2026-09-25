import type {
  FabricDecomposeGoal,
  FabricDecomposeGround,
  FabricDecomposeResolve,
} from '../../src/self-dev/fabric-decompose-adapter.js';
import { observeFabricArc } from './fabric-arc-observe.js';

type FabricArcObservation = Awaited<ReturnType<typeof observeFabricArc>>;

export interface FabricArcObserveAbOptions {
  request: string;
  withoutGrounding: FabricDecomposeGround;
  withGrounding: FabricDecomposeGround;
  resolve: FabricDecomposeResolve;
  decomposeGoal: FabricDecomposeGoal;
}

export interface FabricArcObserveAbResult {
  withoutGrounding: FabricArcObservation;
  withGrounding: FabricArcObservation;
}

/**
 * Observes the same fabric request under empty and populated grounding seams,
 * preserving each condition's native observation for caller-side comparison.
 */
export async function observeFabricArcAb(
  options: FabricArcObserveAbOptions,
): Promise<FabricArcObserveAbResult> {
  const shared = {
    request: options.request,
    resolve: options.resolve,
    decomposeGoal: options.decomposeGoal,
  };
  const [withoutGrounding, withGrounding] = await Promise.all([
    observeFabricArc({ ...shared, ground: options.withoutGrounding }),
    observeFabricArc({ ...shared, ground: options.withGrounding }),
  ]);

  return { withoutGrounding, withGrounding };
}
