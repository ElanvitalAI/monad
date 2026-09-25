// Showroom v2 · Lane token parser.
//
// Grammar (PLAN §D2):
//   lane-token := role ':' provider [':' transport]
//               | provider [':' transport]              # role omitted
//               | 'auto' [':' role]                     # legacy compat
//
// Examples:
//   plan:claude               → { role:'plan', brandRef:'claude' }
//   plan:claude:acp           → { role:'plan', brandRef:'claude', transportPref:'acp' }
//   build:lll:llama3          → { role:'build', brandRef:'lll:llama3' }
//   build:lll:llama3:pty      → { role:'build', brandRef:'lll:llama3', transportPref:'pty' }
//   codex                     → { brandRef:'codex' }
//   codex:acp                 → { brandRef:'codex', transportPref:'acp' }
//   auto:plan                 → { brandRef:'auto', role:'plan' }   (legacy)
//
// `--focus <idx>` is preserved at the tail like the parent
// `parseComposeTokens` — this parser only consumes positional
// lane-tokens.

import { debug } from '../debug/log.js';
import {
  isLaneRole,
  isLaneTransportPref,
  type LaneRole,
  type LaneSpec,
  type LaneTransportPref,
  type SurfacePref,
} from './lane-spec.js';

export interface ParsedLaneTokens {
  readonly lanes: readonly LaneSpec[];
  readonly focusIndex?: number;
  /** Arc 4 (2026-04-28) · `--auto-relay` flag stripped from positional
   *  tokens · forwarded to the showroom composer to start the watcher. */
  readonly autoRelay?: boolean;
  /** Sprint 21 M1.1 (2026-05-01) · `--surface <kind>:<id>` flag.
   *  Routes lane output to a non-TUI surface (Discord channel via
   *  webhook persona adapter). v1 supports `discord:<channelId>` only. */
  readonly surfacePref?: SurfacePref;
  readonly error?: string;
}

/** Split tokens into positional lane-tokens + `--focus N` tail +
 *  optional `--auto-relay` flag (Arc 4). Returns parsed lane specs or
 *  an error string for surfacing. */
export function parseLaneTokens(
  rawTokens: readonly string[],
): ParsedLaneTokens {
  if (rawTokens.length === 0) return { lanes: [] };

  // Strip --auto-relay (Arc 4 · 2026-04-28) before further parsing.
  // It's a boolean flag with no value · can appear anywhere.
  let working: string[] = [...rawTokens];
  let autoRelay = false;
  const arIdx = working.findIndex((tok) => tok === '--auto-relay');
  if (arIdx !== -1) {
    autoRelay = true;
    working.splice(arIdx, 1);
  }

  // Strip --surface <kind>:<id> (Sprint 21 M1.1 · 2026-05-01).
  // Two-token flag · can appear anywhere · v1 only `discord:<channelId>`.
  let surfacePref: SurfacePref | undefined;
  const surfaceIdx = working.findIndex((tok) => tok === '--surface');
  if (surfaceIdx !== -1) {
    const valueRaw = working[surfaceIdx + 1];
    if (valueRaw === undefined) {
      return { lanes: [], error: '/showroom: `--surface` requires a value (e.g., `discord:1234567890`)' };
    }
    const parsed = parseSurfaceValue(valueRaw);
    if ('error' in parsed) return { lanes: [], error: parsed.error };
    surfacePref = parsed.surface;
    working.splice(surfaceIdx, 2);
  }

  if (working.length === 0) {
    const tail: ParsedLaneTokens = { lanes: [] };
    if (autoRelay) (tail as { autoRelay?: boolean }).autoRelay = true;
    if (surfacePref) (tail as { surfacePref?: SurfacePref }).surfacePref = surfacePref;
    return tail;
  }

  const focusFlagIdx = working.findIndex((tok) => tok === '--focus');
  let positional: readonly string[];
  let focusIndex: number | undefined;
  if (focusFlagIdx === -1) {
    positional = working;
  } else {
    if (working.length !== focusFlagIdx + 2) {
      return { lanes: [], error: '/showroom: use `--focus <idx>` once at the end' };
    }
    const focusRaw = working[focusFlagIdx + 1];
    const num = Number(focusRaw);
    if (!Number.isInteger(num)) {
      return {
        lanes: [],
        error: `/showroom: focus index must be an integer · got '${String(focusRaw ?? '')}'`,
      };
    }
    focusIndex = num;
    positional = working.slice(0, focusFlagIdx);
  }

  const lanes: LaneSpec[] = [];
  for (let i = 0; i < positional.length; i++) {
    const tok = positional[i]!;
    const parsed = parseSingleLaneToken(tok, i);
    if ('error' in parsed) return { lanes: [], error: parsed.error };
    lanes.push(parsed.spec);
  }

  if (debug.enabled) {
    debug.log('showroom.lane.parse', `tokens=${positional.length}`, {
      lanes: lanes.map((l) => ({
        role: l.role, brandRef: l.brandRef, transportPref: l.transportPref,
      })),
      focusIndex,
    });
  }

  return {
    lanes,
    ...(focusIndex !== undefined ? { focusIndex } : {}),
    ...(autoRelay ? { autoRelay: true } : {}),
    ...(surfacePref ? { surfacePref } : {}),
  };
}

