// W9b Z2 · Mission Deliberation Room — dedicated 3-lane showroom per mission.
// Cf. ROADMAP-showroom-x-task-fabric-2026-05-12.md §3 S2 + §4 Z2.
//
// A Mission is a long-running entity (Phase 1 I6) that decomposes into
// 1..N tasks; when the mission stalls (same progress % for 3+ days, or
// the user explicitly clicks "Open mission room") we spawn a deliberation
// room. Three personas tagged to the mission type (e.g. `frontend` ⇒
// architect-claude / implementer-codex / pragmatist-gemini) take turns
// reasoning over the mission state. The deliberation transcript + the
// decision the user applies are persisted as a JSONL audit log so that,
// 6 months later, the question "why did we go option B?" still answers.
//
// This file owns the orchestration only. mission.ts stays untouched —
// the existing `showroomSessionId` field (Z0) is reused as the anchor so
// no new schema lands. PWA wire + persona yaml seed files belong to a
// follow-up: this PR ships the substrate.

import { newMissionId } from './mission.js';
import type { Mission } from './mission.js';
import type {
  ShowroomLaneCallable,
  ShowroomLaneOutput,
} from './surfaces/showroom-surface.js';

/** Persona row loaded from `~/.elanous/personas/mission-<tag>/<role>.yaml`.
 *  The loader is injected — this module does not pin a YAML lib. Tests
 *  pass an in-memory loader; production wires `yaml.parse(readFileSync)`. */
export interface MissionPersona {
  /** Free-form role label (`architect-claude`, `implementer-codex`, ...). */
  role: string;
  /** Mission tag this persona belongs to (`frontend`, `ops`, ...). */
  missionTag: string;
  /** Lane system prompt — surfaces in the deliberation prompt verbatim. */
  systemPrompt: string;
  /** Model pin. Defaults to `qwen-7b` when the loader returns no pin. */
  model?: string;
}

export interface MissionPersonaLoader {
  /** Resolve up to 3 personas for the given mission tag. The loader is
   *  responsible for caching + filesystem access; this module never
   *  touches disk. Return `[]` for tags with no personas — the room
   *  falls back to a single default lane. */
  loadForMissionTag(tag: string): Promise<MissionPersona[]>;
}

/** Lifecycle state of a mission deliberation room. The room sticks
 *  around even after archive so the audit log can be re-rendered. */
export type MissionRoomStatus = 'active' | 'archived';

export interface MissionRoomState {
  missionId: string;
  /** Same value as `Mission.showroomSessionId` after `spawn` runs. */
  showroomSessionId: string;
  missionTag: string;
  status: MissionRoomStatus;
  spawnedAt: number;
  archivedAt?: number;
  /** Append-only decision log — each entry is one round of deliberation. */
  decisions: MissionRoomDecision[];
}

export interface MissionRoomDecision {
  ts: number;
  /** Short summary of the question the user broadcast to the lanes. */
  question: string;
  /** One opinion per persona, in lane execution order. */
  opinions: Array<{ role: string; modelId?: string; text: string }>;
  /** When the user applied a decision back to the mission, the kind of
   *  resolution. Unresolved entries (`status: 'open'`) are still useful
   *  for audit replay. */
  resolution: { status: 'open' } | { status: 'decided'; chosen: string };
}

export interface MissionRoomStore {
  load(missionId: string): Promise<MissionRoomState | null>;
  save(state: MissionRoomState): Promise<void>;
}

/** Lightweight in-memory store. Production wires to `~/.elanous/missions/
 *  <id>/showroom.json` (snapshot) + `audit.jsonl` (append-only). */
export function createInMemoryMissionRoomStore(): MissionRoomStore & {
  snapshot(): ReadonlyMap<string, MissionRoomState>;
} {
  const map = new Map<string, MissionRoomState>();
  return {
    async load(missionId) { return map.get(missionId) ?? null; },
    async save(state) { map.set(state.missionId, structuredClone(state)); },
    snapshot() { return map; },
  };
}

