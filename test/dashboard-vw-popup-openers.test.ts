import { describe, expect, test } from 'bun:test';
import {
  openVwLocalInputTargetPopupLauncher,
  openVwRenameModalLauncher,
} from '../src/dashboard/vw-popup-openers.js';

describe('openVwLocalInputTargetPopupLauncher', () => {
  test('reuses query state and clears it after pick', () => {
    const calls: string[] = [];
    let currentDispose: (() => void) | null = null;
    let pick: ((target: { kind: string }) => void) | null = null;
    const state = new Map<number, { query: string; cursor: number }>();
    state.set(7, { query: 'me', cursor: 1 });

    openVwLocalInputTargetPopupLauncher({
      registry: {} as never,
      windowId: 7,
      stateStore: state,
      getCurrentDispose: () => currentDispose,
      setCurrentDispose: (dispose) => {
        currentDispose = dispose;
        calls.push(`set:${dispose ? 'some' : 'null'}`);
      },
      termSize: () => ({ cols: 120, rows: 40 }),
      pushModalSurface: () => ({ dispose: () => calls.push('dispose') }),
      onTargetPick: (target) => calls.push(`pick:${target.kind}`),
      redraw: () => calls.push('redraw'),
      createPopup: (opts) => {
        expect(opts.query?.()).toBe('me');
        expect(opts.cursor?.()).toBe(1);
        pick = opts.onPick as (target: { kind: string }) => void;
        return {
          surface: { id: 'vw-local-target' } as never,
          handleKey: () => false,
          dispose: () => calls.push('popup:dispose'),
        } as never;
      },
    });

    expect(calls).toEqual(['set:some', 'redraw']);
    pick?.({ kind: 'chat-main' });
    expect(calls).toEqual([
      'set:some',
      'redraw',
      'pick:chat-main',
      'set:null',
      'redraw',
    ]);
    expect(state.get(7)).toEqual({ query: '', cursor: 0 });
  });
});

describe('openVwRenameModalLauncher', () => {
  test('disposes previous modal and wires submit/cancel cleanup', () => {
    const calls: string[] = [];
    let currentDispose: (() => void) | null = () => calls.push('old-dispose');
    let submit: ((next: string) => void) | null = null;
    let cancel: (() => void) | null = null;

    openVwRenameModalLauncher({
      title: 'Rename',
      current: 'alpha',
      onSubmit: (next) => calls.push(`submit:${next}`),
      onCancel: () => calls.push('cancel'),
      getCurrentDispose: () => currentDispose,
      setCurrentDispose: (dispose) => {
        currentDispose = dispose;
        calls.push(`set:${dispose ? 'some' : 'null'}`);
      },
      termSize: () => ({ cols: 120, rows: 40 }),
      pushModalSurface: () => ({ dispose: () => calls.push('dispose') }),
      redraw: () => calls.push('redraw'),
      createModal: (opts) => {
        expect(opts.title).toBe('Rename');
        expect(opts.current).toBe('alpha');
        submit = opts.onSubmit;
        cancel = opts.onCancel ?? null;
        return {
          surface: { id: 'vw-rename' } as never,
          handleKey: () => false,
          dispose: () => calls.push('modal:dispose'),
        } as never;
      },
    });

    expect(calls).toEqual(['old-dispose', 'set:null', 'set:some', 'redraw']);

    submit?.('beta');
    expect(calls).toEqual([
      'old-dispose',
      'set:null',
      'set:some',
      'redraw',
      'set:null',
      'submit:beta',
    ]);

    calls.length = 0;
    cancel?.();
    expect(calls).toEqual(['set:null', 'cancel']);
  });
});
