// NEXUS · webterm view (N-1 cleanup PR d) — render tests.
//
// Covers createWebtermTabView in both render paths:
//   - placeholder (no session) — surfaces PR e roadmap + monad legacy hint
//   - session present — header / output / footer wiring across status
//     enum values (inert / running / exited / error)
//
// Mirrors test/nexus-chat-view.test.ts in shape.

import { describe, expect, test } from 'bun:test';

import { Printer } from '../src/ui/printer.js';
import { createWebtermTabSpec, createWebtermTabView } from '../src/nexus/kinds/webterm.js';
import { NexusWebtermSession } from '../src/nexus/webterm/session.js';
// ⛔ 종전 경로 '../src/nexus/shell/mini-terminal.js' 는 «존재하지 않는 모듈»이었다(그 디렉터리가 비어 있다).
//   타입 전용 들여오기라 런타임은 지워서 지나가고, tsconfig 가 test/** 를 안 봐서 tsc 도 못 봤다.
//   ⇒ 이 시험의 `PtyBackend` 계약은 «허구»였다. 실제 정의가 있는 곳으로 되돌린다.
import { type PtyBackend } from '../src/nexus/webterm/pty.js';

function renderToText(view: ReturnType<typeof createWebtermTabView>): string {
  const printer = Printer.create({ width: 80, height: 24, focused: true });
  view.layout({ width: 80, height: 24 });
  view.draw(printer);
  return printer.lines().join('\n');
}

interface FakeView extends PtyBackend {
  emit: (c: string) => void;
  triggerExit: (info: { exitCode: number }) => void;
}

function makeFakeBackend(initial: string[] = [], pid = 9001): FakeView {
  let dataCb: ((c: string) => void) | null = null;
  let exitCb: ((i: { exitCode: number }) => void) | null = null;
  return {
    pid,
    onData(cb) { dataCb = cb; for (const c of initial) cb(c); return () => { dataCb = null; }; },
    onExit(cb) { exitCb = cb; return () => { exitCb = null; }; },
    write() { /* noop */ },
    kill() { /* noop */ },
    emit(chunk: string) { dataCb?.(chunk); },
    triggerExit(info) { exitCb?.(info); },
  };
}

describe('createWebtermTabView · placeholder', () => {
  test('no session → surfaces PR e roadmap + monad legacy hint', () => {
    const spec = createWebtermTabSpec({ id: 'webterm:1', label: 'webterm#1' });
    const out = renderToText(createWebtermTabView(spec));
    expect(out).toContain('webterm tab · webterm:1');
    expect(out).toContain('PR d');
    expect(out).toContain('PR e');
    expect(out).toContain('monad legacy');
  });
});

describe('createWebtermTabView · session present', () => {
  test('inert session shows the no-PTY status + hint about backend factory', () => {
    const spec = createWebtermTabSpec({ id: 'webterm:1' });
    const sess = new NexusWebtermSession();
    const out = renderToText(createWebtermTabView(spec, sess));
    expect(out).toContain('webterm tab · webterm:1');
    expect(out).toContain('inert (no PTY backend)');
    expect(out).toContain('no PTY backend attached');
  });

  test('running session shows pid + waiting-for-output hint when buffer empty', () => {
    const spec = createWebtermTabSpec({ id: 'webterm:1' });
    const fb = makeFakeBackend([], 7777);
    const sess = new NexusWebtermSession({ spawn: () => fb });
    const out = renderToText(createWebtermTabView(spec, sess));
    expect(out).toContain('running');
    expect(out).toContain('pid 7777');
    expect(out).toContain('waiting for first chunk');
    expect(out).toContain('Ctrl-C exits the TUI loop');
  });

  test('running session renders accumulated output lines', () => {
    const spec = createWebtermTabSpec({ id: 'webterm:1' });
    const fb = makeFakeBackend(['hello\n', 'world\n']);
    const sess = new NexusWebtermSession({ spawn: () => fb });
    const out = renderToText(createWebtermTabView(spec, sess));
    expect(out).toContain('hello');
    expect(out).toContain('world');
  });

  test('exited session surfaces exit code footer', () => {
    const spec = createWebtermTabSpec({ id: 'webterm:1' });
    const fb = makeFakeBackend(['done\n']);
    const sess = new NexusWebtermSession({ spawn: () => fb });
    fb.triggerExit({ exitCode: 130 });
    const out = renderToText(createWebtermTabView(spec, sess));
    expect(out).toContain('exited');
    expect(out).toContain('exited · code 130');
  });

  test('error from missing-spawn factory surfaces last error footer', () => {
    const spec = createWebtermTabSpec({ id: 'webterm:1' });
    const sess = new NexusWebtermSession({
      spawn: () => { throw new Error('spawn-test-fail'); },
    });
    const out = renderToText(createWebtermTabView(spec, sess));
    expect(out).toContain('error');
    expect(out).toContain('spawn-test-fail');
  });
});
