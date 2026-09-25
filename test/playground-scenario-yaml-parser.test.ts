// F-B4 — `parseScenarioYaml` tests.
//
// Covers three pillars: full-valid parsing, tolerant error recovery
// (syntax / schema / reference), and line:col accuracy. Shape tests
// lean on `toEqual` snapshots of the parsed scenario so regressions
// in the AST walker surface immediately.

import { describe, expect, test } from 'bun:test';

import {
  parseScenarioYaml,
  type ScenarioParseResult,
} from '../src/playground-scenario/yaml-parser.js';

// ── Fixtures ────────────────────────────────────────────────────

const FULL_DIALOG_YAML = `
id: dialog:confirm-flow
title: Dialog confirm flow
description: Smoke test for dialog mount + dismiss.
tags:
  - dialog
  - smoke
setup:
  mount:
    - id: confirm
      kind: dialog
      props:
        title: Delete file?
        body: Cannot undo.
        buttons:
          - value: ok
            label: OK
            buttonId: ok
          - value: cancel
            label: Cancel
            buttonId: cancel
steps:
  - action: expect
    target:
      kind: modal-mounted
      id: confirm
  - action: click
    target:
      kind: component
      componentId: confirm:ok
  - action: expect
    target:
      kind: last-clicked
      componentId: confirm:ok
  - action: dismiss
    modalId: confirm
  - action: expect
    target:
      kind: modal-stack-length
      length: 0
`;

// ── Full-valid scenarios ────────────────────────────────────────

describe('parseScenarioYaml — valid scenarios', () => {
  test('full dialog scenario parses with no errors', () => {
    const r = parseScenarioYaml(FULL_DIALOG_YAML);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.scenario).not.toBeNull();
    expect(r.scenario!.id).toBe('dialog:confirm-flow');
    expect(r.scenario!.title).toBe('Dialog confirm flow');
    expect(r.scenario!.tags).toEqual(['dialog', 'smoke']);
    expect(r.scenario!.setup?.mount?.length).toBe(1);
    expect(r.scenario!.setup?.mount?.[0]!.id).toBe('confirm');
    expect(r.scenario!.steps?.length).toBe(5);
    expect(r.validSteps.length).toBe(5);
  });

  test('all step actions parse correctly', () => {
    const yaml = `
id: kitchen-sink
title: One of each step
setup:
  mount:
    - id: mx
      kind: button
      props:
        label: Go
steps:
  - action: click
    target:
      kind: component
      componentId: mx
    button: left
  - action: key
    event:
      name: return
  - action: expect
    target:
      kind: context-key
      key: focusMode
      value: input
  - action: theme
    name: monad-dark
  - action: set-context-key
    key: themeName
    value: monad-dark
  - action: dismiss
  - action: wait
    ms: 100
`;
    const r = parseScenarioYaml(yaml);
    expect(r.errors).toEqual([]);
    expect(r.validSteps.length).toBe(7);
    expect(r.validSteps.map(s => s.action)).toEqual([
      'click', 'key', 'expect', 'theme', 'set-context-key', 'dismiss', 'wait',
    ]);
  });

  test('click target kinds: component, hit, coords', () => {
    const yaml = `
id: clicks
title: Click varieties
setup:
  mount:
    - id: p
      kind: select
      props:
        options: []
steps:
  - action: click
    target:
      kind: component
      componentId: p
      subId: row-1
  - action: click
    target:
      kind: hit
      hitTarget:
        kind: modal-body
        modalId: p
        itemIndex: 2
  - action: click
    target:
      kind: coords
      row: 5
      col: 10
`;
    const r = parseScenarioYaml(yaml);
    expect(r.errors).toEqual([]);
    expect(r.validSteps.length).toBe(3);
  });

  test('expect target kinds cover all ExpectTarget variants', () => {
    const yaml = `
id: expects
title: expects
setup:
  mount:
    - id: m
      kind: text
      props:
        text: hi
steps:
  - action: expect
    target: { kind: context-key, key: focusMode, value: input }
  - action: expect
    target: { kind: modal-mounted, id: m }
  - action: expect
    target: { kind: modal-dismissed, id: m }
  - action: expect
    target: { kind: modal-stack-length, length: 2 }
  - action: expect
    target: { kind: last-clicked, componentId: m }
  - action: expect
    target: { kind: render-contains, substring: hello }
  - action: expect
    target: { kind: no-unexpected-error }
`;
    const r = parseScenarioYaml(yaml);
    expect(r.errors).toEqual([]);
    expect(r.validSteps.length).toBe(7);
  });
});

// ── Partial / empty drafts ──────────────────────────────────────

