import { describe, expect, test } from 'bun:test';
import type { LLMToolSpec } from '../src/llm.js';
import { debug } from '../src/debug/log.js';
import { buildDashboardOptionalToolSpecs } from '../src/dashboard/optional-tool-spec-runtime.js';
import { recordDashboardToolCatalog } from '../src/dashboard/tool-catalog-observability.js';
import { buildSessionRuntimeToolSpecs } from '../src/session-runtime/index.js';
import {
  _resetToolRuntimeRegistryForTest,
  listToolRuntimes,
  registerAllDefaultToolRuntimes,
} from '../src/tool-runtime/index.js';

const tool = (name: string): LLMToolSpec => ({
  name,
  description: '',
  parameters: { type: 'object' },
});

/** ⛔ 전역 diag 상태를 무조건 false 로 덮지 않는다 — 이 파일이 다른 테스트의 설정을
 *  조용히 끄면, 끄고 나서 실패하는 테스트의 원인이 여기라는 것을 아무도 못 찾는다(리뷰 should-fix). */
function withDiag<T>(fn: () => T): T {
  const prev = debug.enabled;
  debug.setDiagEnabled(true);
  try { return fn(); } finally { debug.setDiagEnabled(prev); }
}

describe('dashboard tool catalog observability', () => {
  test('records every assembled tool name with its surface and assembler', () => {
    const records: Array<{ category: string; event: string; data: unknown }> = [];
    const off = debug.registerSink({
      name: 'dashboard-tool-catalog-observability-test',
      emit: (record) => records.push({
        category: record.category,
        event: record.event,
        data: record.data,
      }),
    });

    try {
      withDiag(() => recordDashboardToolCatalog('tui-session-42', [
        tool('Read'), tool('Grep'), tool('Glob'), tool('ListDir'), tool('Edit'), tool('Write'),
        tool('SelfImplement'), tool('ToolSearch'),
      ]));
    } finally {
      off?.();
    }

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      category: 'capability.resolve',
      event: 'tool-catalog-assembled',
      data: {
        sessionId: 'tui-session-42',
        surface: 'tui-dashboard',
        assembler: 'buildSessionRuntimeToolSpecs',
        toolCount: 8,
        tools: ['Read', 'Grep', 'Glob', 'ListDir', 'Edit', 'Write', 'SelfImplement', 'ToolSearch'],
      },
    });
  });

  test('records the complete TUI runtime assembly', () => {
    _resetToolRuntimeRegistryForTest();
    const optionalTools = buildDashboardOptionalToolSpecs({
      userConfig: {
        shell: {
          allowDashboardOptionalTools: true,
          allowDashboardBash: false,
          allowDashboardTerminalInject: false,
          allowDashboardApiCall: false,
          allowDashboardRunShell: false,
          allowDashboardState: false,
        },
      } as any,
      termSize: () => ({ cols: 80, rows: 24 }),
      registerAllDefaultToolRuntimes,
      setTerminalModalRuntimeDeps: () => {},
      buildBashTool: () => tool('Bash'),
      buildTerminalInjectTool: () => tool('TerminalInject'),
      buildApiCallTool: () => tool('ApiCall'),
      buildRunShellTool: () => tool('RunShell'),
      buildDashboardStateTool: () => tool('GetDashboardState'),
      buildTerminalModalTools: () => [],
    });
    const tools = buildSessionRuntimeToolSpecs({
      userText: 'run this command in a PTY shell',
      hostTools: [],
      runtimeTools: listToolRuntimes('tui'),
      optionalTools,
    });
    const names = tools.map((tool) => tool.name);
    const records: Array<{ category: string; event: string; data: { tools: string[] } }> = [];
    const off = debug.registerSink({
      name: 'dashboard-pty-catalog-assembly-test',
      emit: (record) => records.push({
        category: record.category,
        event: record.event,
        data: record.data as { tools: string[] },
      }),
    });

    try {
      withDiag(() => recordDashboardToolCatalog('tui-pty-runtime-assembly', tools));
    } finally {
      off?.();
      _resetToolRuntimeRegistryForTest();
    }

    expect(names).toEqual([
      'Read', 'Grep', 'Glob', 'ListDir', 'Edit', 'Write',
      'Agent', 'AgentOutput', 'AgentReply', 'AgentStop', 'AgentList',
      'Bash', 'RunShell', 'PtyShellStart', 'PtyShellPoll', 'PtyShellSend',
      'PtyShellKill', 'PtyShellList', 'run_tests', 'monad_skills_list', 'skill_exec',
    ]);
    expect(new Set(names).size).toBe(names.length);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      category: 'capability.resolve',
      event: 'tool-catalog-assembled',
      data: { tools: names },
    });
    expect(new Set(records[0]!.data.tools).size).toBe(records[0]!.data.tools.length);
  });

  // ⛔ 배열 상한만 풀면 `stringMax`(256)가 긴 이름을 자른다. 잘린 이름은
  //    "그 툴이 카탈로그에 있었나" 에 **틀린 답**을 주고, 그것이 이 이벤트의 존재 이유다.
  test('a pathologically long tool name is not clipped either', () => {
    const longName = `Tool${'X'.repeat(400)}`;
    const records: Array<{ data: unknown }> = [];
    const off = debug.registerSink({
      name: 'dashboard-tool-catalog-long-name-test',
      emit: (record) => records.push({ data: record.data }),
    });
    try {
      withDiag(() => recordDashboardToolCatalog('tui-session-43', [tool(longName)]));
    } finally {
      off?.();
    }
    const data = records[0]?.data as { tools: string[] };
    expect(data.tools).toEqual([longName]);
    expect(data.tools[0]).toHaveLength(longName.length);
  });
});
