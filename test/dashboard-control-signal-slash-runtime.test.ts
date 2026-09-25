import { describe, expect, test } from 'bun:test';

import { createControlSignalBus } from '../src/input/control-signal.js';
import { createControlSignalObserver } from '../src/input/control-signal-observer.js';
import { createDashboardControlSignalSlashRuntime } from '../src/dashboard/control-signal-slash-runtime.js';

describe('dashboard control signal slash runtime', () => {
  test('renders status and latest/list views from observer data', () => {
    const bus = createControlSignalBus(() => new Date().toISOString());
    const observer = createControlSignalObserver(bus);
    const runtime = createDashboardControlSignalSlashRuntime({
      accent: (text) => `accent:${text}`,
      muted: (text) => `muted:${text}`,
      warning: (text) => `warning:${text}`,
      observer,
      signalBus: bus,
    });

    bus.emit({
      kind: 'turn-submit-begin',
      urgency: 'normal',
      source: 'system',
      scope: { surface: 'chat-main', channel: 'dashboard' },
    });
    bus.emit({
      kind: 'voice-chat-stop',
      urgency: 'quick-pass',
      source: 'sensor',
      scope: { surface: 'voice-chat', channel: 'dashboard' },
    });

    const status = runtime.statusLines();
    expect(status[0]).toContain('control-signals: 2 observed');
    expect(status[1]).toContain('turn-submit-begin');
    expect(status[2]).toContain('voice-chat-stop');

    const latest = runtime.latestLines({ surface: 'voice-chat' });
    expect(latest).toHaveLength(1);
    expect(latest[0]).toContain('voice-chat-stop');
    expect(latest[0]).toContain('quick-pass');

    const listed = runtime.listLines(5, { channel: 'dashboard' });
    expect(listed).toHaveLength(2);
  });

  test('parses filter tokens and clears observer timeline', () => {
    const bus = createControlSignalBus(() => new Date().toISOString());
    const observer = createControlSignalObserver(bus);
    const runtime = createDashboardControlSignalSlashRuntime({
      accent: (text) => text,
      muted: (text) => text,
      warning: (text) => text,
      observer,
      signalBus: bus,
    });

    const parsed = runtime.parseFilterTokens([
      '15',
      'kind=voice-chat-stop',
      'surface=voice-chat',
      'channel=dashboard',
      'session=s-1',
      'urgency=quick-pass',
    ]);
    expect(parsed.limit).toBe(15);
    expect(parsed.filter).toEqual({
      kind: 'voice-chat-stop',
      surface: 'voice-chat',
      channel: 'dashboard',
      sessionId: 's-1',
      minUrgency: 'quick-pass',
    });

    bus.emit({
      kind: 'voice-chat-stop',
      urgency: 'quick-pass',
      source: 'sensor',
      scope: { surface: 'voice-chat', channel: 'dashboard' },
    });
    expect(runtime.statusLines()[0]).toContain('1 observed');
    observer.clear();
    expect(runtime.statusLines()).toEqual(['  control-signals: empty']);
  });

  test('emits local slash signals onto the shared bus', () => {
    const bus = createControlSignalBus(() => new Date().toISOString());
    const observer = createControlSignalObserver(bus);
    const runtime = createDashboardControlSignalSlashRuntime({
      accent: (text) => text,
      muted: (text) => text,
      warning: (text) => text,
      observer,
      signalBus: bus,
    });

    expect(
      runtime.emitLines([
        'kind=tool-exposure-stop',
        'urgency=quick-pass',
        'surface=chat-main',
        'channel=dashboard',
        'session=s-1',
        'mayPreempt=true',
      ])[0],
    ).toContain('emitted tool-exposure-stop');

    const latest = observer.latest({ kind: 'tool-exposure-stop' });
    expect(latest?.urgency).toBe('quick-pass');
    expect(latest?.source).toEqual({ kind: 'keyboard', surface: 'dashboard-chat-main' });
    expect(latest?.scope).toEqual({
      surface: 'chat-main',
      channel: 'dashboard',
      sessionId: 's-1',
    });
    expect(latest?.mayPreempt).toBe(true);

    expect(runtime.emitLines(['urgency=quick-pass'])).toEqual([
      '  control-signals: kind=... required',
    ]);
  });
});