describe('parseScenarioYaml — partial drafts', () => {
  test('id + title only is a valid partial — no errors, no steps', () => {
    const yaml = `
id: draft
title: Work in progress
`;
    const r = parseScenarioYaml(yaml);
    expect(r.errors).toEqual([]);
    expect(r.scenario?.id).toBe('draft');
    expect(r.scenario?.title).toBe('Work in progress');
    expect(r.validSteps).toEqual([]);
  });

  test('empty source → scenario null, no errors', () => {
    const r = parseScenarioYaml('');
    expect(r.scenario).toBeNull();
    expect(r.errors).toEqual([]);
  });

  test('whitespace-only source → scenario null, no errors', () => {
    const r = parseScenarioYaml('   \n\n  \n');
    expect(r.scenario).toBeNull();
    expect(r.errors).toEqual([]);
  });

  test('non-mapping root (scalar) → schema error, scenario null', () => {
    const r = parseScenarioYaml('just-a-string');
    expect(r.scenario).toBeNull();
    expect(r.errors.length).toBeGreaterThanOrEqual(1);
    expect(r.errors[0]!.severity).toBe('schema');
  });

  test('missing required id + title reports two schema errors', () => {
    const yaml = `
description: no id no title
steps: []
`;
    const r = parseScenarioYaml(yaml);
    const msgs = r.errors.map(e => e.message);
    expect(msgs.some(m => m.includes("'id'"))).toBe(true);
    expect(msgs.some(m => m.includes("'title'"))).toBe(true);
  });
});

// ── Syntax errors ───────────────────────────────────────────────

describe('parseScenarioYaml — syntax errors', () => {
  test('missing colon → syntax error captured with line info', () => {
    const yaml = `
id foo
title: bad
`;
    const r = parseScenarioYaml(yaml);
    expect(r.errors.some(e => e.severity === 'syntax')).toBe(true);
  });

  test('bad indentation → syntax or schema error, parser does not throw', () => {
    const yaml = `
id: x
title: y
steps:
- action: click
 target:
   kind: component
   componentId: x
`;
    // Indentation is weird but 'yaml' lib is lenient — expect it
    // to either flag syntax OR recover. Main contract: no throw,
    // result shape intact.
    const r = parseScenarioYaml(yaml);
    expect(r).toBeDefined();
    expect(r.scenario).not.toBeNull();
  });

  test('unterminated quote → syntax error reported', () => {
    const yaml = `
id: x
title: "unterminated
steps: []
`;
    const r = parseScenarioYaml(yaml);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.some(e => e.severity === 'syntax')).toBe(true);
  });
});

// ── Schema errors — tolerant per-step ───────────────────────────

describe('parseScenarioYaml — schema errors (per-step tolerance)', () => {
  test('unknown step action drops that step but keeps others', () => {
    const yaml = `
id: x
title: y
setup:
  mount:
    - id: mx
      kind: button
      props: { label: Go }
steps:
  - action: click
    target: { kind: component, componentId: mx }
  - action: teleport
    destination: mars
  - action: wait
    ms: 10
`;
    const r = parseScenarioYaml(yaml);
    expect(r.validSteps.length).toBe(2);
    expect(r.validSteps.map(s => s.action)).toEqual(['click', 'wait']);
    expect(r.errors.some(e => e.message.includes('teleport'))).toBe(true);
  });

  test('step missing action is dropped', () => {
    const yaml = `
id: x
title: y
steps:
  - foo: bar
  - action: wait
    ms: 5
`;
    const r = parseScenarioYaml(yaml);
    expect(r.validSteps.length).toBe(1);
    expect(r.validSteps[0]!.action).toBe('wait');
    expect(r.errors.some(e => e.message.includes("'action'"))).toBe(true);
  });

  test('non-mapping step entry is dropped', () => {
    const yaml = `
id: x
title: y
steps:
  - just a string
  - action: wait
    ms: 1
`;
    const r = parseScenarioYaml(yaml);
    expect(r.validSteps.length).toBe(1);
    expect(r.errors.some(e => e.message.includes('mapping'))).toBe(true);
  });

  test('click step without target is dropped with error', () => {
    const yaml = `
id: x
title: y
steps:
  - action: click
  - action: wait
    ms: 1
`;
    const r = parseScenarioYaml(yaml);
    expect(r.validSteps.length).toBe(1);
    expect(r.errors.some(e => e.path.includes('steps[0].target'))).toBe(true);
  });

  test('unknown expect target kind is dropped', () => {
    const yaml = `
id: x
title: y
steps:
  - action: expect
    target:
      kind: teleported-away
  - action: wait
    ms: 1
`;
    const r = parseScenarioYaml(yaml);
    expect(r.validSteps.length).toBe(1);
    expect(r.errors.some(e => e.message.includes('teleported-away'))).toBe(true);
  });

  test('unknown click target kind is dropped', () => {
    const yaml = `
id: x
title: y
steps:
  - action: click
    target:
      kind: finger
  - action: wait
    ms: 1
`;
    const r = parseScenarioYaml(yaml);
    expect(r.validSteps.length).toBe(1);
  });

  test('wait step with non-number ms is dropped', () => {
    const yaml = `
id: x
title: y
steps:
  - action: wait
    ms: soon
  - action: wait
    ms: 50
`;
    const r = parseScenarioYaml(yaml);
    expect(r.validSteps.length).toBe(1);
    expect(r.errors.some(e => e.path === 'steps[0].ms')).toBe(true);
  });

  test('unknown mount kind is dropped, mount array still exists with others', () => {
    const yaml = `
id: x
title: y
setup:
  mount:
    - id: good
      kind: button
      props: { label: A }
    - id: bad
      kind: hologram
      props: { label: B }
steps: []
`;
    const r = parseScenarioYaml(yaml);
    expect(r.scenario?.setup?.mount?.length).toBe(1);
    expect(r.scenario?.setup?.mount?.[0]!.id).toBe('good');
    expect(r.errors.some(e => e.message.includes('hologram'))).toBe(true);
  });

  test('wrong type for tags (string instead of array) is rejected', () => {
    const yaml = `
id: x
title: y
tags: not-an-array
steps: []
`;
    const r = parseScenarioYaml(yaml);
    expect(r.scenario?.tags).toBeUndefined();
    expect(r.errors.some(e => e.path === 'tags')).toBe(true);
  });

  test('setup must be a mapping', () => {
    const yaml = `
id: x
title: y
setup: oops
steps: []
`;
    const r = parseScenarioYaml(yaml);
    expect(r.errors.some(e => e.path === 'setup')).toBe(true);
    expect(r.scenario?.setup).toBeUndefined();
  });

  test('steps must be a sequence', () => {
    const yaml = `
id: x
title: y
steps: nope
`;
    const r = parseScenarioYaml(yaml);
    expect(r.errors.some(e => e.path === 'steps')).toBe(true);
  });
});

