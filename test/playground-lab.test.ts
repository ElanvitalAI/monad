import { describe, expect, test } from 'bun:test';
import {
  buildMotionLabOptionEntries,
  buildPopupLabOptionEntries,
  buildShowcaseEntries,
  buildPresetOptionEntries,
  buildScenarioPaletteEntries,
  buildScenarioRunFeedback,
  buildScenarioSaveFeedback,
  buildThemeOptionEntries,
  nextAffectiveChromeState,
  nextPlaygroundChromeMotionMode,
  nextPlaygroundChromeTarget,
  nextPlaygroundChromeVariant,
  resolveEditableScenarioSource,
} from '../src/playground/lab.js';
import { DIALOG_CONFIRM_FLOW } from '../src/playground-scenario/default-scenarios.js';

describe('playground-lab', () => {
  test('buildScenarioPaletteEntries sorts by id and exposes metadata', () => {
    const entries = buildScenarioPaletteEntries([
      { ...DIALOG_CONFIRM_FLOW, id: 'z-last' },
      { ...DIALOG_CONFIRM_FLOW, id: 'a-first', title: 'First', tags: ['smoke'] },
    ]);
    expect(entries.map((entry) => entry.id)).toEqual(['a-first', 'z-last']);
    expect(entries[0]?.tags).toEqual(['smoke']);
    expect(entries[0]?.stepCount).toBe(DIALOG_CONFIRM_FLOW.steps.length);
  });

  test('resolveEditableScenarioSource returns scenario for valid YAML', () => {
    const yaml = [
      'id: draft:demo',
      'title: Demo',
      'steps:',
      '  - action: wait',
      '    ms: 1',
    ].join('\n');
    const resolution = resolveEditableScenarioSource(yaml);
    expect(resolution.ok).toBe(true);
    expect(resolution.scenario?.id).toBe('draft:demo');
    expect(resolution.scenario?.steps.length).toBe(1);
  });

  test('resolveEditableScenarioSource returns parse feedback for invalid YAML', () => {
    const resolution = resolveEditableScenarioSource('id:\nsteps:\n  - action: nope');
    expect(resolution.ok).toBe(false);
    expect(resolution.feedback.level).toBe('error');
    expect(resolution.feedback.title).toContain('Parse');
  });

  test('buildScenarioSaveFeedback and buildScenarioRunFeedback summarize results', () => {
    const save = buildScenarioSaveFeedback(DIALOG_CONFIRM_FLOW, 1);
    expect(save.title).toContain('saved');
    expect(save.lines.join('\n')).toContain('warning');

    const run = buildScenarioRunFeedback({
      scenario: DIALOG_CONFIRM_FLOW,
      status: 'fail',
      durationMs: 3,
      stepResults: [{
        step: DIALOG_CONFIRM_FLOW.steps[0]!,
        status: 'fail',
        durationMs: 1,
        message: 'boom',
      }],
    });
    expect(run.title).toContain('FAIL');
    expect(run.lines.join('\n')).toContain('boom');
  });

  test('buildThemeOptionEntries and buildPresetOptionEntries expose visual-control catalogs', () => {
    const themes = buildThemeOptionEntries();
    const presets = buildPresetOptionEntries();
    const showcases = buildShowcaseEntries();
    const popupLab = buildPopupLabOptionEntries();
    const motionLab = buildMotionLabOptionEntries();
    expect(themes.length).toBeGreaterThan(0);
    expect(themes[0]?.name).toBeTruthy();
    expect(presets.length).toBeGreaterThan(0);
    expect(presets[0]?.id).toBeTruthy();
    expect(showcases.map((entry) => entry.pluginId)).toEqual(['iul-canvas', 'widget-demo']);
    expect(popupLab.map((entry) => entry.id)).toContain('modal-shells');
    expect(popupLab[0]?.observe).toBeTruthy();
    expect(motionLab.map((entry) => entry.id)).toContain('state:neutral');
    expect(motionLab[0]?.nextStep).toBeTruthy();
  });

  test('nextAffectiveChromeState cycles through known states', () => {
    expect(nextAffectiveChromeState('neutral')).not.toBe('neutral');
    expect(nextAffectiveChromeState('tentative')).toBe('neutral');
  });

  test('chrome console helpers cycle motion mode, variant, and target', () => {
    expect(nextPlaygroundChromeMotionMode('off')).toBe('auto');
    expect(nextPlaygroundChromeMotionMode('auto')).toBe('reduced');
    expect(nextPlaygroundChromeVariant('plain')).toBe('rounded');
    expect(nextPlaygroundChromeVariant('heavy')).toBe('plain');
    expect(nextPlaygroundChromeTarget('frame')).toBe('title-bar');
    expect(nextPlaygroundChromeTarget('frame-and-title')).toBe('frame');
  });
});