export interface MissionRoomDeps {
  laneCallable: ShowroomLaneCallable;
  personaLoader: MissionPersonaLoader;
  store: MissionRoomStore;
  /** Mint a fresh showroom session id when the mission has none. */
  mintSessionId?: () => string;
  now?: () => number;
}

const DEFAULT_FALLBACK_PERSONA: MissionPersona = {
  role: 'mission-advisor',
  missionTag: 'default',
  systemPrompt:
    'You are the mission deliberation advisor. Reason over the mission ' +
    'state and produce a short balanced take.',
  model: 'qwen-7b',
};

function defaultSessionId(): string {
  // Reuse the mission id minter — Mission entity id has the same shape
  // pattern (`mission:<hex>`) which is what the URL `?show=` expects.
  return newMissionId().replace('mission:', 'showroom:mission-');
}

/** Idempotent spawn. When the mission already has `showroomSessionId`
 *  set AND the store knows about it, return the persisted state. When
 *  one or the other is missing, allocate / refresh the state and
 *  return the (sometimes re-linked) Mission alongside it. */
export async function spawnMissionRoom(
  mission: Mission,
  deps: MissionRoomDeps,
  opts?: { missionTag?: string },
): Promise<{ mission: Mission; state: MissionRoomState }> {
  const now = (deps.now ?? Date.now)();
  const mintId = deps.mintSessionId ?? defaultSessionId;

  const missionTag = opts?.missionTag ?? inferMissionTag(mission);
  const existingId = mission.showroomSessionId;
  const persisted = existingId ? await deps.store.load(mission.id) : null;

  if (persisted && persisted.status === 'active') {
    // Active room exists — return as-is. The caller can run a new
    // deliberation round via `runMissionDeliberation`.
    return { mission, state: persisted };
  }
  if (persisted && persisted.status === 'archived') {
    // Re-opening an archived room is a deliberate user action; flip
    // the status back to active and bump `spawnedAt`. The decision
    // log is preserved for provenance.
    const reopened: MissionRoomState = {
      ...persisted,
      status: 'active',
      spawnedAt: now,
      ...(persisted.archivedAt !== undefined ? { archivedAt: undefined } : {}),
    };
    await deps.store.save(reopened);
    return { mission, state: reopened };
  }

  const sessionId = existingId ?? mintId();
  const state: MissionRoomState = {
    missionId: mission.id,
    showroomSessionId: sessionId,
    missionTag,
    status: 'active',
    spawnedAt: now,
    decisions: [],
  };
  await deps.store.save(state);
  const nextMission: Mission = existingId
    ? mission
    : { ...mission, showroomSessionId: sessionId, updatedAt: now };
  return { mission: nextMission, state };
}

/** Archive an active room. Idempotent on already-archived rooms; throws
 *  when the mission has no persisted room. */
export async function archiveMissionRoom(
  mission: Mission,
  deps: MissionRoomDeps,
): Promise<MissionRoomState> {
  const state = await deps.store.load(mission.id);
  if (!state) {
    throw new Error(`mission room not found: ${mission.id}`);
  }
  if (state.status === 'archived') return state;
  const now = (deps.now ?? Date.now)();
  const archived: MissionRoomState = { ...state, status: 'archived', archivedAt: now };
  await deps.store.save(archived);
  return archived;
}

export interface MissionDeliberationInput {
  /** The user-broadcast question / branch decision the lanes reason over. */
  question: string;
  /** Optional mission summary the lanes can see (task list digest, etc.). */
  missionContext?: string;
}

