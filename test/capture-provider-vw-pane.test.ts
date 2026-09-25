// H6 P6 · VW pane provider tests.
//
// Note: snapshot exercises the real captureImage + createPaneSource
// path, so tests that require actual snapshots would need a pane-
// factory stub. We focus on list semantics + id parsing; snapshot
// happy path is covered by integration tests that seed a fake pane.

import { describe, test, expect } from 'bun:test';
import {
  createVwPaneProvider,
  parseVwPaneId,
} from '../src/capture/providers/vw-pane-provider.js';

describe('vw-pane provider · list', () => {
  test('enumerates panes across windows with correct id format', () => {
    const provider = createVwPaneProvider({
      getWindows: () => [
        {
          id: 1,
          title: 'room-1',
          panes: [
            { id: 'p0', title: 'codex', kind: 'pty-tail' },
            { id: 'p1', title: 'claude', kind: 'pty-tail' },
          ],
        },
        { id: 2, panes: [{ id: 'p0', title: '', kind: 'markdown' }] },
      ],
    });
    const list = provider.list();
    expect(list.map((d) => d.id).sort()).toEqual([
      'vw-pane:1/p0',
      'vw-pane:1/p1',
      'vw-pane:2/p0',
    ]);
  });

  test('empty window list → empty descriptor list', () => {
    const provider = createVwPaneProvider({ getWindows: () => [] });
    expect(provider.list()).toEqual([]);
  });

  test('getWindows throwing → empty list (D10 isolation shift)', () => {
    const provider = createVwPaneProvider({
      getWindows: () => { throw new Error('vw registry failed'); },
    });
    expect(provider.list()).toEqual([]);
  });

  test('label includes window + pane titles when present', () => {
    const provider = createVwPaneProvider({
      getWindows: () => [{
        id: 7,
        title: 'my room',
        panes: [{ id: 'p3', title: 'exec', kind: 'pty-tail' }],
      }],
    });
    const [d] = provider.list();
    expect(d!.label).toContain('my room');
    expect(d!.label).toContain('exec');
  });

  test('summary reflects pane kind', () => {
    const provider = createVwPaneProvider({
      getWindows: () => [{
        id: 1,
        panes: [{ id: 'p0', title: '', kind: 'markdown' }],
      }],
    });
    expect(provider.list()[0]!.summary).toContain('markdown');
  });

  test('descriptors carry canonical terminal observation provenance', () => {
    const provider = createVwPaneProvider({
      getWindows: () => [{
        id: 1,
        panes: [{ id: 'p0', title: '', kind: 'markdown' }],
      }],
    });
    expect(provider.list()[0]!.sourceRef).toEqual({
      kind: 'terminal',
      provider: 'tui',
      deviceId: '1',
      sessionId: 'p0',
      capabilities: ['observe', 'render'],
    });
  });

  test('supported formats include text/ansi/png/svg/asciicast', () => {
    const provider = createVwPaneProvider({
      getWindows: () => [{ id: 1, panes: [{ id: 'p0', title: '', kind: 'x' }] }],
    });
    const formats = provider.list()[0]!.formats;
    expect(formats).toEqual(expect.arrayContaining(['text', 'ansi', 'png', 'svg']));
  });
});

describe('parseVwPaneId', () => {
  test('splits windowId and paneId', () => {
    expect(parseVwPaneId('vw-pane:5/p12')).toEqual({ windowId: '5', paneId: 'p12' });
  });

  test('rejects missing prefix', () => {
    expect(() => parseVwPaneId('pane:5/p12')).toThrow(/vw-pane:/);
  });

  test('rejects missing slash', () => {
    expect(() => parseVwPaneId('vw-pane:5p12')).toThrow(/windowId/);
  });
});
