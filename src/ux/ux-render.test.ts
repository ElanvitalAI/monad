// UX 에이전트 코어 RENDER/NORMALIZE 단위 테스트 (P1).
import { describe, expect, it, beforeEach } from 'bun:test';
import { resetSurfaceCapabilities, reportSurfaceCapabilities, type UXIntent } from './ux-intent.js';
import {
  chooseForm,
  computeComplexity,
  isConsequential,
  renderIntent,
  normalizeEvent,
} from './ux-render.js';

function intent(over: Partial<UXIntent> = {}): UXIntent {
  return {
    missionId: 'm1',
    flowState: 'clarify:scope',
    prompt: '?',
    options: [
      { id: 'ok', label: '진행', value: 'proceed', kind: 'approve' },
      { id: 'no', label: '중단', value: 'stop', kind: 'reject' },
    ],
    context: {},
    ...over,
  };
}

describe('computeComplexity (auto-rule)', () => {
  it('simple for ≤2 options, no criticals', () => {
    expect(computeComplexity(intent())).toBe('simple');
  });
  it('rich when critical count > 0', () => {
    expect(computeComplexity(intent({ context: { signals: { criticalCount: 1 } } }))).toBe('rich');
  });
  it('rich when > 2 options', () => {
    expect(
      computeComplexity(
        intent({ options: [
          { id: 'a', label: 'a', value: 'a' },
          { id: 'b', label: 'b', value: 'b' },
          { id: 'c', label: 'c', value: 'c' },
        ] }),
      ),
    ).toBe('rich');
  });
  it('explicit context.complexity overrides', () => {
    expect(computeComplexity(intent({ context: { complexity: 'rich' } }))).toBe('rich');
  });
});

describe('isConsequential', () => {
  it('true for approve-plan flowState', () => {
    expect(isConsequential(intent({ flowState: 'hitl:approve-plan' }))).toBe(true);
  });
  it('true for explicit consequential signal', () => {
    expect(isConsequential(intent({ context: { signals: { consequential: true } } }))).toBe(true);
  });
  it('false for clarify', () => {
    expect(isConsequential(intent())).toBe(false);
  });
});

describe('chooseForm (§9 위험차등 + graceful degrade)', () => {
  beforeEach(() => resetSurfaceCapabilities());

  it('reactions for simple low-risk on telegram', () => {
    expect(chooseForm(intent(), 'telegram')).toBe('reactions');
  });
  it('buttons for consequential even if simple', () => {
    expect(chooseForm(intent({ flowState: 'hitl:approve-plan' }), 'telegram')).toBe('buttons');
  });
  it('buttons for rich (criticals present)', () => {
    expect(chooseForm(intent({ context: { signals: { criticalCount: 3 } } }), 'telegram')).toBe('buttons');
  });
  it('degrades to buttons when reactions unsupported', () => {
    reportSurfaceCapabilities('telegram', ['text', 'buttons']);
    expect(chooseForm(intent(), 'telegram')).toBe('buttons');
  });
  it('select for many options on discord', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `o${i}`, label: `o${i}`, value: `${i}` }));
    expect(chooseForm(intent({ options: many }), 'discord')).toBe('select');
  });
  it('text when surface only supports text', () => {
    reportSurfaceCapabilities('tui', ['text']);
    expect(chooseForm(intent(), 'tui')).toBe('text');
  });
});

describe('renderIntent', () => {
  beforeEach(() => resetSurfaceCapabilities());

  it('builds a reaction map for reactions form', () => {
    const plan = renderIntent(intent({ surface: { source: 'telegram' } }));
    expect(plan.form).toBe('reactions');
    expect(plan.reactionMap?.ok).toBe('👍');
    expect(plan.reactionMap?.no).toBe('👎');
  });
  it('keeps freeform only when surface supports force-reply', () => {
    const withFree = intent({ freeform: { marker: 'm', hint: 'h' }, surface: { source: 'telegram' } });
    expect(renderIntent(withFree).freeform?.marker).toBe('m');
    reportSurfaceCapabilities('telegram', ['text', 'buttons']); // no force-reply
    expect(renderIntent(withFree).freeform).toBeUndefined();
  });

  it('uses each native platform capability and preserves it in the render plan', () => {
    const iosSurface = { source: 'native' as const, nativePlatform: 'ios' as const };
    const androidSurface = { source: 'native' as const, nativePlatform: 'android' as const };
    reportSurfaceCapabilities(iosSurface, ['text', 'reactions']);
    reportSurfaceCapabilities(androidSurface, ['text', 'buttons']);

    expect(chooseForm(intent(), iosSurface)).toBe('reactions');
    expect(chooseForm(intent(), androidSurface)).toBe('buttons');

    const ios = renderIntent(intent({ surface: iosSurface }));
    const android = renderIntent(intent({ surface: androidSurface }));
    expect(ios.form).toBe('reactions');
    expect(ios.surface).toBe('native');
    expect(ios.nativePlatform).toBe('ios');
    expect(android.form).toBe('buttons');
    expect(android.surface).toBe('native');
    expect(android.nativePlatform).toBe('android');
  });
});

describe('normalizeEvent', () => {
  it('button → optionId', () => {
    const ev = normalizeEvent({ missionId: 'm1', flowState: 'clarify:scope', kind: 'button', optionId: 'ok' });
    expect(ev.optionId).toBe('ok');
    expect(ev.verdict).toBeUndefined();
  });
  it('reaction 👍 → approve verdict', () => {
    const ev = normalizeEvent({ missionId: 'm1', flowState: 'hitl:x', kind: 'reaction', emoji: '👍' });
    expect(ev.verdict).toBe('approve');
  });
  it('reply → freeformText', () => {
    const ev = normalizeEvent({ missionId: 'm1', flowState: 'clarify:arc', kind: 'reply', text: '이렇게' });
    expect(ev.freeformText).toBe('이렇게');
  });
  it('unknown emoji → no verdict', () => {
    const ev = normalizeEvent({ missionId: 'm1', flowState: 'x', kind: 'reaction', emoji: '🎉' });
    expect(ev.verdict).toBeUndefined();
  });
});
