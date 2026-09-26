// F-B5a — Scenario → YAML round-trip tests.

import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_SCENARIOS,
  DIALOG_CONFIRM_FLOW,
  PICKER_ROW_CLICK_FLOW,
  THEME_SWITCH_CONTEXT_KEYS,
  parseScenarioYaml,
  serializeScenarioToYaml,
  type Scenario,
} from '../src/playground-scenario/index.js';

describe('serializeScenarioToYaml — key ordering', () => {
  test('top-level keys emitted in declared order', () => {
    const yaml = serializeScenarioToYaml(DIALOG_CONFIRM_FLOW);
    const idPos = yaml.indexOf('id:');
    const titlePos = yaml.indexOf('title:');
    const descPos = yaml.indexOf('description:');
    const tagsPos = yaml.indexOf('tags:');
    const setupPos = yaml.indexOf('setup:');
    const stepsPos = yaml.indexOf('steps:');
    expect(idPos).toBeLessThan(titlePos);
    expect(titlePos).toBeLessThan(descPos);
    expect(descPos).toBeLessThan(tagsPos);
    expect(tagsPos).toBeLessThan(setupPos);
    expect(setupPos).toBeLessThan(stepsPos);
  });

  test('step action key appears before target key', () => {
    const yaml = serializeScenarioToYaml(DIALOG_CONFIRM_FLOW);
    // Scan every step — action: must precede the next target: on
    // its block (simpler: first 'target:' comes after first 'action:')
    const actionFirst = yaml.indexOf('action:');
    const targetFirst = yaml.indexOf('target:');
    expect(actionFirst).toBeLessThan(targetFirst);
  });
});

describe('serializeScenarioToYaml — round-trip', () => {
  for (const s of DEFAULT_SCENARIOS) {
    test(`round-trip preserves '${s.id}'`, () => {
      const yaml = serializeScenarioToYaml(s);
      const parsed = parseScenarioYaml(yaml);
      expect(parsed.errors).toEqual([]);
      expect(parsed.scenario).not.toBeNull();
      expect(parsed.scenario!.id).toBe(s.id);
      expect(parsed.scenario!.title).toBe(s.title);
      expect(parsed.scenario!.steps?.length).toBe(s.steps.length);
      // Deep check: serialized → parsed → serialized produces the
      // same yaml.
      const yaml2 = serializeScenarioToYaml(parsed.scenario as Scenario);
      expect(yaml2).toBe(yaml);
    });
  }

  test('scenario with all step kinds round-trips', () => {
    const s: Scenario = {
      id: 'rt:kitchen-sink',
      title: 'Kitchen sink',
      description: 'Every step variant',
      tags: ['rt'],
      setup: {
        theme: 'elanous-dark',
        mount: [
          {
            id: 'btn',
            kind: 'button',
            props: { label: 'Go', buttonId: 'go' },
          },
        ],
      },
      steps: [
        { action: 'click', target: { kind: 'component', componentId: 'btn' }, button: 'left' },
        { action: 'key', event: { name: 'return' } as never },
        { action: 'expect', target: { kind: 'modal-mounted', id: 'btn' } },
        { action: 'theme', name: 'elanous-pastel-default' },
        { action: 'set-context-key', key: 'themeName' as never, value: 'x' },
        { action: 'dismiss', modalId: 'btn' },
        { action: 'wait', ms: 25 },
      ],
    };
    const yaml = serializeScenarioToYaml(s);
    const parsed = parseScenarioYaml(yaml);
    expect(parsed.errors).toEqual([]);
    expect(parsed.validSteps.length).toBe(s.steps.length);
    expect(parsed.scenario?.setup?.theme).toBe('elanous-dark');
  });
});