export async function runMissionDeliberation(
  mission: Mission,
  input: MissionDeliberationInput,
  deps: MissionRoomDeps,
): Promise<MissionRoomDecision> {
  const state = await deps.store.load(mission.id);
  if (!state) throw new Error(`mission room not found: ${mission.id}`);
  if (state.status === 'archived') {
    throw new Error(`mission room archived (read-only): ${mission.id}`);
  }

  const personas = await deps.personaLoader.loadForMissionTag(state.missionTag);
  const lanes = personas.length > 0 ? personas.slice(0, 3) : [DEFAULT_FALLBACK_PERSONA];
  const outputs: Array<{ persona: MissionPersona; out: ShowroomLaneOutput }> = [];

  for (const persona of lanes) {
    const out = await deps.laneCallable({
      role: 'plan',
      model: persona.model ?? 'qwen-7b',
      prompt: buildLanePrompt(mission, state, persona, input),
      systemPrompt: persona.systemPrompt,
    });
    outputs.push({ persona, out });
  }

  const now = (deps.now ?? Date.now)();
  const decision: MissionRoomDecision = {
    ts: now,
    question: input.question.trim().slice(0, 1024),
    opinions: outputs.map(({ persona, out }) => ({
      role: persona.role,
      ...(out.modelId ? { modelId: out.modelId } : {}),
      text: out.text,
    })),
    resolution: { status: 'open' },
  };

  const nextState: MissionRoomState = {
    ...state,
    decisions: [...state.decisions, decision],
  };
  await deps.store.save(nextState);
  return decision;
}

/** Stamp a resolution (`decided`) on the most recent open decision.
 *  The caller passes the chosen option label; the audit row's
 *  `resolution` flips to `{ status: 'decided', chosen }`. */
export async function applyMissionDecision(
  missionId: string,
  chosen: string,
  deps: MissionRoomDeps,
): Promise<MissionRoomDecision | null> {
  const state = await deps.store.load(missionId);
  if (!state) throw new Error(`mission room not found: ${missionId}`);
  const idx = lastOpenDecisionIndex(state.decisions);
  if (idx < 0) return null;
  const next = state.decisions.slice();
  const target = next[idx]!;
  next[idx] = { ...target, resolution: { status: 'decided', chosen } };
  await deps.store.save({ ...state, decisions: next });
  return next[idx]!;
}

function lastOpenDecisionIndex(decisions: MissionRoomDecision[]): number {
  for (let i = decisions.length - 1; i >= 0; i--) {
    if (decisions[i]!.resolution.status === 'open') return i;
  }
  return -1;
}

function buildLanePrompt(
  mission: Mission,
  state: MissionRoomState,
  persona: MissionPersona,
  input: MissionDeliberationInput,
): string {
  return [
    `You speak as "${persona.role}" in mission ${mission.id} (${mission.title}).`,
    `Mission tag: ${state.missionTag}.`,
    mission.intent ? `User intent: ${mission.intent}` : '',
    input.missionContext ? `Mission context:\n${input.missionContext}` : '',
    '',
    `Question to deliberate:`,
    input.question,
    '',
    'Reply in 3-5 short lines. Lead with your stance, then the reasoning ' +
      'specific to this persona\'s lens.',
  ].filter(Boolean).join('\n');
}

/** Cheap heuristic — production loader can override this by passing
 *  `opts.missionTag` to `spawnMissionRoom`. The default scans the
 *  mission title + intent for known tag keywords; falls back to
 *  `default` so the loader still has a directory to look in. */
export function inferMissionTag(mission: Mission): string {
  const haystack = `${mission.title} ${mission.intent ?? ''}`.toLowerCase();
  const candidates: Array<[string, string[]]> = [
    ['frontend', ['frontend', 'pwa', 'react', 'css', 'ui ', 'tailwind']],
    ['backend',  ['backend', 'api', 'server', 'daemon', 'database', 'sqlite']],
    ['ops',      ['ops', 'deploy', 'infra', 'ci/cd', 'release', 'monitoring']],
    ['research', ['research', 'investigate', 'survey', 'spike']],
    ['writing',  ['doc', 'docs', 'write up', 'blog', 'article']],
  ];
  for (const [tag, keywords] of candidates) {
    for (const k of keywords) {
      if (haystack.includes(k)) return tag;
    }
  }
  return 'default';
}
