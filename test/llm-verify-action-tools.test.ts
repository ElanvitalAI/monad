import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { streamLLMWithTools } from '../src/llm';
import type { ContentBlock, LLMMessage, LLMProvider, LLMStreamEvent } from '../src/llm';
import { debug } from '../src/debug/log';
import type { LogSink } from '../src/mss/logging/sink';

const TOOLS = ['Edit', 'Write', 'Bash', 'Glob', 'Grep', 'Plan', 'MarkStepDone'].map((name) => ({
  name,
  description: 'd',
  parameters: { type: 'object' },
}));

function scriptedProvider(turns: LLMStreamEvent[][]) {
  let call = 0;
  const captured: LLMMessage[][] = [];
  const provider: LLMProvider = {
    name: 'scripted',
    defaultModel: 'd',
    available: () => true,
    async *streamChat(messages) {
      captured.push(messages.map((message) => ({ ...message })));
      for (const event of turns[call++] ?? []) yield event;
    },
    async *chat() {},
  };
  return { provider, capturedMessagesAt: (index: number) => captured[index] };
}

function lastToolResult(messages: LLMMessage[] | undefined): string | null {
  const results = toolResultsFrom(messages);
  return results.length > 0 ? results[results.length - 1]! : null;
}

function toolResultsFrom(messages: LLMMessage[] | undefined): string[] {
  if (!messages) return [];
  const results: string[] = [];
  for (const message of messages) {
    if (message.role !== 'user' || typeof message.content === 'string') continue;
    for (const block of message.content as ContentBlock[]) {
      if (block.type !== 'tool_result') continue;
      results.push(typeof block.content === 'string' ? block.content : JSON.stringify(block.content));
    }
  }
  return results;
}

function noneRejected(messages: LLMMessage[] | undefined): boolean {
  return toolResultsFrom(messages).every((result) => !result.includes('TOOL CALL REJECTED'));
}

