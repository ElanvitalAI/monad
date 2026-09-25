// W6 Y4 · model selector matrix.

import { describe, expect, test } from 'bun:test';
import { ThinkerModelSelector } from '../../src/background-reasoning/thinker-model-selector';

describe('ThinkerModelSelector', () => {
  test('workflow_proposal / template_draft / cross_workflow_pattern → cloud long-context', () => {
    const s = new ThinkerModelSelector({ local2Available: () => true });
    for (const k of ['workflow_proposal', 'template_draft', 'cross_workflow_pattern'] as const) {
      const spec = s.select(k);
      expect(spec.provider).toBe('cloud');
      expect(spec.longContext).toBe(true);
      expect(spec.model).toContain('gemini-2.5-pro');
    }
  });

  test('pattern_detect + local2 available → local qwen-32b', () => {
    const s = new ThinkerModelSelector({ local2Available: () => true });
    const spec = s.select('pattern_detect');
    expect(spec.provider).toBe('local');
    expect(spec.model).toContain('qwen-32b');
  });

  test('pattern_detect + local2 saturated → cloud cheap', () => {
    const s = new ThinkerModelSelector({ local2Available: () => false });
    const spec = s.select('pattern_detect');
    expect(spec.provider).toBe('cloud');
    expect(spec.model).toBe('gemini-flash');
  });

  test('prompt_patch → cloud accurate (claude-sonnet)', () => {
    const s = new ThinkerModelSelector({ local2Available: () => true });
    const spec = s.select('prompt_patch');
    expect(spec.provider).toBe('cloud');
    expect(spec.model).toBe('claude-sonnet');
  });

  test('mission_decision / next_action_predict → cloud cheap', () => {
    const s = new ThinkerModelSelector({ local2Available: () => true });
    expect(s.select('mission_decision').model).toBe('gemini-flash');
    expect(s.select('next_action_predict').model).toBe('gemini-flash');
  });

  test('pins override defaults', () => {
    const s = new ThinkerModelSelector({
      local2Available: () => true,
      pins: { cloudLong: 'gpt-4-128k', cloudAccurate: 'claude-opus' },
    });
    expect(s.select('workflow_proposal').model).toBe('gpt-4-128k');
    expect(s.select('prompt_patch').model).toBe('claude-opus');
  });
});
