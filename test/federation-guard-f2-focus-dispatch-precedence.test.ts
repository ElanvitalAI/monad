// F2 enforcement (Federation invariant from REQUIREMENTS §5):
//   "Focus implies dispatch precedence — the focused surface gets
//    first crack at every event in its scope."
//
// "In its scope" semantics in monad-agent (audit-confirmed
// 2026-05-03): `coord.routeKey` / `coord.routeKeyAsync` walk a
// 4-level fall-through chain:
//
//   1. focused modal       (topFocusedSurface('modal'))
//   2. focused execution   (activeSurfaceInScope('execution'))
//   3. global active       (focusManager.active())
//   4. chord / global keybindings
//
// Each level only fires if the previous level returned null/
// passthrough. The first three are all focus-derived; only the
// fourth touches the global keybinding registry. F2 says the
// focused surface MUST get first crack — which means level 1
// runs BEFORE level 4 (the global registry). Any future change
// that hoists global bindings above focused dispatch silently
// breaks F2.
//
// This guard pins the rule with a structural source-pattern check
// + two behavioral cases:
//
// 1. `routeKey` / `routeKeyAsync` bodies: focused-modal dispatch and
//    `focusManager.active()` both appear before helper-based global
//    keybinding lookup. The helpers themselves must still traverse
//    `keyBindings`.
// 2. focused modal returning 'consumed' wins over a global
//    keybinding that would also match — focus-first.
// 3. focused modal returning 'passthrough' falls through to the
//    global keybinding — focus first, but doesn't hijack.
//
// PLAN ref: 내부 문서 `PLAN-substrate-rebuild-2026-05-03` §7
// REQUIREMENTS ref: 내부 문서 `REQUIREMENTS-substrate-occam-2026-05-03` §5 F2

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

import { DisplayCoordinator } from '../src/display/index.js';
import type { SurfaceId } from '../src/display/index.js';
import type { ModalSurface, ModalBounds } from '../src/display/modal-stack.js';
import type { ModalTier } from '../src/display/types.js';

const ROOT = process.cwd();

function harness(): { coord: DisplayCoordinator; flush: () => void } {
  const scheduled: Array<() => void> = [];
  const coord = new DisplayCoordinator({
    frameMs: 16,
    schedule: ((fn: () => void) => {
      scheduled.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>,
    onRender: () => { /* no-op */ },
  });
  const flush = (): void => {
    while (scheduled.length > 0) {
      const fn = scheduled.shift();
      fn?.();
    }
  };
  return { coord, flush };
}

function makeModal(opts: {
  id: string;
  tier?: ModalTier;
  bounds?: ModalBounds;
  focus?: 'owns' | 'participates' | 'none';
  onKey?: ModalSurface['onKey'];
}): ModalSurface {
  return {
    id: opts.id as SurfaceId,
    owner: 'dashboard',
    kind: 'modal',
    tier: opts.tier ?? 'popup',
    focus: opts.focus ?? 'owns',
    priority: 200,
    bounds: opts.bounds ?? { row: 1, col: 1, width: 20, height: 10 },
    interactiveBounds: opts.bounds ?? { row: 1, col: 1, width: 20, height: 10 },
    occluding: false,
    render: () => [],
    paint: () => '',
    onKey: opts.onKey,
  };
}

function extractFunctionBody(source: string, name: string): string | null {
  const lines = source.split('\n');
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    if (/^\s*\*/.test(ln) || /^\s*\/\//.test(ln) || /^\s*\/\*/.test(ln)) continue;
    // Match `name(` or `async name(` for class methods.
    if (new RegExp(`(^|\\s)(async\\s+)?${name}\\s*\\(`).test(ln)) {
      const head = lines.slice(i, Math.min(lines.length, i + 5)).join('\n');
      if (head.includes('{')) {
        startIdx = i;
        break;
      }
    }
  }
  if (startIdx < 0) return null;

  let depth = 0;
  let bodyStart = -1;
  let bodyEnd = -1;
  for (let i = startIdx; i < lines.length; i++) {
    const ln = lines[i]!;
    for (const ch of ln) {
      if (ch === '{') {
        if (depth === 0) bodyStart = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          bodyEnd = i;
          break;
        }
      }
    }
    if (bodyEnd >= 0) break;
  }
  if (bodyStart < 0 || bodyEnd < 0) return null;
  return lines.slice(bodyStart, bodyEnd + 1).join('\n');
}

function indexOfPattern(body: string, pattern: RegExp): number {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i]!)) return i;
  }
  return -1;
}

function requirePatternIndex(body: string, name: string, pattern: RegExp): number {
  const index = indexOfPattern(body, pattern);
  if (index < 0) {
    throw new Error(`${name} pattern not found in coordinator.ts — guard out of sync`);
  }
  return index;
}

