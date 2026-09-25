import { describe, expect, test } from 'bun:test';
import { createMcpProxyRuntime, _resetMcpMediaSeqStateForTest } from './proxy-runtime.js';
import type { FeedbackEnvelope } from '../feedback/envelope.js';
import type { McpToolCallResult } from './client.js';

const alwaysAuthorized = { isGranted: () => true };

/** 실물 Higgsfield `jobs_wait` 성공 응답 (2026-09-10 실측). */
const JOBS_WAIT_RESULT: McpToolCallResult = {
  content: [{ type: 'text', text: 'completed' }],
  structuredContent: {
    output: 'https://d8j0ntlcm91z4.cloudfront.net/user_3GT3P7lkJkopWw516o4fLOqn8qO/hf_20260910_070744_3d560035-a389-4307-9fae-e8241bc37dae.png',
    structured: {
      jobs: [{
        index: 0,
        job_id: '3d560035-a389-4307-9fae-e8241bc37dae',
        status: 'completed',
        type: 'image',
        model: 'gpt_image_2',
        params: { prompt: 'a moonlit mountain lake' },
        result_url: 'https://d8j0ntlcm91z4.cloudfront.net/user_3GT3P7lkJkopWw516o4fLOqn8qO/hf_20260910_070744_3d560035-a389-4307-9fae-e8241bc37dae.png',
      }],
      summary: { total: 1, completed: 1, failed: 0, active: 0, errors: 0 },
      all_terminal: true,
    },
  },
};


/** 같은 job 의 «제출 직후» 응답 — 아직 pending 이고 result_url 이 없다. */
const JOBS_WAIT_PENDING: McpToolCallResult = {
  content: [{ type: 'text', text: 'pending' }],
  structuredContent: {
    output: 'pending',
    structured: {
      jobs: [{
        index: 0,
        job_id: '3d560035-a389-4307-9fae-e8241bc37dae',
        status: 'pending',
        type: 'image',
        model: 'gpt_image_2',
      }],
      summary: { total: 1, completed: 0, failed: 0, active: 1, errors: 0 },
      all_terminal: false,
    },
  },
};

const IMAGE_RESULT: McpToolCallResult = {
  content: [{ type: 'text', text: 'https://cdn.example/hf_1.png' }],
  structuredContent: {
    content: [{ name: 'hf_1.png', uri: 'https://cdn.example/hf_1.png', description: 'leaf' }],
  },
};

function runtimeFor(result: McpToolCallResult, extra?: { outputLimit?: { maxTokens: number; warnTokens: number } }) {
  return createMcpProxyRuntime({
    serverId: 'higgsfield',
    mcpTool: { name: 'jobs_wait' },
    client: { callTool: async () => result },
    authorizer: alwaysAuthorized,
    ...(extra?.outputLimit ? { _outputLimitForTest: extra.outputLimit } : {}),
  });
}