/** Parse `--surface <kind>:<id>` value. v1: `discord:<channelId>` only.
 *  channelId is the Discord snowflake (numeric string). */
function parseSurfaceValue(raw: string): { surface: SurfacePref } | { error: string } {
  const colon = raw.indexOf(':');
  if (colon < 1 || colon === raw.length - 1) {
    return { error: `/showroom: --surface value must be 'kind:id' (e.g., 'discord:1234567890') · got '${raw}'` };
  }
  const kind = raw.slice(0, colon).toLowerCase();
  const id = raw.slice(colon + 1).trim();
  if (!id) {
    return { error: `/showroom: --surface id is empty in '${raw}'` };
  }
  if (kind === 'discord') {
    return { surface: { kind: 'discord', channelId: id } };
  }
  return { error: `/showroom: --surface kind '${kind}' not supported · v1 = 'discord' only` };
}

function parseSingleLaneToken(
  tok: string,
  pos: number,
): { spec: LaneSpec } | { error: string } {
  if (!tok || !tok.trim()) {
    return { error: `/showroom: lane[${pos}] is empty` };
  }
  const lower = tok.toLowerCase();

  // Legacy `auto:plan` shape — keep brand-resolver compatibility.
  if (lower === 'auto') return { spec: { brandRef: 'auto' } };
  if (lower.startsWith('auto:')) {
    const tail = lower.slice(5);
    if (isLaneRole(tail)) {
      return { spec: { brandRef: 'auto', role: tail as LaneRole } };
    }
    return {
      error: `/showroom: lane[${pos}] · '${tok}' role must be one of plan|build|exec|review|reflect`,
    };
  }

  // Multi-segment `role:provider[:transport]` or `provider[:transport]`.
  // Tricky case: `lll:<model>` itself contains a colon. Heuristic:
  //   - if first segment is a known role → role:provider[:transport?]
  //   - else if first segment is `lll` → entire token through last
  //     `:transport?` is the brandRef
  //   - else → provider[:transport]
  const segs = tok.split(':');
  if (segs.length === 1) {
    return { spec: { brandRef: tok } };
  }

  const head = segs[0]!.toLowerCase();
  if (isLaneRole(head)) {
    // role:provider[:...]
    const role = head as LaneRole;
    const rest = segs.slice(1);
    if (rest.length === 0) {
      return { error: `/showroom: lane[${pos}] · role '${head}' has no provider` };
    }
    return parseProviderTail(rest, pos, role);
  }

  // No role — entire token is provider[:transport]
  return parseProviderTail(segs, pos, undefined);
}

function parseProviderTail(
  segs: readonly string[],
  pos: number,
  role: LaneRole | undefined,
): { spec: LaneSpec } | { error: string } {
  if (segs.length === 0 || !segs[0]!.trim()) {
    return { error: `/showroom: lane[${pos}] · empty provider` };
  }
  const firstLower = segs[0]!.toLowerCase();

  // `lll:<model>[:transport]` — provider has 2 segments.
  if (firstLower === 'lll') {
    if (segs.length < 2) {
      return { error: `/showroom: lane[${pos}] · 'lll' requires '<model>' suffix` };
    }
    const model = segs[1]!;
    if (!model.trim()) {
      return { error: `/showroom: lane[${pos}] · empty local-llm model` };
    }
    const brandRef = `lll:${model}`;
    if (segs.length === 2) {
      return { spec: role ? { role, brandRef } : { brandRef } };
    }
    if (segs.length === 3) {
      const tr = segs[2]!.toLowerCase();
      if (!isLaneTransportPref(tr)) {
        return {
          error: `/showroom: lane[${pos}] · transport must be pty|acp|auto · got '${segs[2]}'`,
        };
      }
      return { spec: buildSpec(role, brandRef, tr as LaneTransportPref) };
    }
    return { error: `/showroom: lane[${pos}] · too many ':' segments in '${segs.join(':')}'` };
  }

  // Plain `provider` or `provider:transport`.
  if (segs.length === 1) {
    return { spec: role ? { role, brandRef: segs[0]! } : { brandRef: segs[0]! } };
  }
  if (segs.length === 2) {
    const tr = segs[1]!.toLowerCase();
    if (!isLaneTransportPref(tr)) {
      return {
        error: `/showroom: lane[${pos}] · transport must be pty|acp|auto · got '${segs[1]}'`,
      };
    }
    return { spec: buildSpec(role, segs[0]!, tr as LaneTransportPref) };
  }
  return { error: `/showroom: lane[${pos}] · unrecognized token '${segs.join(':')}'` };
}

function buildSpec(
  role: LaneRole | undefined,
  brandRef: string,
  transportPref: LaneTransportPref,
): LaneSpec {
  if (role) return { role, brandRef, transportPref };
  return { brandRef, transportPref };
}
