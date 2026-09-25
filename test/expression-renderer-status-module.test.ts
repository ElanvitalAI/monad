import { describe, expect, test } from 'bun:test';
import { renderStatusModule } from '../src/expression/index.js';
import type { StatusModuleSpec } from '../src/expression/index.js';

const stripAnsi = (s: string) => s.replace(/\x1b\[[\d;]*m/g, '');

describe('expression/renderer/status-module · inline style (default)', () => {
  test('icon + separator + text', () => {
    const spec: StatusModuleSpec = {
      kind: 'status-module',
      id: 's',
      icon: '★',
      text: 'main',
    };
    expect(stripAnsi(renderStatusModule(spec, 'mono'))).toBe('★ · main');
  });

  test('icon only (no text)', () => {
    const spec: StatusModuleSpec = { kind: 'status-module', id: 's', icon: '★', text: '' };
    expect(stripAnsi(renderStatusModule(spec, 'mono'))).toBe('★');
  });

  test('both empty → empty string', () => {
    const spec: StatusModuleSpec = { kind: 'status-module', id: 's', text: '' };
    expect(stripAnsi(renderStatusModule(spec, 'mono'))).toBe('');
  });

  test('text only (no icon)', () => {
    const spec: StatusModuleSpec = { kind: 'status-module', id: 's', text: 'ready' };
    expect(stripAnsi(renderStatusModule(spec, 'mono'))).toBe('ready');
  });

  test('custom separator', () => {
    const spec: StatusModuleSpec = {
      kind: 'status-module',
      id: 's',
      icon: '★',
      text: 'main',
    };
    expect(stripAnsi(renderStatusModule(spec, 'mono', { separator: ' | ' }))).toBe(
      '★ | main',
    );
  });
});

describe('expression/renderer/status-module · pill style', () => {
  test('emits leading bar', () => {
    const spec: StatusModuleSpec = {
      kind: 'status-module',
      id: 's',
      icon: '★',
      text: 'tag',
    };
    const out = stripAnsi(renderStatusModule(spec, 'mono', { style: 'pill' }));
    expect(out).toContain('┃');
    expect(out).toContain('tag');
  });
});

describe('expression/renderer/status-module · bracket style', () => {
  test('wraps in [ ]', () => {
    const spec: StatusModuleSpec = {
      kind: 'status-module',
      id: 's',
      text: 'wd',
    };
    const out = stripAnsi(renderStatusModule(spec, 'mono', { style: 'bracket' }));
    expect(out).toContain('[wd]');
  });
});

describe('expression/renderer/status-module · actionable hint', () => {
  test('opts.actionable=true emits ▸ cursor', () => {
    const spec: StatusModuleSpec = { kind: 'status-module', id: 's', text: 'click me' };
    const out = stripAnsi(renderStatusModule(spec, 'mono', { actionable: true }));
    expect(out).toContain('▸');
  });

  test('spec.actionable=true also emits cursor', () => {
    const spec: StatusModuleSpec = {
      kind: 'status-module',
      id: 's',
      text: 'click me',
      actionable: true,
    };
    const out = stripAnsi(renderStatusModule(spec, 'mono'));
    expect(out).toContain('▸');
  });
});

describe('expression/renderer/status-module · ANSI emission', () => {
  test('mono profile emits zero CSI', () => {
    const spec: StatusModuleSpec = {
      kind: 'status-module',
      id: 's',
      icon: '★',
      text: 'main',
      style: { fg: '#abcdef', bold: true },
    };
    expect(renderStatusModule(spec, 'mono', { style: 'pill' })).not.toContain('\x1b[');
  });

  test('truecolor emits SGR for icon and styled text', () => {
    const spec: StatusModuleSpec = {
      kind: 'status-module',
      id: 's',
      icon: '★',
      text: 'main',
      style: { fg: '#a6e3a1', bold: true },
    };
    const out = renderStatusModule(spec, 'truecolor');
    expect(out).toContain('\x1b[38;2;');
    expect(out).toContain('\x1b[1m');
  });
});

describe('expression/renderer/status-module · style propagation', () => {
  test('spec.style.fg colors the text', () => {
    const spec: StatusModuleSpec = {
      kind: 'status-module',
      id: 's',
      text: 'warn',
      style: { fg: '#f9e2af' },
    };
    expect(renderStatusModule(spec, 'truecolor')).toContain('\x1b[38;2;');
  });

  test('spec.style.bold/italic/underline applied via SGR', () => {
    const spec: StatusModuleSpec = {
      kind: 'status-module',
      id: 's',
      text: 'fancy',
      style: { fg: '#cdd6f4', bold: true, italic: true, underline: true },
    };
    const out = renderStatusModule(spec, 'truecolor');
    expect(out).toContain('\x1b[1m');
    expect(out).toContain('\x1b[3m');
    expect(out).toContain('\x1b[4m');
  });
});

describe('expression/renderer/status-module · purity', () => {
  test('same input → same output', () => {
    const spec: StatusModuleSpec = {
      kind: 'status-module',
      id: 's',
      icon: '★',
      text: 'main',
    };
    const a = renderStatusModule(spec, 'truecolor');
    const b = renderStatusModule(spec, 'truecolor');
    expect(a).toBe(b);
  });
});
