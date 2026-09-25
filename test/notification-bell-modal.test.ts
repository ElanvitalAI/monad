import { describe, expect, test } from 'bun:test';

import { WidgetHost } from '../src/widgets/host.js';
import { DEFAULT_THEME_TOKENS } from '../src/theme/tokens.js';
import bellModal, {
  filterEvents,
  rebuildBellEvents,
  type BellModalState,
} from '../src/notifications/bell-modal.js';
import { NotificationStore } from '../src/notifications/store.js';
import { stripAnsi } from '../src/tui.js';

function makeHost(): WidgetHost {
  return new WidgetHost({ log: () => {}, requestRender: () => {} });
}

const CTX = { width: 60, height: 8, focused: true, theme: DEFAULT_THEME_TOKENS };

function makeStore(): NotificationStore {
  let t = 1_000;
  return new NotificationStore({ now: () => ++t });
}

describe('NotificationBellModal', () => {
  test('NT4 — filterEvents by unread / errors / all', () => {
    const store = makeStore();
    const a = store.push({ sessionId: 'term:1', kind: 'status', title: 'a' });
    const b = store.push({ sessionId: 'term:2', kind: 'error', title: 'b' });
    store.markRead('term:1');
    const all = store.list();
    expect(filterEvents(all, 'a').length).toBe(2);
    expect(filterEvents(all, 'u').map(e => e.id)).toEqual([b.id]);
    expect(filterEvents(all, 'e').map(e => e.id)).toEqual([b.id]);
    void a;
  });

  test('NT4 — rebuildBellEvents wraps store.list + filter', () => {
    const store = makeStore();
    store.push({ sessionId: 'term:1', kind: 'status', title: 'x' });
    store.push({ sessionId: 'term:1', kind: 'error', title: 'y' });
    const errs = rebuildBellEvents(store, 'e');
    expect(errs.map(e => e.title)).toEqual(['y']);
  });

  test('NT4 — render shows filter chips + events + footer', () => {
    const store = makeStore();
    store.push({ sessionId: 'term:1', kind: 'status', title: 'a' });
    store.push({ sessionId: 'term:2', kind: 'error', title: 'b' });
    const host = makeHost();
    host.register(bellModal, 'builtin', '');
    const inst = host.spawn({ type: 'notification-bell', id: 'wd-bell' });
    (inst.state as BellModalState).events = store.list();
    const def = host.defFor('wd-bell')!;
    const lines = def.render(inst.state as BellModalState, CTX, 'Notifications');
    const joined = stripAnsi(lines.join('\n'));
    expect(joined).toContain('[a] All');
    expect(joined).toContain('[u] Unread');
    expect(joined).toContain('[e] Errors');
    expect(joined).toContain('term:1');
    expect(joined).toContain('term:2');
    expect(joined).toContain('Esc close');
  });

  test('NT4 — empty state shows helpful message per filter', () => {
    const host = makeHost();
    host.register(bellModal, 'builtin', '');
    const inst = host.spawn({ type: 'notification-bell', id: 'wd-bell' });
    const def = host.defFor('wd-bell')!;
    const linesAll = def.render({ events: [], cursor: 0, offset: 0, filter: 'a' }, CTX, 'Notifications');
    expect(stripAnsi(linesAll.join('\n'))).toContain('No notifications');
    const linesUnread = def.render({ events: [], cursor: 0, offset: 0, filter: 'u' }, CTX, 'Notifications');
    expect(stripAnsi(linesUnread.join('\n'))).toContain('No unread');
  });

  test('NT4 — onKey: j/k moves cursor, u/e/a flips filter, Esc closes', () => {
    const host = makeHost();
    host.register(bellModal, 'builtin', '');
    const inst = host.spawn({ type: 'notification-bell', id: 'wd-bell' });
    const ctx = host.buildContext<BellModalState>('wd-bell')!;
    const def = host.defFor('wd-bell')!;

    const state: BellModalState = {
      events: [
        { id: 'evt:1', sessionId: 'term:1', kind: 'status', ts: 1, title: 'x', read: false },
        { id: 'evt:2', sessionId: 'term:2', kind: 'error',  ts: 2, title: 'y', read: false },
      ],
      cursor: 0,
      offset: 0,
      filter: 'a',
    };
    def.onKey!({ name: 'j' } as any, state, ctx);
    expect(state.cursor).toBe(1);
    def.onKey!({ name: 'u' } as any, state, ctx);
    expect(state.filter).toBe('u');
    expect(state.cursor).toBe(0);
    const esc = def.onKey!({ name: 'escape' } as any, state, ctx);
    expect(esc).toEqual({ type: 'submit', text: 'bell:close' });
  });

  test('NT4 — Enter emits bell:focus:<sessionId>', () => {
    const host = makeHost();
    host.register(bellModal, 'builtin', '');
    const inst = host.spawn({ type: 'notification-bell', id: 'wd-bell' });
    const ctx = host.buildContext<BellModalState>('wd-bell')!;
    const def = host.defFor('wd-bell')!;
    const state: BellModalState = {
      events: [
        { id: 'evt:1', sessionId: 'term:7', kind: 'status', ts: 1, title: 'x', read: false },
      ],
      cursor: 0,
      offset: 0,
      filter: 'a',
    };
    const act = def.onKey!({ name: 'enter' } as any, state, ctx);
    expect(act).toEqual({ type: 'submit', text: 'bell:focus:term:7' });
  });
});
