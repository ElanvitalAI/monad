import type { CapabilityProvider } from '../mission-capabilities/registry.js';

export interface CapabilityRef {
  id: string;
}

export interface MissionBlueprint {
  id: string;
  run(ctx: BlueprintRunContext): Promise<BlueprintResult>;
  requires: readonly CapabilityRef[];
  produces: { kind: string; deliver: readonly string[] };
}

export interface BlueprintRunContext {
  authorityRoot: string;
  capabilities: ReadonlyMap<string, CapabilityProvider>;
  signal: AbortSignal;
}

export interface BlueprintResult {
  ok: boolean;
  body: string;
  measured: Record<string, number | string>;
}

/** Runtime outcome of retaining a blueprint body locally; independent of declarative delivery surfaces. */
export type RuntimeFileDeliveryOutcome =
  | { status: 'persisted'; path: string; bytes: number }
  | { status: 'failed'; reason: string };