function assertFocusedDispatchPrecedesKeybindingHelpers(routeName: 'routeKey' | 'routeKeyAsync'): void {
  const source = readFileSync(COORDINATOR_PATH, 'utf8');
  const body = extractFunctionBody(source, routeName);
  if (!body) {
    throw new Error(`${routeName} body not found in coordinator.ts — guard out of sync`);
  }
  const modalIdx = requirePatternIndex(
    body,
    `${routeName} focused-modal dispatch`,
    /topFocusedSurface\s*\(\s*['"]modal['"]/,
  );
  const activeFocusIdx = requirePatternIndex(
    body,
    `${routeName} active-focus dispatch`,
    /this\.focusManager\.active\s*\(\s*\)/,
  );
  const chordHelperIdx = requirePatternIndex(
    body,
    `${routeName} chord keybinding helper call`,
    /this\.resolveChordKey\s*\(/,
  );
  const singleKeyHelperIdx = requirePatternIndex(
    body,
    `${routeName} single-key keybinding helper call`,
    /this\.matchSingleKeyBinding\s*\(/,
  );

  if (modalIdx >= activeFocusIdx || activeFocusIdx >= chordHelperIdx || activeFocusIdx >= singleKeyHelperIdx) {
    throw new Error(
      `F2 violation in ${routeName}: focused dispatch must precede global keybinding helper calls `
      + `(modal line ${modalIdx + 1}, active-focus line ${activeFocusIdx + 1}, `
      + `chord line ${chordHelperIdx + 1}, single-key line ${singleKeyHelperIdx + 1}). `
      + 'See REQUIREMENTS §5 F2.',
    );
  }
}

function assertKeybindingHelpersTraverseRegistry(): void {
  const source = readFileSync(COORDINATOR_PATH, 'utf8');
  for (const helperName of ['resolveChordKey', 'matchSingleKeyBinding']) {
    const body = extractFunctionBody(source, helperName);
    if (!body) {
      throw new Error(`${helperName} body not found in coordinator.ts — guard out of sync`);
    }
    requirePatternIndex(body, `${helperName} keybinding registry traversal`, /this\.keyBindings\.values\s*\(/);
  }
}

const COORDINATOR_PATH = join(ROOT, 'src/display/coordinator.ts');

describe('F2 federation guard · focus implies dispatch precedence', () => {
  test('routeKey body: focused dispatch precedes helper-based global keybinding lookup', () => {
    assertFocusedDispatchPrecedesKeybindingHelpers('routeKey');
  });

  test('routeKeyAsync body: focused dispatch precedes helper-based global keybinding lookup', () => {
    assertFocusedDispatchPrecedesKeybindingHelpers('routeKeyAsync');
  });

  test('keybinding helper bodies traverse the global keybinding registry', () => {
    assertKeybindingHelpersTraverseRegistry();
  });

  test('behavioral · focused modal returning consumed wins over global keybinding', () => {
    // Setup: register a global keybinding for `Ctrl+P`. Then push
    // a focused modal whose onKey consumes Ctrl+P. routeKey must
    // route to the modal first; the binding handler must NEVER
    // fire. Forward-walking or a "registry-first" reordering would
    // hit the binding instead — that's the regression.
    const { coord, flush } = harness();
    let bindingFired = 0;
    coord.registerKeyBinding({
      id: 'f2-test-ctrl-p',
      key: 'C-p',
      scope: 'global',
      handler: () => { bindingFired++; },
    });

    const recorded: { received: string | null } = { received: null };
    const modal = makeModal({
      id: 'f2-modal',
      onKey: (ev) => {
        recorded.received = (ev as { name?: string }).name ?? null;
        return 'consumed';
      },
    });
    coord.pushModal(modal);
    flush();

    const res = coord.routeKey({ name: 'p', ctrl: true, shift: false } as never);
    // Focused modal consumed → result is the modal's action,
    // never the binding.
    expect(recorded.received).toBe('p');
    expect(bindingFired).toBe(0);
    // routeKey returned a non-passthrough route (the modal action).
    expect(res.type).not.toBe('passthrough');
  });

  test('behavioral · focused modal returning passthrough falls through to global keybinding', () => {
    // Conjugate of the previous case: focused-first does not mean
    // focused-only. If the modal explicitly passes the key
    // through, the next dispatch level (and eventually the global
    // binding) must be tried. This proves F2 is "first crack",
    // not "exclusive ownership".
    const { coord, flush } = harness();
    let bindingFired = 0;
    coord.registerKeyBinding({
      id: 'f2-passthrough-ctrl-q',
      key: 'C-q',
      scope: 'global',
      handler: () => { bindingFired++; },
    });

    let modalSawKey = false;
    const modal = makeModal({
      id: 'f2-modal-passthrough',
      onKey: () => { modalSawKey = true; return 'passthrough'; },
    });
    coord.pushModal(modal);
    flush();

    const res = coord.routeKey({ name: 'q', ctrl: true, shift: false } as never);
    expect(modalSawKey).toBe(true);
    // Modal returned passthrough → fall through path runs the
    // global binding eventually.
    expect(res.type === 'handler' || res.type === 'command').toBe(true);
  });

  test('behavioral · no focused modal · global keybinding fires (focus precedence is conditional, not absolute)', () => {
    // Negative complement: when there is NO focused modal, the
    // global binding is the rightful winner. Confirms the guard
    // doesn't accidentally over-enforce by always returning
    // focused even when no focus exists.
    const { coord } = harness();
    let bindingFired = 0;
    coord.registerKeyBinding({
      id: 'f2-no-focus-ctrl-r',
      key: 'C-r',
      scope: 'global',
      handler: () => { bindingFired++; },
    });

    const res = coord.routeKey({ name: 'r', ctrl: true, shift: false } as never);
    // No focused modal → routeKey walks past levels 1-3 and lands
    // on the binding registry.
    expect(res.type === 'handler' || res.type === 'command').toBe(true);
  });
});
