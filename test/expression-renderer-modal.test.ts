import { describe, expect, test } from 'bun:test';
import { renderModal, wrapModalBody } from '../src/expression/index.js';
import type { ModalSpec } from '../src/expression/index.js';

const stripAnsi = (s: string) => s.replace(/\x1b\[[\d;]*m/g, '');

describe('expression/renderer/modal · frame structure', () => {
  test('top + body + bottom + actions in correct order', () => {
    const spec: ModalSpec = {
      kind: 'modal',
      id: 'm',
      title: 'Confirm',
      body: 'Save changes?',
      actions: [
        { id: 'ok', label: 'OK', primary: true },
        { id: 'cancel', label: 'Cancel' },
      ],
    };
    const out = stripAnsi(renderModal(spec, 'mono', { width: 50 }));
    const lines = out.split('\n');
    expect(lines[0]).toContain('Confirm'); // top border carries title
    expect(lines[0]).toMatch(/^╭/); // rounded TL corner
    expect(lines[lines.length - 1]).toMatch(/╯$/); // rounded BR corner
    // Body row appears somewhere in the middle.
    const bodyLineIdx = lines.findIndex((l) => l.includes('Save changes'));
    expect(bodyLineIdx).toBeGreaterThan(0);
    // Actions row appears after body.
    const actionsIdx = lines.findIndex((l) => l.includes('[ OK ]'));
    expect(actionsIdx).toBeGreaterThan(bodyLineIdx);
    expect(lines[actionsIdx]).toContain('[ Cancel ]');
  });

  test('every line has the same visible width', () => {
    const spec: ModalSpec = {
      kind: 'modal',
      id: 'm',
      title: 'T',
      body: 'short body',
    };
    const width = 40;
    const out = stripAnsi(renderModal(spec, 'mono', { width }));
    for (const line of out.split('\n')) {
      expect(line.length).toBe(width);
    }
  });

  test('body wraps to fit width', () => {
    const spec: ModalSpec = {
      kind: 'modal',
      id: 'm',
      title: 'T',
      body:
        'This body has many words intended to wrap across multiple rows when the width is small.',
    };
    const out = stripAnsi(renderModal(spec, 'mono', { width: 30 }));
    const bodyLines = out
      .split('\n')
      .filter((l) => l.startsWith('│') && !l.match(/^│ {28}│$/));
    expect(bodyLines.length).toBeGreaterThan(1);
  });

  test('empty body renders without body rows', () => {
    const spec: ModalSpec = { kind: 'modal', id: 'm', title: 'T', body: '' };
    const out = stripAnsi(renderModal(spec, 'mono', { width: 30 }));
    const lines = out.split('\n');
    // 1 top + 1 empty + 1 bottom = 3 rows minimum
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  test('no actions → no action row', () => {
    const spec: ModalSpec = {
      kind: 'modal',
      id: 'm',
      title: 'T',
      body: 'hello',
    };
    const out = stripAnsi(renderModal(spec, 'mono'));
    expect(out).not.toContain('[ ');
  });
});

describe('expression/renderer/modal · variant tinting', () => {
  test('error variant uses red palette', () => {
    const spec: ModalSpec = {
      kind: 'modal',
      id: 'm',
      title: 'Boom',
      body: 'bad',
      variant: 'error',
    };
    const out = renderModal(spec, 'truecolor');
    expect(out).toContain('\x1b[38;2;');
  });

  test('success/warning/info/destructive all emit colored frames', () => {
    const variants: ReadonlyArray<ModalSpec['variant']> = [
      'info',
      'success',
      'warning',
      'error',
      'destructive',
    ];
    for (const variant of variants) {
      const spec: ModalSpec = {
        kind: 'modal',
        id: 'm',
        title: 'T',
        body: 'b',
        variant,
      };
      expect(renderModal(spec, 'truecolor')).toContain('\x1b[38;2;');
    }
  });
});

describe('expression/renderer/modal · action styles', () => {
  test('primary action gets bold accent SGR', () => {
    const spec: ModalSpec = {
      kind: 'modal',
      id: 'm',
      title: 'T',
      body: 'b',
      actions: [{ id: 'go', label: 'Go', primary: true }],
    };
    expect(renderModal(spec, 'truecolor')).toContain('\x1b[1m');
  });

  test('destructive action gets red SGR', () => {
    const spec: ModalSpec = {
      kind: 'modal',
      id: 'm',
      title: 'T',
      body: 'b',
      actions: [{ id: 'rm', label: 'Delete', destructive: true }],
    };
    const out = renderModal(spec, 'truecolor');
    expect(out).toContain('\x1b[38;2;');
    expect(stripAnsi(out)).toContain('[ Delete ]');
  });

  test('hotkey appears next to label', () => {
    const spec: ModalSpec = {
      kind: 'modal',
      id: 'm',
      title: 'T',
      body: 'b',
      actions: [{ id: 'ok', label: 'OK', hotkey: 'Enter' }],
    };
    expect(stripAnsi(renderModal(spec, 'mono'))).toContain('OK [Enter]');
  });
});

describe('expression/renderer/modal · ANSI emission', () => {
  test('mono emits zero CSI', () => {
    const spec: ModalSpec = {
      kind: 'modal',
      id: 'm',
      title: 'T',
      body: 'b',
      variant: 'success',
      actions: [{ id: 'ok', label: 'OK', primary: true }],
    };
    expect(renderModal(spec, 'mono')).not.toContain('\x1b[');
  });

  test('truecolor emits SGR for border + title + actions', () => {
    const spec: ModalSpec = {
      kind: 'modal',
      id: 'm',
      title: 'T',
      body: 'b',
      actions: [{ id: 'ok', label: 'OK', primary: true }],
    };
    const out = renderModal(spec, 'truecolor');
    expect(out).toContain('\x1b[38;2;');
    expect(out).toContain('\x1b[1m');
  });
});

describe('expression/renderer/modal · purity', () => {
  test('same input → same output', () => {
    const spec: ModalSpec = {
      kind: 'modal',
      id: 'm',
      title: 'T',
      body: 'hello',
      variant: 'info',
    };
    const a = renderModal(spec, 'truecolor', { width: 40 });
    const b = renderModal(spec, 'truecolor', { width: 40 });
    expect(a).toBe(b);
  });
});

describe('expression/renderer/modal · wrapModalBody helper', () => {
  test('wraps on word boundary within budget', () => {
    expect(wrapModalBody('one two three four', 10)).toEqual([
      'one two',
      'three four',
    ]);
  });

  test('preserves explicit newlines as separate paragraphs', () => {
    expect(wrapModalBody('a\nb', 50)).toEqual(['a', 'b']);
  });

  test('handles empty input', () => {
    expect(wrapModalBody('', 50)).toEqual([]);
  });

  test('non-finite or zero width returns original', () => {
    expect(wrapModalBody('abc', 0)).toEqual(['abc']);
    expect(wrapModalBody('abc', -1)).toEqual(['abc']);
  });
});
