import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { CODEX_TOOL_DISCIPLINE, GROK_TOOL_DISCIPLINE, streamLLMWithTools } from '../src/llm';
import type { LLMMessage, LLMProvider } from '../src/llm';

const LOCAL_TOOL_DISCIPLINE = [
  '[local tool-use discipline]',
  '- 관측 표본은 아직 두 실행뿐이다. 잠재적으로 큰 파일은 전체를 한 번에 읽기보다 먼저 심볼이나 검색으로 필요한 범위를 찾고, 범위 지정 Read 를 우선하라.',
  '- 범위 읽기만으로 판단할 수 없을 때에만 전체 읽기를 선택하고, 읽은 뒤에는 다음 행동을 계속 결정하라.',
].join('\n');

function capturingProvider() {
  const captured: LLMMessage[][] = [];
  const provider: LLMProvider = {
    name: 'capturing',
    defaultModel: 'd',
    available: () => true,
    async *streamChat(messages) {
      captured.push(messages.map((message) => ({ ...message })));
      yield { type: 'text', delta: 'done' } as const;
    },
    async *chat() {},
  };
  return { provider, firstTurn: () => captured[0] ?? [] };
}

async function runWithCapture(model: string, messages: LLMMessage[]) {
  const { provider, firstTurn } = capturingProvider();
  let completed: LLMMessage[] | undefined;
  await streamLLMWithTools(
    messages,
    {
      onText() {},
      dispatchTool: async () => 'ok',
      onTurnComplete: (history) => { completed = history; },
    },
    { provider, tools: [{ name: 'Read', description: 'd', parameters: { type: 'object' } }], maxTurns: 2, model },
  );
  return { transmitted: firstTurn(), completed };
}

describe('local tool discipline — execution-path injection', () => {
  test('local model transmits its exact separate discipline as the leading system message', async () => {
    const { transmitted } = await runWithCapture('local:gemma-4-26b-a4b-it', [{ role: 'user', content: 'go' }]);
    expect(transmitted[0]).toEqual({ role: 'system', content: LOCAL_TOOL_DISCIPLINE });
    expect(LOCAL_TOOL_DISCIPLINE).toContain('관측 표본은 아직 두 실행뿐이다');
    expect(LOCAL_TOOL_DISCIPLINE).toContain('잠재적으로 큰 파일');
    expect(LOCAL_TOOL_DISCIPLINE).toContain('범위 지정 Read 를 우선하라');
  });

  test('injection does not mutate caller history and initial-history boundary excludes the discipline', async () => {
    const input: LLMMessage[] = [{ role: 'system', content: 'caller system' }, { role: 'user', content: 'go' }];
    const before = structuredClone(input);
    const { transmitted, completed } = await runWithCapture('local:gemma-4-26b-a4b-it', input);

    expect(input).toEqual(before);
    expect(transmitted).toEqual([{ role: 'system', content: LOCAL_TOOL_DISCIPLINE }, ...before]);
    expect(completed).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }]);
  });

  test('local discipline is not transmitted to codex or grok families', async () => {
    for (const model of ['gpt-5.6-terra', 'grok-4.6']) {
      const { transmitted } = await runWithCapture(model, [{ role: 'user', content: 'go' }]);
      expect(transmitted.some((message) => message.content === LOCAL_TOOL_DISCIPLINE)).toBe(false);
    }
  });
});

describe('existing discipline bytes remain preserved', () => {
  test('codex and grok prompt hashes match their recorded baselines', () => {
    expect(createHash('sha256').update(CODEX_TOOL_DISCIPLINE, 'utf8').digest('hex')).toBe('b8623476f31f08d5e1269d7ad5edb4f922c0d820a9cfaccbe41f9756d7151d97');
    expect(createHash('sha256').update(GROK_TOOL_DISCIPLINE, 'utf8').digest('hex')).toBe('49ada854d200fe9355c03f4726a0bc7efb853f9d30d6454f72a7bd15f891ab20');
  });
});