describe('createMcpProxyRuntime media envelopes', () => {
  test('jobs_wait 실물 픽스처에서 media.job 을 낸다', async () => {
    const emitted: FeedbackEnvelope[] = [];
    await runtimeFor(JOBS_WAIT_RESULT).run({}, {
      surface: 'tui',
      sessionId: 'sess-1',
      emitFeedback: (env) => { emitted.push(env); },
    });
    const jobs = emitted.filter((env): env is FeedbackEnvelope & { kind: 'media.job' } => env.kind === 'media.job');
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    expect(jobs[0]?.payload).toMatchObject({
      jobId: '3d560035-a389-4307-9fae-e8241bc37dae',
      mediaKind: 'image',
      status: 'completed',
      resultUrl: 'https://d8j0ntlcm91z4.cloudfront.net/user_3GT3P7lkJkopWw516o4fLOqn8qO/hf_20260910_070744_3d560035-a389-4307-9fae-e8241bc37dae.png',
      model: 'gpt_image_2',
      prompt: 'a moonlit mountain lake',
    });
  });

  test('prompt 가 없는 jobs_wait 봉투에는 prompt 키를 만들지 않는다', async () => {
    const emitted: FeedbackEnvelope[] = [];
    await runtimeFor(JOBS_WAIT_PENDING).run({}, {
      surface: 'tui',
      sessionId: 'sess-1',
      emitFeedback: (env) => { emitted.push(env); },
    });
    const job = emitted.find((env): env is FeedbackEnvelope & { kind: 'media.job' } => env.kind === 'media.job');
    expect(job?.payload).toMatchObject({
      jobId: '3d560035-a389-4307-9fae-e8241bc37dae',
      mediaKind: 'image',
      status: 'pending',
      model: 'gpt_image_2',
    });
    expect(job?.payload).not.toHaveProperty('prompt');
  });

  test('그림 주소가 실린 응답에서 media.image 를 낸다', async () => {
    const emitted: FeedbackEnvelope[] = [];
    await runtimeFor(IMAGE_RESULT).run({}, {
      surface: 'tui',
      sessionId: 'sess-1',
      emitFeedback: (env) => { emitted.push(env); },
    });
    const images = emitted.filter((env): env is FeedbackEnvelope & { kind: 'media.image' } => env.kind === 'media.image');
    expect(images.length).toBeGreaterThanOrEqual(1);
    expect(images[0]?.payload.src.startsWith('https')).toBe(true);
  });

  test('새로 난 봉투 전부의 asciiFallback 이 비지 않는다', async () => {
    const emitted: FeedbackEnvelope[] = [];
    await runtimeFor(JOBS_WAIT_RESULT).run({}, {
      surface: 'tui',
      sessionId: 'sess-1',
      emitFeedback: (env) => { emitted.push(env); },
    });
    await runtimeFor(IMAGE_RESULT).run({}, {
      surface: 'tui',
      sessionId: 'sess-1',
      emitFeedback: (env) => { emitted.push(env); },
    });
    expect(emitted.length).toBeGreaterThan(0);
    for (const env of emitted) {
      expect(env.asciiFallback.length).toBeGreaterThanOrEqual(1);
      expect(env.asciiFallback[0]).not.toBe('');
    }
  });

  test('structured 가 상한으로 빠져도 media.job 은 난다', async () => {
    const emitted: FeedbackEnvelope[] = [];
    const oversized: McpToolCallResult = {
      content: [{ type: 'text', text: 'x'.repeat(400) }],
      structuredContent: {
        output: 'x'.repeat(400),
        structured: {
          jobs: [{
            index: 0,
            job_id: '3d560035-a389-4307-9fae-e8241bc37dae',
            status: 'completed',
            type: 'image',
            model: 'gpt_image_2',
            result_url: 'https://d8j0ntlcm91z4.cloudfront.net/user_3GT3P7lkJkopWw516o4fLOqn8qO/hf_20260910_070744_3d560035-a389-4307-9fae-e8241bc37dae.png',
            padding: 'y'.repeat(800),
          }],
        },
      },
    };
    const result = await runtimeFor(oversized, {
      outputLimit: { maxTokens: 20, warnTokens: 10 },
    }).run({}, {
      surface: 'tui',
      sessionId: 'sess-1',
      emitFeedback: (env) => { emitted.push(env); },
    });
    expect((result as { structuredDropped?: boolean }).structuredDropped).toBe(true);
    expect(emitted.filter((env) => env.kind === 'media.job').length).toBeGreaterThanOrEqual(1);
  });

  test('ctx 가 없는 경로는 조용하다', async () => {
    await expect(runtimeFor(JOBS_WAIT_RESULT).run({}, { surface: 'mcp' })).resolves.toMatchObject({
      output: 'completed',
    });
  });

  test('같은 세션·jobId pending→completed 는 같은 blockId 에서 seq 가 증가한다', async () => {
    const jobId = '3d560035-a389-4307-9fae-e8241bc37dae';
    const pending: McpToolCallResult = {
      content: [{ type: 'text', text: 'pending' }],
      structuredContent: {
        structured: {
          results: [{
            id: jobId,
            type: 'image',
            status: 'pending',
            model: 'gpt_image_2',
          }],
        },
      },
    };
    const emitted: FeedbackEnvelope[] = [];
    const ctx = {
      surface: 'tui' as const,
      sessionId: 'sess-seq-lifetime',
      emitFeedback: (env: FeedbackEnvelope) => { emitted.push(env); },
    };
    await createMcpProxyRuntime({
      serverId: 'higgsfield',
      mcpTool: { name: 'generate_image' },
      client: { callTool: async () => pending },
      authorizer: alwaysAuthorized,
    }).run({}, ctx);
    await createMcpProxyRuntime({
      serverId: 'higgsfield',
      mcpTool: { name: 'jobs_wait' },
      client: { callTool: async () => JOBS_WAIT_RESULT },
      authorizer: alwaysAuthorized,
    }).run({}, ctx);
    const jobs = emitted.filter((env): env is FeedbackEnvelope & { kind: 'media.job' } => env.kind === 'media.job');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]?.blockId).toBe(jobs[1]?.blockId);
    expect(jobs[0]?.blockId).toBe(`sess-seq-lifetime:media.job:${jobId}`);
    expect(jobs[0]?.payload.status).toBe('pending');
    expect(jobs[1]?.payload.status).toBe('completed');
    expect(jobs[1]!.seq).toBeGreaterThan(jobs[0]!.seq);
  });

  // ⛔⭐ 무인 리뷰가 «두 라운드에 걸쳐» 잡은 결함의 회귀 가드.
  //   초판은 `phase === 'end'` 에 seq 트래커를 지웠다. 그런데 같은 job 의 후속
  //   `jobs_wait`·`job_status` 가 ***같은 blockId 를 다시 쓰므로*** seq 가 1 로 되돌아갔다.
  //   ⇒ seq 로 순서를 정하는 소비자에게 시간이 «거꾸로» 간다.
  test('같은 job 의 pending → completed → completed 에서 seq 가 단조 증가한다', async () => {
    _resetMcpMediaSeqStateForTest();
    const emitted: FeedbackEnvelope[] = [];
    const ctx = {
      surface: 'tui' as const,
      sessionId: 'sess-seq',
      emitFeedback: (env: FeedbackEnvelope) => { emitted.push(env); },
    };
    await runtimeFor(JOBS_WAIT_PENDING).run({}, ctx);
    await runtimeFor(JOBS_WAIT_RESULT).run({}, ctx);
    await runtimeFor(JOBS_WAIT_RESULT).run({}, ctx);

    const jobs = emitted.filter((env) => env.kind === 'media.job');
    expect(jobs.length).toBe(3);
    // ⭐ 셋이 «같은 블록»이어야 이 시험이 뜻을 갖는다 — 아니면 seq 비교가 무의미하다.
    expect(new Set(jobs.map((env) => env.blockId)).size).toBe(1);
    const seqs = jobs.map((env) => env.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(3);
    expect(seqs[0]).toBeLessThan(seqs[1]!);
    expect(seqs[1]).toBeLessThan(seqs[2]!);
  });
});
