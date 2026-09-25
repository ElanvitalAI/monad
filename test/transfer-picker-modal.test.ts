import { describe, expect, test } from 'bun:test';

import { createTransferPickerModal } from '../src/transfer/transfer-picker-modal.js';
import type { TransferTarget } from '../src/transfer/transfer-targets.js';
import type { SshHost } from '../src/ssh/ssh-hosts.js';

const MBA: SshHost = { name: 'mba', host: 'mba' };

function mkTargets(): TransferTarget[] {
  return [
    { kind: 'ssh', name: 'mba', host: MBA, remoteDir: '~/Downloads/' },
    { kind: 'iphone', name: 'iPhone', pushcutName: 'monad-file-received' },
  ];
}

function bounds() {
  return { row: 5, col: 5, width: 60, height: 10 };
}

describe('createTransferPickerModal', () => {
  test('lists one item per target', () => {
    const picker = createTransferPickerModal({
      targets: mkTargets(),
      bounds: bounds(),
      width: 60,
      onAccept: () => {},
    });
    expect(picker.state().items.length).toBe(2);
  });

  test('ssh label contains kind + destination', () => {
    const picker = createTransferPickerModal({
      targets: mkTargets(),
      bounds: bounds(),
      width: 60,
      onAccept: () => {},
    });
    const label = picker.state().items[0]!.label;
    expect(label).toContain('mba');
    expect(label).toContain('ssh');
    expect(label).toContain('Downloads');
  });

  test('iphone label contains kind + transport', () => {
    const picker = createTransferPickerModal({
      targets: mkTargets(),
      bounds: bounds(),
      width: 60,
      onAccept: () => {},
    });
    const label = picker.state().items[1]!.label;
    expect(label).toContain('iPhone');
    expect(label).toContain('iphone');
    expect(label).toContain('pushcut');
  });

  test('query filters by name substring', () => {
    const picker = createTransferPickerModal({
      targets: mkTargets(),
      bounds: bounds(),
      width: 60,
      onAccept: () => {},
    });
    for (const ch of 'iphone') picker.type(ch);
    expect(picker.state().query).toBe('iphone');
    expect(picker.state().items.length).toBe(1);
  });

  test('larger target lists keep the top-filter picker contract', () => {
    const picker = createTransferPickerModal({
      targets: [
        ...mkTargets(),
        { kind: 'ssh', name: 'backup', host: MBA, remoteDir: '~/Backup/' },
        { kind: 'ssh', name: 'media', host: MBA, remoteDir: '~/Media/' },
      ],
      bounds: bounds(),
      width: 60,
      onAccept: () => {},
    });
    for (const ch of 'iphone') picker.type(ch);
    expect(picker.state().query).toBe('iphone');
    expect(picker.state().items.length).toBe(1);
    expect(picker.state().items[0]!.label).toContain('iPhone');
    const ansi = picker.surface.paint();
    expect(ansi).toContain('Send');
    expect(ansi).toContain('Cancel');
  });

  test('accept resolves the selected target', () => {
    let picked: TransferTarget | null = null;
    const picker = createTransferPickerModal({
      targets: mkTargets(),
      bounds: bounds(),
      width: 60,
      onAccept: (t) => { picked = t; },
    });
    picker.accept();
    expect(picked).not.toBeNull();
    if (picked !== null) {
      expect((picked as TransferTarget).name).toBe('mba');
    }
  });

  test('cancel invokes onCancel', () => {
    let cancelled = 0;
    const picker = createTransferPickerModal({
      targets: mkTargets(),
      bounds: bounds(),
      width: 60,
      onAccept: () => {},
      onCancel: () => { cancelled++; },
    });
    picker.cancel();
    expect(cancelled).toBe(1);
  });
});
