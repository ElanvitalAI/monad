// F-B5a — Scenario → YAML serializer.
//
// Inverse of `parseScenarioYaml`. Produces stable, human-editable
// YAML so `/playground edit` can load an existing scenario into the
// reactive editor and round-trip through `/playground save`.
//
// Design:
//   • Deterministic key ordering (id, title, description, tags,
//     setup, steps) so serialized output is diff-friendly.
//   • Leans on `yaml` package's `stringify` but with an explicit
//     `sortMapEntries` replacement, because the default sorts
//     alphabetically (title < id) and that's awful for readers.
//   • Round-trip guarantee: `parseScenarioYaml(serialize(s)).scenario`
//     should deep-equal the input for any scenario that parses
//     cleanly. Tests enforce this on every DEFAULT_SCENARIO.

import { stringify as yamlStringify } from 'yaml';

import type { Scenario } from './types.js';

// Declared field order — anything not listed falls through to
// alphabetical at the end (rare in practice since the Scenario
// type is closed).
const SCENARIO_KEY_ORDER = ['id', 'title', 'description', 'tags', 'setup', 'steps'] as const;
const SETUP_KEY_ORDER = ['theme', 'contextKeys', 'mount'] as const;
const MOUNT_KEY_ORDER = ['id', 'kind', 'props', 'layout'] as const;
const STEP_KEY_ORDER = [
  'action', 'event', 'target', 'button', 'message', 'name',
  'key', 'value', 'modalId', 'ms',
] as const;
const CLICK_TARGET_KEY_ORDER = ['kind', 'componentId', 'subId', 'hitTarget', 'row', 'col'] as const;
const EXPECT_TARGET_KEY_ORDER = [
  'kind', 'id', 'componentId', 'key', 'value', 'length', 'substring',
] as const;

export function serializeScenarioToYaml(scenario: Scenario): string {
  const ordered = reorder(scenario as unknown as Record<string, unknown>, SCENARIO_KEY_ORDER);
  if (ordered.setup && typeof ordered.setup === 'object') {
    ordered.setup = reorder(ordered.setup as Record<string, unknown>, SETUP_KEY_ORDER);
    const setup = ordered.setup as Record<string, unknown>;
    if (Array.isArray(setup.mount)) {
      setup.mount = (setup.mount as Array<Record<string, unknown>>).map(m =>
        reorder(m, MOUNT_KEY_ORDER),
      );
    }
  }
  if (Array.isArray(ordered.steps)) {
    ordered.steps = (ordered.steps as Array<Record<string, unknown>>).map(reorderStep);
  }

  return yamlStringify(ordered, {
    indent: 2,
    lineWidth: 100,
    // Preserve the key order we produced; don't re-sort.
    sortMapEntries: false,
  });
}

function reorderStep(step: Record<string, unknown>): Record<string, unknown> {
  const out = reorder(step, STEP_KEY_ORDER);
  if (out.target && typeof out.target === 'object') {
    const t = out.target as Record<string, unknown>;
    if (step.action === 'click') {
      out.target = reorder(t, CLICK_TARGET_KEY_ORDER);
    } else if (step.action === 'expect') {
      out.target = reorder(t, EXPECT_TARGET_KEY_ORDER);
    }
  }
  return out;
}

function reorder<T extends Record<string, unknown>>(
  obj: T,
  order: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of order) {
    if (k in obj && obj[k] !== undefined) out[k] = obj[k];
  }
  for (const k of Object.keys(obj)) {
    if (!out.hasOwnProperty(k) && obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}