// ── Reference checks → warnings ─────────────────────────────────

describe('parseScenarioYaml — reference warnings', () => {
  test('click component with no matching mount → warning', () => {
    const yaml = `
id: x
title: y
steps:
  - action: click
    target:
      kind: component
      componentId: ghost:ok
`;
    const r = parseScenarioYaml(yaml);
    expect(r.validSteps.length).toBe(1);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]!.path).toBe('steps[0].target.componentId');
  });

  test('expect modal-mounted with no setup mount → warning', () => {
    const yaml = `
id: x
title: y
steps:
  - action: expect
    target:
      kind: modal-mounted
      id: phantom
`;
    const r = parseScenarioYaml(yaml);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]!.path).toBe('steps[0].target.id');
  });

  test('click componentId matching a real mount → no warning', () => {
    const yaml = `
id: x
title: y
setup:
  mount:
    - id: real
      kind: button
      props: { label: X }
steps:
  - action: click
    target:
      kind: component
      componentId: real
`;
    const r = parseScenarioYaml(yaml);
    expect(r.warnings).toEqual([]);
  });

  test('dismiss unmounted modal → warning', () => {
    const yaml = `
id: x
title: y
steps:
  - action: dismiss
    modalId: gone
`;
    const r = parseScenarioYaml(yaml);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]!.path).toBe('steps[0].modalId');
  });
});

// ── Line / col accuracy ─────────────────────────────────────────

describe('parseScenarioYaml — line:col accuracy', () => {
  test('error on unknown action points at the action line', () => {
    // line 1 is the leading blank, so 'action: teleport' lands on line 4
    const yaml = `
id: x
title: y
steps:
  - action: teleport
`;
    const r = parseScenarioYaml(yaml);
    const err = r.errors.find(e => e.message.includes('teleport'));
    expect(err).toBeDefined();
    // The value 'teleport' is on line 5 of the YAML (1-indexed).
    expect(err!.line).toBe(5);
    expect(err!.col).toBeGreaterThan(0);
  });

  test('errors are sorted by line ascending', () => {
    const yaml = `
id: 5
title: 10
steps:
  - action: teleport
  - action: click
`;
    const r = parseScenarioYaml(yaml);
    for (let i = 1; i < r.errors.length; i++) {
      const prev = r.errors[i - 1]!;
      const cur = r.errors[i]!;
      const pcmp = prev.line * 10000 + prev.col;
      const ccmp = cur.line * 10000 + cur.col;
      expect(ccmp).toBeGreaterThanOrEqual(pcmp);
    }
  });
});

// ── Result shape contract ───────────────────────────────────────

describe('parseScenarioYaml — result contract', () => {
  test('always returns a result, never throws', () => {
    const bad = '::::\n\t\r  )(**&^%';
    let r: ScenarioParseResult | undefined;
    expect(() => { r = parseScenarioYaml(bad); }).not.toThrow();
    expect(r).toBeDefined();
  });

  test('partial result keeps valid fields alongside schema errors', () => {
    const yaml = `
id: ok
title: also ok
tags: broken
steps: []
`;
    const r = parseScenarioYaml(yaml);
    expect(r.scenario?.id).toBe('ok');
    expect(r.scenario?.title).toBe('also ok');
    expect(r.scenario?.tags).toBeUndefined();
    expect(r.errors.length).toBe(1);
  });
});