describe('streamLLMWithTools — verify action tools', () => {
  test('permits Edit, Write, and Bash after an edit without a rejection stub', async () => {
    let dispatched = 0;
    const { provider, capturedMessagesAt } = scriptedProvider([
      [{ type: 'tool_call', id: 'edit', name: 'Edit', args: { file_path: '/tmp/source.ts', old_string: 'a', new_string: 'b' } }],
      [{ type: 'tool_call', id: 'write', name: 'Write', args: { file_path: '/tmp/source.test.ts', content: 'test' } }],
      [{ type: 'tool_call', id: 'bash', name: 'Bash', args: { command: 'bun test /tmp/source.test.ts' } }],
      [{ type: 'text', delta: 'verified' }],
    ]);

    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      { onText() {}, dispatchTool: async () => { dispatched++; return 'ok'; } },
      { provider, tools: TOOLS, maxTurns: 30 },
    );

    expect(result).toContain('verified');
    expect(dispatched).toBe(3);
    for (const index of [1, 2, 3]) {
      expect(lastToolResult(capturedMessagesAt(index))).not.toContain('TOOL CALL REJECTED');
    }
  });

  test('rejects consecutive Glob-only turns after Edit and hard-stops on the second', async () => {
    let dispatched = 0;
    const { provider, capturedMessagesAt } = scriptedProvider([
      [{ type: 'tool_call', id: 'edit', name: 'Edit', args: { file_path: '/tmp/source.ts', old_string: 'a', new_string: 'b' } }],
      [{ type: 'tool_call', id: 'glob-one', name: 'Glob', args: { pattern: '**/*.test.ts' } }],
      [{ type: 'tool_call', id: 'glob-two', name: 'Glob', args: { pattern: '**/*.ts' } }],
    ]);

    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      { onText() {}, dispatchTool: async () => { dispatched++; return 'ok'; } },
      { provider, tools: TOOLS, maxTurns: 30 },
    );

    expect(dispatched).toBe(1);
    expect(lastToolResult(capturedMessagesAt(2))).toContain('TOOL CALL REJECTED');
    expect(result).toContain('[VERIFY IGNORED]');
  });

  const edit = (id: string, oldString = 'a', newString = 'b'): LLMStreamEvent[] => [
    { type: 'tool_call', id, name: 'Edit', args: { file_path: '/tmp/source.ts', old_string: oldString, new_string: newString } },
  ];
  const bash = (id: string, command: string): LLMStreamEvent[] => [
    { type: 'tool_call', id, name: 'Bash', args: { command } },
  ];
  const markStepDone = (id: string): LLMStreamEvent => ({
    type: 'tool_call',
    id,
    name: 'MarkStepDone',
    args: { stepIndex: 0, status: 'done' },
  });
  const failedBash = { output: '1 failed', exitCode: 1, outcome: 'exit' as const };
  const passedBash = { output: 'ok', exitCode: 0, outcome: 'exit' as const };
  const rejectedFollowups = (prefix: string): LLMStreamEvent[][] => [
    [{ type: 'tool_call', id: `${prefix}-one`, name: 'Glob', args: { pattern: '**/*.ts' } }],
    [{ type: 'tool_call', id: `${prefix}-two`, name: 'Glob', args: { pattern: '**/*.test.ts' } }],
    [{ type: 'text', delta: 'hard-stop observed' }],
  ];

  test('keeps a verified tree current and retains the hard-stop final-answer path without another shell', async () => {
    const { provider } = scriptedProvider([
      edit('edit'),
      bash('verify-failed', 'bun test /tmp/source.test.ts'),
      bash('verify-passed', 'bun test /tmp/source.test.ts'),
      ...rejectedFollowups('current'),
    ]);
    let verificationAttempt = 0;
    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      {
        onText() {},
        dispatchTool: async (name) => name === 'Bash'
          ? ++verificationAttempt === 1
            ? { output: '1 failed', exitCode: 1, outcome: 'exit' }
            : { output: '1 passed', exitCode: 0, outcome: 'exit' }
          : 'PASS',
      },
      { provider, tools: TOOLS, maxTurns: 30 },
    );

    expect(result).toContain('[FINAL ANSWER REQUIRED]');
    expect(result).toContain('검증 명령: bun test /tmp/source.test.ts');
    expect(result).not.toContain('검증 최신성 상태: 미지');
  });

  test('transitions current to unknown once for the first unarmed shell, preserves its command, and disables hard-stop finalization', async () => {
    const events: Array<{ event: string; data: unknown }> = [];
    const sink: LogSink = {
      name: 'verification-freshness-test',
      emit(record) {
        if (record.event === 'tool-loop.verification-freshness-unknown') {
          events.push({ event: record.event, data: record.data });
        }
      },
    };
    const unregister = debug.registerSink(sink);
    try {
      const { provider } = scriptedProvider([
        edit('edit'),
        bash('verify-failed', 'bun test /tmp/source.test.ts'),
        bash('verify-passed', 'bun test /tmp/source.test.ts'),
        bash('shell-one', 'python3 rewrite-first.ts'),
        bash('shell-two', 'python3 rewrite-second.ts'),
        ...rejectedFollowups('unknown'),
      ]);
      let verificationAttempt = 0;
      const result = await streamLLMWithTools(
        [{ role: 'user', content: 'go' }],
        {
          onText() {},
          dispatchTool: async (name) => name === 'Bash'
          ? ++verificationAttempt === 1
            ? { output: '1 failed', exitCode: 1, outcome: 'exit' }
            : { output: '1 passed', exitCode: 0, outcome: 'exit' }
          : 'PASS',
        },
        { provider, tools: TOOLS, maxTurns: 30 },
      );

      expect(result).not.toContain('[FINAL ANSWER REQUIRED]');
      expect(result).toContain('검증 최신성 상태: 미지');
      expect(result).toContain('bun test /tmp/source.test.ts -> PASS');
      expect(result).not.toContain('검증 최신성 상태: 최신');
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        event: 'tool-loop.verification-freshness-unknown',
        data: expect.objectContaining({ command: 'python3 rewrite-first.ts' }),
      });
    } finally {
      unregister();
    }
  });

  test('does not mark a shell unknown before a successful verification exists', async () => {
    const { provider } = scriptedProvider([
      bash('shell', 'git diff --stat'),
      [{ type: 'text', delta: 'final answer' }],
    ]);

    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      { onText() {}, dispatchTool: async () => 'PASS' },
      { provider, tools: TOOLS, maxTurns: 30 },
    );

    expect(result).not.toContain('검증 최신성 상태: 미지');
  });

  test('a successful verification after unknown freshness restores current', async () => {
    const { provider } = scriptedProvider([
      edit('edit'),
      bash('verify-one', 'bun test /tmp/source.test.ts'),
      bash('shell', 'git diff --stat'),
      edit('edit-two', 'b', 'c'),
      bash('verify-two', 'bun test /tmp/source.test.ts'),
      [{ type: 'text', delta: 'final answer' }],
    ]);

    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      { onText() {}, dispatchTool: async () => 'PASS' },
      { provider, tools: TOOLS, maxTurns: 30 },
    );

    expect(result).toContain('검증 명령: bun test /tmp/source.test.ts');
    expect(result).not.toContain('검증 최신성 상태: 미지');
  });

  test('repair phase dispatches a MarkStepDone-only batch without a rejection stub', async () => {
    const dispatched: string[] = [];
    const { provider, capturedMessagesAt } = scriptedProvider([
      bash('fail', 'bun test /tmp/source.test.ts'),
      [markStepDone('msd-repair')],
      [{ type: 'text', delta: 'repaired' }],
    ]);

    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      {
        onText() {},
        dispatchTool: async (name) => {
          dispatched.push(name);
          return name === 'Bash' ? failedBash : 'ok';
        },
      },
      { provider, tools: TOOLS, maxTurns: 30 },
    );

    expect(result).toContain('repaired');
    expect(dispatched).toEqual(['Bash', 'MarkStepDone']);
    expect(noneRejected(capturedMessagesAt(2))).toBe(true);
  });

  test('repair phase dispatches MarkStepDone together with Bash', async () => {
    const dispatched: string[] = [];
    let bashCalls = 0;
    const { provider, capturedMessagesAt } = scriptedProvider([
      bash('fail', 'bun test /tmp/source.test.ts'),
      [
        markStepDone('msd-repair-mix'),
        { type: 'tool_call', id: 'bash-repair', name: 'Bash', args: { command: 'rg -n test src/llm.ts' } },
      ],
      [{ type: 'text', delta: 'repaired' }],
    ]);

    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      {
        onText() {},
        dispatchTool: async (name) => {
          dispatched.push(name);
          if (name !== 'Bash') return 'ok';
          bashCalls++;
          return bashCalls === 1 ? failedBash : passedBash;
        },
      },
      { provider, tools: TOOLS, maxTurns: 30 },
    );

    expect(result).toContain('repaired');
    expect(dispatched).toEqual(['Bash', 'MarkStepDone', 'Bash']);
    expect(noneRejected(capturedMessagesAt(2))).toBe(true);
  });

  test('verify phase dispatches a MarkStepDone-only batch without a rejection stub', async () => {
    const dispatched: string[] = [];
    const { provider, capturedMessagesAt } = scriptedProvider([
      edit('edit'),
      [markStepDone('msd-verify')],
      [{ type: 'text', delta: 'verified' }],
    ]);

    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      {
        onText() {},
        dispatchTool: async (name) => {
          dispatched.push(name);
          return 'ok';
        },
      },
      { provider, tools: TOOLS, maxTurns: 30 },
    );

    expect(result).toContain('verified');
    expect(dispatched).toEqual(['Edit', 'MarkStepDone']);
    expect(noneRejected(capturedMessagesAt(2))).toBe(true);
  });

  test('verify phase dispatches MarkStepDone together with Bash', async () => {
    const dispatched: string[] = [];
    const { provider, capturedMessagesAt } = scriptedProvider([
      edit('edit'),
      [
        markStepDone('msd-verify-mix'),
        { type: 'tool_call', id: 'bash-verify', name: 'Bash', args: { command: 'bun test /tmp/source.test.ts' } },
      ],
      [{ type: 'text', delta: 'verified' }],
    ]);

    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      {
        onText() {},
        dispatchTool: async (name) => {
          dispatched.push(name);
          return name === 'Bash' ? passedBash : 'ok';
        },
      },
      { provider, tools: TOOLS, maxTurns: 30 },
    );

    expect(result).toContain('verified');
    expect(dispatched).toEqual(['Edit', 'MarkStepDone', 'Bash']);
    expect(noneRejected(capturedMessagesAt(2))).toBe(true);
  });

  test('verify phase still permits Grep content and count after an edit', async () => {
    const dispatched: string[] = [];
    const { provider, capturedMessagesAt } = scriptedProvider([
      edit('edit'),
      [{ type: 'tool_call', id: 'grep-content', name: 'Grep', args: { pattern: 'foo', output_mode: 'content' } }],
      [{ type: 'tool_call', id: 'grep-count', name: 'Grep', args: { pattern: 'foo', output_mode: 'count' } }],
      [{ type: 'text', delta: 'verified' }],
    ]);

    const result = await streamLLMWithTools(
      [{ role: 'user', content: 'go' }],
      {
        onText() {},
        dispatchTool: async (name) => {
          dispatched.push(name);
          return 'ok';
        },
      },
      { provider, tools: TOOLS, maxTurns: 30 },
    );

    expect(result).toContain('verified');
    expect(dispatched).toEqual(['Edit', 'Grep', 'Grep']);
    expect(noneRejected(capturedMessagesAt(2))).toBe(true);
    expect(noneRejected(capturedMessagesAt(3))).toBe(true);
  });

  test('verify and repair allowlists both include Edit and Write', () => {
    const source = readFileSync(new URL('../src/llm.ts', import.meta.url), 'utf8');
    const toolsIn = (name: string) => {
      const match = source.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
      return match![1]!.match(/'([^']+)'/g)?.map((tool) => tool.slice(1, -1)) ?? [];
    };

    const verify = toolsIn('VERIFY_ACTION_TOOLS');
    const repair = toolsIn('REPAIR_ACTION_TOOLS');
    for (const tool of ['Edit', 'Write']) {
      expect(verify.includes(tool)).toBe(repair.includes(tool));
      expect(verify.includes(tool)).toBe(true);
    }
  });
});
