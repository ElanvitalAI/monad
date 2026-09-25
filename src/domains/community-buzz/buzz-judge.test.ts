// Tier1 판정 파서 + 로컬 LLM 유틸 단위테스트(무네트워크·순수).
import { describe, test, expect } from 'bun:test';
import { buildJudgePrompt, parseJudgeResponse } from './buzz-judge.js';
import { extractJson, makeLocalLlm, pickModel } from './local-llm.js';

describe('extractJson — 응답 정제', () => {
  test('<think> 추론 + 코드펜스 제거 후 배열', () => {
    const raw = '<think>음 이건 배열로...</think>\n```json\n[{"i":0,"importance":8}]\n```';
    expect(extractJson(raw)).toEqual([{ i: 0, importance: 8 }]);
  });
  test('주변 텍스트 속 객체 균형 파싱', () => {
    expect(extractJson('결과: {"a":1,"b":[2,3]} 끝')).toEqual({ a: 1, b: [2, 3] });
  });
  test('JSON 없으면 null', () => {
    expect(extractJson('그냥 텍스트')).toBeNull();
  });
  test('문자열 안 괄호에 안 속음', () => {
    expect(extractJson('[{"reason":"급등 [속보]"}]')).toEqual([{ reason: '급등 [속보]' }]);
  });
});

describe('parseJudgeResponse — 검증/클램프', () => {
  test('정상 배열 파싱·클램프', () => {
    const raw = '[{"i":0,"importance":12,"spam":false,"polarity":1.5,"reason":"실적 서프라이즈"},{"i":1,"importance":3,"spam":true,"polarity":-0.4,"reason":"잡담"}]';
    const v = parseJudgeResponse(raw, 2);
    expect(v.length).toBe(2);
    expect(v[0]!.importance).toBe(10); // 12→클램프 10
    expect(v[0]!.polarity).toBe(1);    // 1.5→클램프 1
    expect(v[1]!.spam).toBe(true);
  });
  test('범위 밖 인덱스·비객체 스킵', () => {
    const v = parseJudgeResponse('[{"i":5,"importance":8},{"i":0,"importance":6},"garbage"]', 2);
    expect(v.length).toBe(1);
    expect(v[0]!.i).toBe(0);
  });
  test('JSON 아니면 빈 배열(fail-soft)', () => {
    expect(parseJudgeResponse('판정 불가', 3)).toEqual([]);
  });
});

describe('judgeBuzz — 청킹·인덱스 재매핑·병렬', () => {
  test('청크 분할 후 전역 i 로 재매핑', async () => {
    // 가짜 llm: 프롬프트의 항목 수만큼 i=0..n-1 반환. 청크마다 로컬 인덱스.
    const fakeLlm = {
      endpoints: ['x'],
      complete: async (msgs: Array<{ role: string; content: string }>) => {
        const n = (msgs[0]!.content.match(/^\d+\. /gm) ?? []).length;
        return JSON.stringify(Array.from({ length: n }, (_, i) => ({ i, importance: 5, spam: false, polarity: 0, reason: 'r' })));
      },
    };
    const items = Array.from({ length: 25 }, (_, i) => ({ title: `t${i}`, tickers: [], category: 'c' }));
    const { judgeBuzz } = await import('./buzz-judge.js');
    const v = await judgeBuzz(items, fakeLlm as never, { chunkSize: 12 });
    expect(v.length).toBe(25);
    expect(v.map(x => x.i).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i)); // 0..24 전역
  });
});

describe('buildJudgePrompt', () => {
  test('티커 힌트·번호 포함', () => {
    const p = buildJudgePrompt([{ title: '하닉 떡상', tickers: ['000660.KO'], category: '국내주식' }]);
    expect(p).toContain('[티커:000660.KO]');
    expect(p).toContain('0. [국내주식]');
    expect(p).toContain('JSON');
  });
});

describe('makeLocalLlm — 라운드로빈·페일오버', () => {
  test('첫 엔드포인트 죽으면 다음으로 페일오버', async () => {
    // 실제 fetch 대신 엔드포인트 URL 로 분기하는 가짜 서버 없이 — 잘못된 포트로 실패 유도.
    const llm = makeLocalLlm({ endpoints: ['http://127.0.0.1:1', 'http://127.0.0.1:2'], timeoutMs: 500 });
    // 둘 다 죽었으니 throw(페일오버 후 최종 실패) — 페일오버 경로 실행 확인.
    await expect(llm.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(/전부 실패/);
  });
  test('endpoints 노출', () => {
    expect(makeLocalLlm({ endpoints: ['http://a', 'http://b'] }).endpoints).toEqual(['http://a', 'http://b']);
  });
});

describe('pickModel — thinking 회피(gemma-it 선호)', () => {
  test('gemma-it 우선(qwen3 thinking 회피)', () => {
    expect(pickModel(['qwen3.5-35b-a3b', 'gemma-4-26b-a4b-it', 'glm-5.1'])).toBe('gemma-4-26b-a4b-it');
  });
  test('gemma 없으면 비-thinking 우선', () => {
    expect(pickModel(['qwen3.5-35b-a3b', 'llama-3-8b', 'glm-5.1'])).toBe('llama-3-8b');
  });
  test('전부 thinking 이면 첫째', () => {
    expect(pickModel(['qwen3.5-35b-a3b', 'glm-5.1'])).toBe('qwen3.5-35b-a3b');
  });
  test('빈 목록 null', () => { expect(pickModel([])).toBeNull(); });
});
