// Test: src/discord/components-builder.ts
//
// Coverage: button() validation · select() option/value bounds ·
// actionRow() mixed-type rejection · approveRejectButtons /
// personaPickerSelect convenience helpers.

import { describe, expect, test } from 'bun:test';
import {
  actionRow,
  approveRejectButtons,
  button,
  ButtonStyle,
  COMPONENT_TYPE,
  personaPickerSelect,
  select,
} from '../../src/discord/components-builder.js';

describe('button()', () => {
  test('PRIMARY (default) requires customId', () => {
    expect(() => button({ label: 'go' })).toThrow(/requires customId/);
    const b = button({ label: 'go', customId: 'cid' });
    expect(b.type).toBe(COMPONENT_TYPE.BUTTON);
    expect(b.style).toBe(ButtonStyle.PRIMARY);
    expect(b.label).toBe('go');
    expect(b.custom_id).toBe('cid');
    expect(b.url).toBeUndefined();
  });

  test('LINK requires url, no customId', () => {
    expect(() => button({ label: 'docs', style: ButtonStyle.LINK })).toThrow(/LINK style requires url/);
    const b = button({ label: 'docs', style: ButtonStyle.LINK, url: 'https://x' });
    expect(b.style).toBe(ButtonStyle.LINK);
    expect(b.url).toBe('https://x');
    expect(b.custom_id).toBeUndefined();
  });

  test('emoji + disabled propagate', () => {
    const b = button({ label: 'go', customId: 'cid', emoji: { name: '🚀' }, disabled: true });
    expect(b.emoji).toEqual({ name: '🚀' });
    expect(b.disabled).toBe(true);
  });

  test('SUCCESS / DANGER style propagate', () => {
    expect(button({ label: 'A', customId: 'a', style: ButtonStyle.SUCCESS }).style).toBe(3);
    expect(button({ label: 'R', customId: 'r', style: ButtonStyle.DANGER }).style).toBe(4);
  });
});

describe('select()', () => {
  test('basic — 1 option, default min/max', () => {
    const s = select({ customId: 'cid', options: [{ label: 'A', value: 'a' }] });
    expect(s.type).toBe(COMPONENT_TYPE.STRING_SELECT);
    expect(s.custom_id).toBe('cid');
    expect(s.options).toHaveLength(1);
    expect(s.placeholder).toBeUndefined();
  });

  test('rejects empty options', () => {
    expect(() => select({ customId: 'c', options: [] })).toThrow(/at least 1 option/);
  });

  test('rejects > 25 options', () => {
    const opts = Array.from({ length: 26 }, (_, i) => ({ label: `o${i}`, value: `v${i}` }));
    expect(() => select({ customId: 'c', options: opts })).toThrow(/at most 25/);
  });

  test('rejects invalid min/max values', () => {
    const opts = [{ label: 'a', value: '1' }, { label: 'b', value: '2' }];
    expect(() => select({ customId: 'c', options: opts, minValues: 3, maxValues: 5 })).toThrow(/invalid min\/max/);
    expect(() => select({ customId: 'c', options: opts, maxValues: 5 })).toThrow(/invalid min\/max/);
  });

  test('placeholder + multi-select propagate', () => {
    const s = select({
      customId: 'c',
      placeholder: 'Pick…',
      minValues: 1,
      maxValues: 2,
      options: [
        { label: 'A', value: 'a', description: 'Apple' },
        { label: 'B', value: 'b', emoji: { name: '🍌' }, default: true },
      ],
    });
    expect(s.placeholder).toBe('Pick…');
    expect(s.min_values).toBe(1);
    expect(s.max_values).toBe(2);
    expect(s.options![0]!.description).toBe('Apple');
    expect(s.options![1]!.emoji).toEqual({ name: '🍌' });
    expect(s.options![1]!.default).toBe(true);
  });
});

