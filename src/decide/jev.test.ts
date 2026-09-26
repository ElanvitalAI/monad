import { describe, expect, test } from 'bun:test';
import { buildQuestion, callJev, describeScore, gateAnswer, JEV_ENDPOINT, parseFanOutFile, probeKey, resolveJevAccess, type JevAnswer } from './jev.js';

describe('jev — ⛔ 실측으로 데인 함정을 문다', () => {
  test('score 를 «분모와 함께» 읽는다 — 0.85 를 「85%」로 읽으면 뜻이 뒤집힌다', () => {
    const a: JevAnswer = {
      type: 'score', score: 0.85, confidence: 0.79,
      legend: { '0': 'Severe', '1': 'High', '2': 'Moderate', '3': 'Low', '4': 'Negligible' },
    };
    const out = describeScore(a);
    expect(out).toContain('0.85 / 4');        // ⛔ 분모가 «반드시» 붙는다
    expect(out).toContain('레벨 1');           // 0.85 는 레벨 1 에 가장 가깝다
    expect(out).toContain('High');
    expect(out).not.toContain('%');           // ⛔ 백분율로 읽히는 문면을 만들지 않는다
  });

  test('choice 는 criteria 로 만든다 — options 라는 칸은 «없다»', () => {
    const q = buildQuestion('choice', '누가 맡나', ['a', 'b']);
    expect(q.type).toBe('choice');
    expect(Object.keys((q as { criteria: Record<string, unknown> }).criteria)).toEqual(['a', 'b']);
    expect(q).not.toHaveProperty('options');
  });

  test('criteria 가 하나면 거부한다 — 갈릴 수 없는 물음이다', () => {
    expect(() => buildQuestion('choice', 'x', ['only'])).toThrow(/criteria/);
  });

  test('score 레벨 상한 10 을 넘으면 거부한다', () => {
    expect(() => buildQuestion('score', 'x', Array.from({ length: 11 }, (_, i) => `L${i}`))).toThrow(/2~10/);
  });

  test('임계 관문 — 최상위 확률과 신뢰도를 «둘 다» 본다', () => {
    const strong: JevAnswer = { type: 'choice', confidence: 0.86, probabilities: { a: 0.92, b: 0.08 } };
    const weakConf: JevAnswer = { type: 'choice', confidence: 0.23, probabilities: { a: 0.95, b: 0.05 } };
    const spread: JevAnswer = { type: 'choice', confidence: 0.8, probabilities: { a: 0.45, b: 0.4 } };
    expect(gateAnswer(strong).verdict).toBe('act');
    expect(gateAnswer(weakConf).verdict).toBe('escalate');   // 확률은 높은데 신뢰도가 낮다
    expect(gateAnswer(spread).verdict).toBe('escalate');     // 신뢰도는 높은데 갈렸다
  });

  test('noul 은 «양 끝»에서 잰다 — 0.09 도 0.91 만큼 확정이다', () => {
    expect(gateAnswer({ type: 'noul', noul: 0.09 }).verdict).toBe('act');
    expect(gateAnswer({ type: 'noul', noul: 0.91 }).verdict).toBe('act');
    expect(gateAnswer({ type: 'noul', noul: 0.71 }).verdict).toBe('escalate');
  });

  test('키 탐침은 값을 «안 돌려준다» — 존재·길이·출처만', () => {
    const p = probeKey({ TYPESAFE_API_KEY: 'sk-secret-value' } as NodeJS.ProcessEnv, () => undefined);
    expect(p).toEqual({ present: true, length: 15, source: 'env' });
    expect(JSON.stringify(p)).not.toContain('secret');
  });

  test('키가 env 에 없으면 캐시를 본다', () => {
    expect(probeKey({} as NodeJS.ProcessEnv, () => 'abc').source).toBe('cache');
    expect(probeKey({} as NodeJS.ProcessEnv, () => undefined).present).toBe(false);
  });

  test('400 은 «어느 칸이 틀렸는지 말해 주지 않는다» — 그래서 우리가 후보를 댄다', async () => {
    const fake = (async () => new Response('{"detail":{"message":"Invalid request."}}', { status: 400 })) as unknown as typeof fetch;
    await expect(callJev({ state: 's', questions: {} }, 'k', fake)).rejects.toThrow(/criteria/);
  });

  test('성공하면 봉투를 그대로 돌려준다 ⊕ 기본 모델은 jev-latest', async () => {
    let sentBody = '';
    const fake = (async (_u: string, init: RequestInit) => {
      sentBody = String(init.body);
      return new Response(JSON.stringify({ model: 'jev-1.13.0', answers: { q: { type: 'noul', noul: 0.65 } } }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await callJev({ state: 's', questions: { q: { type: 'noul', instructions: 'i' } } }, 'k', fake);
    expect(r.answers.q?.noul).toBe(0.65);
    expect(JSON.parse(sentBody).model).toBe('jev-latest');
  });
});

describe('fan-out — ⛔ 보내기 «전»에 400 을 잡는다', () => {
  test('state·questions 가 없으면 «어느 칸»인지 말해 준다', () => {
    expect(() => parseFanOutFile('{"questions":{}}')).toThrow(/state 칸이 없다/);
    expect(() => parseFanOutFile('{"state":"s"}')).toThrow(/questions 칸이 없다/);
    expect(() => parseFanOutFile('{"state":"s","questions":{}}')).toThrow(/비었다/);
  });

  test('type 이 틀리면 «질문 이름»을 대고 후보를 준다 — API 는 안 알려 준다', () => {
    expect(() => parseFanOutFile('{"state":"s","questions":{"q1":{"type":"boolean","instructions":"i"}}}'))
      .toThrow(/questions\.q1\.type 이 'boolean'.*noul·choice·score/);
  });

  test('⛔ options·levels 를 «보내기 전에» 막는다', () => {
    expect(() => parseFanOutFile('{"state":"s","questions":{"q2":{"type":"choice","instructions":"i","options":["a"]}}}'))
      .toThrow(/options\/levels 가 있다/);
  });

  test('choice·score 에 criteria 가 없으면 막는다', () => {
    expect(() => parseFanOutFile('{"state":"s","questions":{"q3":{"type":"score","instructions":"i"}}}'))
      .toThrow(/criteria 가 필요하다/);
  });

  test('올바른 파일은 그대로 통과한다', () => {
    const f = parseFanOutFile('{"state":{"a":1},"questions":{"q":{"type":"noul","instructions":"i"}}}');
    expect(Object.keys(f.questions)).toEqual(['q']);
    expect(f.state).toEqual({ a: 1 });
  });
});

describe('HTTP 코드를 «갈라» 말한다 — ⛔ 접으면 엉뚱한 곳을 고치러 간다', () => {
  const fake = (status: number, body = '{}') => (async () => new Response(body, { status })) as unknown as typeof fetch;
  const q = { state: 's', questions: { q: { type: 'noul' as const, instructions: 'i' } } };

  test('402 는 «크레딧»이라 말한다 — 키 문제가 아니다', async () => {
    await expect(callJev(q, 'k', fake(402))).rejects.toThrow(/크레딧이 없다.*키 문제가 «아니다»/);
  });
  test('401 은 «키»라 말한다 — 크레딧 문제가 아니다', async () => {
    await expect(callJev(q, 'k', fake(401))).rejects.toThrow(/키가 틀렸거나 없다/);
  });
  test('429 는 «레이트리밋»이라 말한다', async () => {
    await expect(callJev(q, 'k', fake(429))).rejects.toThrow(/레이트리밋/);
  });
  test('⛔ 셋이 서로 «다른» 문면이다 — 접히지 않았다', async () => {
    const msgs = await Promise.all([402, 401, 429].map(async (c) => {
      try { await callJev(q, 'k', fake(c)); return ''; } catch (e) { return (e as Error).message; }
    }));
    expect(new Set(msgs).size).toBe(3);
  });
});

describe('보내는 곳 — 로컬 Jev 호환 서버로 바꿀 수 있다', () => {
  const cache = 'cache/typesafe_api_key';
  const files = (map: Record<string, string>) => (path: string) => map[path];

  test('기본은 Typesafe 이고 키가 없으면 거부한다', () => {
    const r = resolveJevAccess({ env: {}, readFile: files({}), typesafeCachePath: cache });
    expect(r.ok).toBe(false);
    const withCache = resolveJevAccess({ env: {}, readFile: files({ [cache]: 'k1\n' }), typesafeCachePath: cache });
    expect(withCache).toEqual({ ok: true, access: { endpoint: JEV_ENDPOINT, endpointSource: 'default', key: 'k1' } });
  });

  test('설정이 환경보다 앞서고, 다른 서버는 키 없이도 된다', () => {
    const env = { ELANOUS_JEV_ENDPOINT: 'http://env/v1/systemone', TYPESAFE_API_KEY: 'typesafe' };
    const r = resolveJevAccess({ config: { endpoint: 'http://cfg/v1/systemone', model: 'multilingual' }, env, readFile: files({}), typesafeCachePath: cache });
    // Typesafe 키를 남의 서버로 보내지 않는다.
    expect(r).toEqual({ ok: true, access: { endpoint: 'http://cfg/v1/systemone', endpointSource: 'config', model: 'multilingual' } });
    const e = resolveJevAccess({ env, readFile: files({}), typesafeCachePath: cache });
    expect(e.ok && e.access.endpointSource).toBe('env');
  });

  test('다른 서버의 키는 설정 keyFile > 환경 ELANOUS_JEV_KEY', () => {
    const env = { ELANOUS_JEV_ENDPOINT: 'http://env/v1/systemone', ELANOUS_JEV_KEY: 'from-env' };
    const fromFile = resolveJevAccess({ config: { keyFile: 'kf' }, env, readFile: files({ kf: 'from-file\n' }), typesafeCachePath: cache });
    expect(fromFile.ok && fromFile.access.key).toBe('from-file');
    const fromEnv = resolveJevAccess({ env, readFile: files({}), typesafeCachePath: cache });
    expect(fromEnv.ok && fromEnv.access.key).toBe('from-env');
  });

  test('callJev 는 받은 곳으로 보내고, 키가 없으면 Authorization 을 싣지 않는다', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify({ model: 'm', answers: {} }), { status: 200 });
    }) as unknown as typeof fetch;
    await callJev({ state: {}, questions: {} }, undefined, fake, 'http://local/v1/systemone');
    expect(seen[0]?.url).toBe('http://local/v1/systemone');
    expect(seen[0]?.headers.Authorization).toBeUndefined();
    await callJev({ state: {}, questions: {} }, 'k', fake);
    expect(seen[1]?.url).toBe(JEV_ENDPOINT);
    expect(seen[1]?.headers.Authorization).toBe('Bearer k');
  });
});
