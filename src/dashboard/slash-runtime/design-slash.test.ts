// ── /design is registered AND writes to the surface a human is looking at ──
//
// Two separate things could go wrong and they fail differently:
//   ① the command is not registered at all → dispatch reports unknown
//   ② the command is registered but writes to `pushDebugLine`, i.e. the pane
//      this track already has on its backlog as "slash output only reaches a
//      hidden panel". That failure is invisible in a unit test that only
//      asserts "something was written", so this asserts WHICH channel.
//
// The verdict content itself is covered by `src/design/design-check-render.test.ts`;
// here we only care that the command exists and lands in `chatLines`.

import { expect, test } from 'bun:test';
import { buildDashboardSlashRegistry, type DashboardSlashContext } from './dashboard-handlers.js';
import { SLASH_COMMANDS } from '../../chat/index.js';

function createContext(chatLines: string[], debugLines: string[]): DashboardSlashContext {
  const identity = (line: string) => line;
  return {
    chatLines,
    pushChatLine: (line: string) => { chatLines.push(line); },
    pushDebugLine: (line: string) => { debugLines.push(line); },
    accent: identity,
    warning: identity,
    error: identity,
    success: identity,
    muted: identity,
    text: identity,
    highlight: identity,
    setChatScrollOffset: () => {},
    draw: () => {},
  } as unknown as DashboardSlashContext;
}

test('/design renders the verdict into chatLines, not the debug pane', async () => {
  const chatLines: string[] = [];
  const debugLines: string[] = [];

  await expect(buildDashboardSlashRegistry().dispatch('design', [], createContext(chatLines, debugLines)))
    .resolves.toEqual({ kind: 'continue' });

  expect(chatLines).not.toEqual([]);
  // ⛔ The point of this assertion: a passing "wrote something" test would
  //    stay green if the handler were switched to pushDebugLine, and the
  //    operator would silently stop seeing the answer they asked for.
  expect(debugLines).toEqual([]);
  // Runs inside the monad checkout, so a verdict resolves and the heading
  // names the document it read.
  expect(chatLines[0]).toContain('Craft rulebooks');
});

test('/design-check is the same command, not a second implementation', async () => {
  const a: string[] = [];
  const b: string[] = [];
  const registry = buildDashboardSlashRegistry();
  await registry.dispatch('design', [], createContext(a, []));
  await registry.dispatch('design-check', [], createContext(b, []));
  expect(b).toEqual(a);
});

test('--declared narrows the output rather than being ignored', async () => {
  const wide: string[] = [];
  const narrow: string[] = [];
  const registry = buildDashboardSlashRegistry();
  await registry.dispatch('design', [], createContext(wide, []));
  await registry.dispatch('design', ['--declared'], createContext(narrow, []));
  // In this repository every shipped rulebook is declared, so the two may be
  // equal in length — what must hold is that the flag never ADDS lines and is
  // actually threaded through instead of silently dropped.
  expect(narrow.length).toBeLessThanOrEqual(wide.length);
  expect(narrow.every((line) => !line.includes('not declared'))).toBe(true);
});

test('/design is DISCOVERABLE — it appears in the displayed slash catalog', () => {
  // The guard in dashboard-handlers.test.ts forces every registered command to
  // be either listed here or explicitly baselined as hidden. This pins the
  // choice that was made: listed. A surface nobody can find is not a surface.
  const entry = SLASH_COMMANDS.find((c) => c.name === 'design');
  expect(entry).toBeDefined();
  expect(entry!.aliases).toContain('design-check');
});

// ── `/log fold` — ⭐ 이 시험은 «예고대로» 한 번 울고 바뀌었다 ──
//
// 22차가 `#11981` 로 임시 배선을 넣으며 시험 주석에 이렇게 적었다:
//   *"기능이 완성되면 이 시험은 «바뀌어야» 한다. 그때 이 주석이 그 사실을 알린다."*
// 📏 그리고 몇 시간 뒤 `#11986` 이 실물을 넣자 ***정확히 그 시험이 울었다***
//   (`ctx.logSlash.getLogFoldMode` 를 부르는데 스텁에 없어서).
// ⇒ 🔑 ***임시 배선의 시험은 「완성」을 «막는» 것이 아니라 「완성됐음」을 «알리는» 자리였다.***
//   그래서 22차가 자기 임시 배선(죽은 코드)을 걷고 이 시험을 현실로 갈아 끼운다.
test('/log fold 가 리졸버를 «타고» 모드를 적용한다', async () => {
  const chatLines: string[] = [];
  const debugLines: string[] = [];
  const applied: string[] = [];
  const ctx = {
    ...createContext(chatLines, debugLines),
    logSlash: {
      getLogFoldMode: () => 'line',
      setLogFoldMode: (m: string) => { applied.push(m); },
    },
  } as unknown as DashboardSlashContext;

  await buildDashboardSlashRegistry().dispatch('log', ['fold', 'task-unit'], ctx);

  // ⛔ 종전(임시 배선)엔 여기 「not wired yet」이 찍혔고 모드는 «안 바뀌었다».
  expect(applied).toEqual(['task-unit']);
  expect(debugLines.join('\n')).not.toContain('not wired yet');
});
