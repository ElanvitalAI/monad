import { describe, expect, test } from 'bun:test';
import {
  mcpAppResourceUriOf,
  mcpMediaJobs,
  mcpResultImages,
  type MediaWidget,
} from './media';

/** 실물 Higgsfield `jobs_wait` 성공 job (2026-09-10 실측). */
const LIVE_JOB = {
  index: 0,
  job_id: '3d560035-a389-4307-9fae-e8241bc37dae',
  status: 'completed',
  type: 'image',
  model: 'gpt_image_2',
  result_url: 'https://d8j0ntlcm91z4.cloudfront.net/user_3GT3P7lkJkopWw516o4fLOqn8qO/hf_20260910_070744_3d560035-a389-4307-9fae-e8241bc37dae.png',
};

const WIDGET_URI = 'ui://higgsfield/generation-v2.html';

const SUCCESS_STRUCTURED_CONTENT = {
  structuredContent: { structured: { jobs: [LIVE_JOB] } },
  _meta: { ui: { resourceUri: WIDGET_URI } },
};

const SUCCESS_STRUCTURED = {
  structured: { jobs: [LIVE_JOB] },
  _meta: { ui: { resourceUri: WIDGET_URI } },
};

/** 실물 오류 응답 꼴 — `_meta.ui.resourceUri` 는 성공·실패 양쪽에 실린다. */
const ERROR_RESPONSE = {
  output: '',
  structured: {},
  ok: false,
  _meta: { ui: { resourceUri: WIDGET_URI } },
  classification: 'mcp-server-error',
};

describe('mcpMediaJobs', () => {
  test('structuredContent.structured.jobs 를 읽는다', () => {
    const jobs = mcpMediaJobs(SUCCESS_STRUCTURED_CONTENT);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.jobId).toBe('3d560035-a389-4307-9fae-e8241bc37dae');
    expect(jobs[0]?.kind).toBe('image');
    expect(jobs[0]?.status).toBe('completed');
    expect(jobs[0]?.resultUrl?.startsWith('https://d8j0ntlcm91z4.cloudfront.net/')).toBe(true);
  });

  test('structured.jobs 자리도 읽는다', () => {
    const jobs = mcpMediaJobs(SUCCESS_STRUCTURED);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.jobId).toBe('3d560035-a389-4307-9fae-e8241bc37dae');
  });

  test('벤더 nsfw status 를 원문 그대로 보존한다', () => {
    const jobs = mcpMediaJobs({
      structured: {
        jobs: [{ ...LIVE_JOB, status: 'nsfw' }],
      },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe('nsfw');
    expect(jobs[0]?.jobId).toBe(LIVE_JOB.job_id);
  });

  test('기존 completed, pending, failed 상태와 비문자 fallback 을 보존한다', () => {
    const cases: Array<[unknown, string]> = [
      ['completed', 'completed'],
      ['pending', 'pending'],
      ['failed', 'failed'],
      [undefined, 'pending'],
    ];
    for (const [input, expected] of cases) {
      expect(mcpMediaJobs({ structured: { jobs: [{ ...LIVE_JOB, status: input }] } })[0]?.status).toBe(expected);
    }
  });

  test('jobs 배열이 없으면 빈 배열', () => {
    expect(mcpMediaJobs({ output: 'ok', structured: { status: 'completed' } })).toEqual([]);
    expect(mcpMediaJobs(undefined)).toEqual([]);
    expect(mcpMediaJobs(ERROR_RESPONSE)).toEqual([]);
  });

  test('제출 응답 structured.results[] 를 job 으로 읽는다', () => {
    const jobs = mcpMediaJobs({
      structured: {
        results: [{
          id: '99cedd09-57f3-49da-bd2a-6ef3b88c06be',
          type: 'video',
          status: 'pending',
          model: 'minimax_hailuo',
        }],
      },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.jobId).toBe('99cedd09-57f3-49da-bd2a-6ef3b88c06be');
    expect(jobs[0]?.kind).toBe('video');
    expect(jobs[0]?.status).toBe('pending');
    expect(jobs[0]?.model).toBe('minimax_hailuo');
  });

  test('폴링 응답 structured.generation 객체를 한 원소 배열로 읽는다', () => {
    const jobs = mcpMediaJobs({
      structured: {
        generation: {
          id: '99cedd09-57f3-49da-bd2a-6ef3b88c06be',
          type: 'video',
          status: 'completed',
          model: 'minimax_hailuo',
          params: { prompt: 'a leaf in wind' },
        },
      },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.jobId).toBe('99cedd09-57f3-49da-bd2a-6ef3b88c06be');
    expect(jobs[0]?.status).toBe('completed');
    expect(jobs[0]?.kind).toBe('video');
    expect(jobs[0]?.prompt).toBe('a leaf in wind');
  });
});

describe('mcpAppResourceUriOf', () => {
  test('성공 응답의 위젯 URI 를 캐낸다', () => {
    const widget: MediaWidget = { resourceUri: mcpAppResourceUriOf(SUCCESS_STRUCTURED_CONTENT)! };
    expect(widget.resourceUri).toBe(WIDGET_URI);
  });

  test('오류 응답에서도 위젯 URI 를 캐낸다', () => {
    const widget: MediaWidget = { resourceUri: mcpAppResourceUriOf(ERROR_RESPONSE)! };
    expect(widget.resourceUri).toBe(WIDGET_URI);
  });
});

describe('mcpResultImages', () => {
  test('옮겨진 추출기는 구조 uri 를 그대로 그린다', () => {
    expect(mcpResultImages({
      content: [{ name: 'hf_1.png', uri: 'https://cdn.example/hf_1.png', description: 'leaf' }],
    })).toEqual([
      { src: 'https://cdn.example/hf_1.png', mediaType: 'image/png', alt: 'leaf' },
    ]);
  });
});
