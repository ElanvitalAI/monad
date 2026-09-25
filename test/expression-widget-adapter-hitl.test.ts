// ── HITL ConfirmRequest ↔ InteractiveModal adapter (LT 6) ──

import { describe, expect, test } from 'bun:test';
import {
  hitlConfirmRequestToInteractiveModalSpec,
  interactiveModalResultToHitlConfirm,
} from '../src/expression/widget/adapters/hitl-confirm';
import type { ConfirmRequest } from '../src/hitl/types';
import type { InteractiveModalResult } from '../src/expression/widget/interactive-modal';

describe('hitlConfirmRequestToInteractiveModalSpec', () => {
  test('minimal request → single confirm step + default labels', () => {
    const req: ConfirmRequest = { prompt: 'Apply migration?' };
    const spec = hitlConfirmRequestToInteractiveModalSpec(req);
    expect(spec.kind).toBe('interactive-modal');
    expect(spec.title).toBe('Approval required');
    expect(spec.steps).toHaveLength(1);
    const step = spec.steps[0];
    expect(step.kind).toBe('confirm');
    expect(step.id).toBe('hitl_approval');
    expect(step.label).toBe('Apply migration?');
    expect((step as { help?: string }).help).toBe('Yes / No');
    expect((step as { default?: boolean }).default).toBe(false);
  });

  test('detail → modal excerpt', () => {
    const req: ConfirmRequest = {
      prompt: 'Apply migration?',
      detail: '12 rows will be touched. Backup taken at 14:02.',
    };
    const spec = hitlConfirmRequestToInteractiveModalSpec(req);
    expect((spec as { excerpt?: string }).excerpt).toBe(
      '12 rows will be touched. Backup taken at 14:02.',
    );
  });

  test('custom yes/no labels surface in the help line', () => {
    const req: ConfirmRequest = {
      prompt: 'Deploy now?',
      yesLabel: 'Deploy',
      noLabel: 'Hold',
    };
    const spec = hitlConfirmRequestToInteractiveModalSpec(req);
    expect((spec.steps[0] as { help?: string }).help).toBe('Deploy / Hold');
  });

  test('requestId becomes the modal id (preserves correlation)', () => {
    const spec = hitlConfirmRequestToInteractiveModalSpec({
      prompt: 'p',
      requestId: 'r-9876',
    });
    expect(spec.id).toBe('hitl-confirm-r-9876');
  });

  test('without requestId, id is a deterministic hash of the prompt', () => {
    const a = hitlConfirmRequestToInteractiveModalSpec({ prompt: 'Drop table?' });
    const b = hitlConfirmRequestToInteractiveModalSpec({ prompt: 'Drop table?' });
    const c = hitlConfirmRequestToInteractiveModalSpec({ prompt: 'Drop another?' });
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
    expect(a.id.startsWith('hitl-confirm-')).toBe(true);
  });

  test('opts.title overrides the default', () => {
    const spec = hitlConfirmRequestToInteractiveModalSpec(
      { prompt: 'p' },
      { title: 'Are you sure?' },
    );
    expect(spec.title).toBe('Are you sure?');
  });
});

describe('interactiveModalResultToHitlConfirm', () => {
  test('done with answer:true → answer:true, channel:terminal', () => {
    const modal: InteractiveModalResult = {
      status: 'done',
      answers: { hitl_approval: true },
    };
    const r = interactiveModalResultToHitlConfirm(modal, 1234);
    expect(r).toEqual({ answer: true, channel: 'terminal', elapsedMs: 1234 });
  });

  test('done with string "yes" / "y" / "true" → answer:true', () => {
    for (const raw of ['yes', 'y', 'true']) {
      const r = interactiveModalResultToHitlConfirm(
        { status: 'done', answers: { hitl_approval: raw } },
        0,
      );
      expect(r.answer).toBe(true);
    }
  });

  test('done with answer:false / unrelated string → answer:false', () => {
    for (const raw of [false, 'no', 'n', 'maybe', '']) {
      const r = interactiveModalResultToHitlConfirm(
        { status: 'done', answers: { hitl_approval: raw } },
        0,
      );
      expect(r.answer).toBe(false);
    }
  });

  test('cancel → answer:false (existing requestConfirmation contract)', () => {
    const r = interactiveModalResultToHitlConfirm(
      { status: 'cancel', answers: {} },
      999,
    );
    expect(r).toEqual({ answer: false, channel: 'terminal', elapsedMs: 999 });
  });

  test('elapsedMs propagates verbatim', () => {
    const r = interactiveModalResultToHitlConfirm(
      { status: 'done', answers: { hitl_approval: true } },
      42_777,
    );
    expect(r.elapsedMs).toBe(42_777);
  });
});
