import { describe, expect, test } from 'bun:test';
import {
  isKind,
  type ModalSpec,
  type StepSpec,
  type TableSpec,
} from '../src/expression/spec/types.js';

describe('expression/spec · discriminated union', () => {
  test('isKind narrows on `kind` discriminant', () => {
    const step: StepSpec = {
      kind: 'step',
      id: 'telegram',
      title: 'Telegram',
      fields: [],
    };
    if (isKind(step, 'step')) {
      // type narrows to StepSpec — fields is accessible
      expect(step.fields).toEqual([]);
    } else {
      throw new Error('isKind narrowing failed');
    }
  });

  test('isKind returns false for mismatched kind', () => {
    const modal: ModalSpec = {
      kind: 'modal',
      id: 'm1',
      title: 't',
      body: 'b',
    };
    expect(isKind(modal, 'step')).toBe(false);
    expect(isKind(modal, 'modal')).toBe(true);
  });

  test('TableSpec accepts arbitrary row shapes', () => {
    const t: TableSpec = {
      kind: 'table',
      columns: [
        { id: 'name', label: 'Name' },
        { id: 'count', label: 'Count', align: 'right', format: 'number' },
      ],
      rows: [
        { name: 'a', count: 1 },
        { name: 'b', count: 2 },
      ],
    };
    expect(t.rows.length).toBe(2);
    expect(t.columns[0]!.id).toBe('name');
  });

  test('StepSpec with conditional field visibility compiles', () => {
    const s: StepSpec = {
      kind: 'step',
      id: 'wizard',
      title: 'Setup',
      fields: [
        { id: 'enable', kind: 'confirm', label: 'Enable?', default: false },
        {
          id: 'token',
          kind: 'secret',
          label: 'Token',
          visible_when: { enable: true },
          validate: { pattern: '^.{10,}$', message: 'too short' },
        },
      ],
      actions: [
        { id: 'back', label: '< Back' },
        { id: 'done', label: 'Done', primary: true },
      ],
    };
    expect(s.fields.length).toBe(2);
    expect(s.actions?.length).toBe(2);
  });
});
