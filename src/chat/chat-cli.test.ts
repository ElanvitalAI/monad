import { describe, it, expect } from 'bun:test';
import { runChatCliCommand, toDevChatOpts, type ChatCliDeps } from './chat-cli.js';
import type { runDevPipeline, DevPipelineSpec, DevPipelineDeps, DevChatOpts, ResolvedDevPlan } from '../self-dev/dev-pipeline.js';

describe('toDevChatOpts — CLI 옵션 → DevChatOpts 매핑(무손실)', () => {
  it('--new→forceNew · json/tools/goalLoop→boolean · session 통과', () => {
    expect(toDevChatOpts({ session: 's1', new: true, json: true, tools: true, goalLoop: true }))
      .toEqual({ session: 's1', forceNew: true, json: true, enableTools: true, goalLoop: true });
  });
  it('옵션 없음 → 전부 false · session 생략(undefined)', () => {
    expect(toDevChatOpts({})).toEqual({ forceNew: false, json: false, enableTools: false, goalLoop: false });
  });
  it('빈 문자열 session 도 통과(!== undefined·원 explicitSessionId 정확 등가)', () => {
    expect(toDevChatOpts({ session: '' }).session).toBe(''); // 누락 아님 — 중간값까지 무손실
  });
});

describe('runChatCliCommand — interactive 재라우팅 글루', () => {
  it('interactive spec 빌드 + runChatTurn 을 runDevPipeline deps 로 주입', async () => {
    let gotSpec: DevPipelineSpec | undefined;
    let gotDeps: DevPipelineDeps | undefined;
    const runChatTurn = async (): Promise<void> => {};
    const fakeRun = (async (spec: DevPipelineSpec, deps: DevPipelineDeps) => {
      gotSpec = spec; gotDeps = deps;
      return { plan: {} as ResolvedDevPlan, kind: 'interactive' as const, result: null };
    }) as typeof runDevPipeline;
    await runChatCliCommand('hi', { new: true, tools: true }, { runChatTurn, runDevPipeline: fakeRun });
    expect(gotSpec).toEqual({
      input: { text: 'hi' },
      executor: { kind: 'self' },
      context: 'interactive',
      chat: { forceNew: true, json: false, enableTools: true, goalLoop: false },
    });
    expect(gotDeps?.runChatTurn).toBe(runChatTurn); // 주입된 chat 엔진 그대로 전달
  });

  it('실 runDevPipeline 경유 e2e — runChatTurn 이 text+매핑된 chat 으로 호출됨', async () => {
    let gotText: string | undefined;
    let gotChat: DevChatOpts | undefined;
    const deps: ChatCliDeps = { runChatTurn: async (text, chat) => { gotText = text; gotChat = chat; } };
    await runChatCliCommand('실제 텍스트', { session: 'sX', goalLoop: true }, deps);
    expect(gotText).toBe('실제 텍스트');
    expect(gotChat).toEqual({ session: 'sX', forceNew: false, json: false, enableTools: false, goalLoop: true });
  });
});
