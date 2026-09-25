// 텔레그램 UX 어댑터 RENDER/NORMALIZE 단위 테스트 (P3·주입 deps 격리).
import { describe, expect, it, beforeEach } from 'bun:test';
import { resetSurfaceCapabilities, surfaceSupports, type UXIntent } from './ux-intent.js';
import { renderIntent } from './ux-render.js';
import {
  reportTelegramCapabilities,
  uxCallbackData,
  parseUxCallbackData,
  renderToTelegram,
  normalizeTelegramCallback,
  normalizeTelegramReaction,
  normalizeTelegramReply,
  type TelegramSendDeps,
} from './telegram-ux-adapter.js';

function intent(over: Partial<UXIntent> = {}): UXIntent {
  return {
    missionId: 'm1',
    flowState: 'clarify:scope',
    prompt: '범위를 확정하세요',
    options: [
      { id: 'ok', label: '진행', value: 'proceed', kind: 'approve', recommended: true },
      { id: 'no', label: '중단', value: 'stop', kind: 'reject' },
    ],
    context: {},
    surface: { source: 'telegram', target: '999' },
    ...over,
  };
}

function fakeDeps() {
  const calls: { kind: string; text: string; buttons?: unknown }[] = [];
  const deps: TelegramSendDeps = {
    sendButtons: (_c, text, buttons) => { calls.push({ kind: 'buttons', text, buttons }); return 100; },
    sendForceReply: (_c, text) => { calls.push({ kind: 'force-reply', text }); return 200; },
    sendText: (_c, text) => { calls.push({ kind: 'text', text }); return true; },
  };
  return { deps, calls };
}

describe('callback data', () => {
  it('round-trips ux:<token>:<optionId>', () => {
    const data = uxCallbackData('abc123', 'ok');
    expect(data).toBe('ux:abc123:ok');
    expect(parseUxCallbackData(data)).toEqual({ token: 'abc123', optionId: 'ok' });
  });
  it('rejects foreign callback data (no stomp)', () => {
    expect(parseUxCallbackData('apm-clarify:t:q1:0')).toBeNull();
    expect(parseUxCallbackData('random')).toBeNull();
  });
});

describe('reportTelegramCapabilities', () => {
  beforeEach(() => resetSurfaceCapabilities());
  it('registers telegram interactions', () => {
    reportTelegramCapabilities();
    expect(surfaceSupports('telegram', 'reactions')).toBe(true);
    expect(surfaceSupports('telegram', 'force-reply')).toBe(true);
    expect(surfaceSupports('telegram', 'buttons')).toBe(true);
  });
});

describe('renderToTelegram', () => {
  beforeEach(() => resetSurfaceCapabilities());

  it('buttons form → sendButtons with ux callback data', () => {
    const rich = intent({ context: { signals: { criticalCount: 2 } } }); // → buttons
    const plan = renderIntent(rich);
    const { deps, calls } = fakeDeps();
    const res = renderToTelegram(rich, plan, { chatId: 999, token: 'tok' }, deps);
    expect(res.form).toBe('buttons');
    expect(calls[0]!.kind).toBe('buttons');
    const rows = calls[0]!.buttons as { text: string; data: string }[][];
    expect(rows[0]![0]!.data).toBe('ux:tok:ok');
  });

  it('reactions form → sendText with reaction hint', () => {
    const plan = renderIntent(intent()); // simple low-risk → reactions
    expect(plan.form).toBe('reactions');
    const { deps, calls } = fakeDeps();
    renderToTelegram(intent(), plan, { chatId: 999, token: 'tok' }, deps);
    expect(calls[0]!.kind).toBe('text');
    expect(calls[0]!.text).toContain('👍');
  });

  it('freeform → additional force-reply', () => {
    const withFree = intent({ freeform: { marker: 'm', hint: '바꿀 점을 알려주세요' } });
    const plan = renderIntent(withFree);
    const { deps, calls } = fakeDeps();
    const res = renderToTelegram(withFree, plan, { chatId: 999, token: 'tok' }, deps);
    expect(res.freeformSent).toBe(true);
    expect(calls.some((c) => c.kind === 'force-reply' && c.text.includes('바꿀 점'))).toBe(true);
  });
});

describe('normalize telegram updates', () => {
  it('callback → button UXEvent', () => {
    const ev = normalizeTelegramCallback('ux:tok:ok', 'm1', 'clarify:scope');
    expect(ev?.optionId).toBe('ok');
  });
  it('foreign callback → null', () => {
    expect(normalizeTelegramCallback('apm-clarify:t:q1:0', 'm1', 'x')).toBeNull();
  });
  it('reaction 👍 → approve verdict', () => {
    const ev = normalizeTelegramReaction({ message_id: 1, new_reaction: [{ type: 'emoji', emoji: '👍' }] }, 'm1', 'hitl:x');
    expect(ev.verdict).toBe('approve');
  });
  it('reaction with no emoji → no verdict', () => {
    const ev = normalizeTelegramReaction({ message_id: 1, new_reaction: [] }, 'm1', 'hitl:x');
    expect(ev.verdict).toBeUndefined();
  });
  it('reply → freeformText', () => {
    const ev = normalizeTelegramReply('이렇게 바꿔주세요', 'm1', 'clarify:arc', { source: 'native', nativePlatform: 'android' });
    expect(ev.freeformText).toBe('이렇게 바꿔주세요');
    expect(ev.surface?.source).toBe('native');
    expect(ev.surface?.nativePlatform).toBe('android');
  });
});
