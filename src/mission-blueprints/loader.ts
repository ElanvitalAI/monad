import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { capabilityProviders } from '../mission-capabilities/registry.js';
import type { CapabilityProvider } from '../mission-capabilities/registry.js';
import type { CapabilityRef, MissionBlueprint } from './types.js';

const REQUEST_ID_RE = /^req:v1:[0-9a-f]{16}$/;
const CAPABILITY_ID_RE = /^[a-z]+\.[a-z.]+$/;

export interface LoadMissionBlueprintOptions {
  authorityRoot: string;
  requestId: string;
  requestRequires: readonly CapabilityRef[];
  catalog?: readonly CapabilityProvider[];
}

export type MissionBlueprintLoadResult =
  | { status: 'missing'; path: string }
  | { status: 'invalid'; path: string; reason: string }
  | { status: 'unavailable'; path: string; capabilityId: string; reason: string; repairHint: { paths: readonly string[]; what: string } }
  | { status: 'ready'; path: string; blueprint: MissionBlueprint };

function blueprintPath(authorityRoot: string, requestId: string): string {
  return join(authorityRoot, 'src', 'mission-blueprints', `${requestId.replace(/:/g, '-')}.ts`);
}

function isCapabilityRef(value: unknown): value is CapabilityRef {
  return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string';
}

function isMissionBlueprint(value: unknown): value is MissionBlueprint {
  if (typeof value !== 'object' || value === null || 'schedule' in value) return false;
  const blueprint = value as Partial<MissionBlueprint>;
  return typeof blueprint.id === 'string'
    && typeof blueprint.run === 'function'
    && Array.isArray(blueprint.requires)
    && blueprint.requires.every(isCapabilityRef)
    && typeof blueprint.produces === 'object'
    && blueprint.produces !== null
    && typeof blueprint.produces.kind === 'string'
    && Array.isArray(blueprint.produces.deliver)
    && blueprint.produces.deliver.every(item => typeof item === 'string');
}

export async function loadMissionBlueprint(options: LoadMissionBlueprintOptions): Promise<MissionBlueprintLoadResult> {
  if (!REQUEST_ID_RE.test(options.requestId)) {
    return { status: 'invalid', path: '', reason: 'invalid-request-id' };
  }

  const path = blueprintPath(options.authorityRoot, options.requestId);
  if (!existsSync(path)) return { status: 'missing', path };

  let candidate: unknown;
  try {
    candidate = (await import(`${pathToFileURL(path).href}?cacheBust=${crypto.randomUUID()}`)).default;
  } catch {
    return { status: 'invalid', path, reason: 'module-import-failed' };
  }

  if (!isMissionBlueprint(candidate) || !REQUEST_ID_RE.test(candidate.id)) {
    return { status: 'invalid', path, reason: 'invalid-blueprint-shape-or-id' };
  }
  if (candidate.id !== options.requestId || path !== blueprintPath(options.authorityRoot, candidate.id)) {
    return { status: 'invalid', path, reason: 'request-id-mismatch' };
  }

  const requiredIds = new Set(candidate.requires.map(capability => capability.id));
  if (options.requestRequires.some(capability => !requiredIds.has(capability.id))) {
    return { status: 'invalid', path, reason: 'missing-request-capability' };
  }

  const catalog = options.catalog ?? capabilityProviders;
  const providerById = new Map(catalog.map(capability => [capability.id, capability]));
  if (candidate.requires.some(capability => !CAPABILITY_ID_RE.test(capability.id) || !providerById.has(capability.id))) {
    return { status: 'invalid', path, reason: 'unknown-or-invalid-capability' };
  }

  for (const capability of candidate.requires) {
    const result = await providerById.get(capability.id)!.probe({ authorityRoot: options.authorityRoot });
    if (!result.ok) {
      return {
        status: 'unavailable',
        path,
        capabilityId: capability.id,
        reason: result.reason,
        repairHint: result.repairHint,
      };
    }
  }

  return { status: 'ready', path, blueprint: candidate };
}