describe('actionRow()', () => {
  test('rejects empty', () => {
    expect(() => actionRow([])).toThrow(/at least 1 child/);
  });

  test('rejects > 5 buttons', () => {
    const btns = Array.from({ length: 6 }, (_, i) =>
      button({ label: `b${i}`, customId: `c${i}` }));
    expect(() => actionRow(btns)).toThrow(/at most 5 Buttons/);
  });

  test('rejects mixed select + button', () => {
    expect(() => actionRow([
      button({ label: 'b', customId: 'c' }),
      select({ customId: 's', options: [{ label: 'A', value: 'a' }] }),
    ])).toThrow(/Select must be alone/);
  });

  test('select alone in row is OK', () => {
    const row = actionRow([select({ customId: 's', options: [{ label: 'A', value: 'a' }] })]);
    expect(row.type).toBe(COMPONENT_TYPE.ACTION_ROW);
    expect(row.components).toHaveLength(1);
  });

  test('5 buttons OK', () => {
    const btns = Array.from({ length: 5 }, (_, i) =>
      button({ label: `b${i}`, customId: `c${i}` }));
    const row = actionRow(btns);
    expect(row.components).toHaveLength(5);
  });
});

describe('approveRejectButtons()', () => {
  test('default — Approve/Reject with prefix=hitl', () => {
    const row = approveRejectButtons();
    const [a, r] = row.components!;
    expect(a!.style).toBe(ButtonStyle.SUCCESS);
    expect(a!.label).toBe('Approve');
    expect(a!.custom_id).toBe('hitl:approve');
    expect(a!.emoji).toEqual({ name: '👍' });
    expect(r!.style).toBe(ButtonStyle.DANGER);
    expect(r!.custom_id).toBe('hitl:reject');
    expect(r!.emoji).toEqual({ name: '👎' });
  });

  test('gateId appended to custom_id', () => {
    const row = approveRejectButtons({ gateId: 'gate-123' });
    expect(row.components![0]!.custom_id).toBe('hitl:approve:gate-123');
    expect(row.components![1]!.custom_id).toBe('hitl:reject:gate-123');
  });

  test('custom prefix + label override', () => {
    const row = approveRejectButtons({
      prefix: 'auto-relay',
      gateId: 'g',
      approveLabel: '진행',
      rejectLabel: '취소',
    });
    expect(row.components![0]!.label).toBe('진행');
    expect(row.components![0]!.custom_id).toBe('auto-relay:approve:g');
    expect(row.components![1]!.label).toBe('취소');
  });

  test('disabled propagates to both buttons', () => {
    const row = approveRejectButtons({ disabled: true });
    expect(row.components![0]!.disabled).toBe(true);
    expect(row.components![1]!.disabled).toBe(true);
  });
});

describe('personaPickerSelect()', () => {
  test('rejects empty personas', () => {
    expect(() => personaPickerSelect([], { customId: 'c' })).toThrow(/at least 1 persona/);
  });

  test('maps persona → option (id → value, displayName → label)', () => {
    const sel = personaPickerSelect(
      [
        { personaId: 'sage', displayName: 'Sage', description: '신중한 thinker' },
        { personaId: 'pragmatist', displayName: 'Pragmatist' },
      ],
      { customId: 'pick', placeholder: 'Choose persona' },
    );
    expect(sel.custom_id).toBe('pick');
    expect(sel.placeholder).toBe('Choose persona');
    expect(sel.options).toHaveLength(2);
    expect(sel.options![0]).toEqual({ label: 'Sage', value: 'sage', description: '신중한 thinker' });
    expect(sel.options![1]).toEqual({ label: 'Pragmatist', value: 'pragmatist' });
  });

  test('caps at 25 personas', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      personaId: `p${i}`, displayName: `P${i}`,
    }));
    const sel = personaPickerSelect(many, { customId: 'c' });
    expect(sel.options).toHaveLength(25);
  });

  test('defaultPersonaId marks the matching option default', () => {
    const sel = personaPickerSelect(
      [
        { personaId: 'sage', displayName: 'Sage' },
        { personaId: 'pragmatist', displayName: 'Pragmatist' },
      ],
      { customId: 'c', defaultPersonaId: 'pragmatist' },
    );
    expect(sel.options![0]!.default).toBeUndefined();
    expect(sel.options![1]!.default).toBe(true);
  });
});
