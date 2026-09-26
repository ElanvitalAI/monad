// childProviderKeyEnv — spawn(replace env) 자식 키 릴레이 회귀 가드.
//
// ⭐ 왜 필요한가(리뷰 should-fix #5488 5R): 401 전체 경로는 두 구간이다 —
//   ① 부모 config 가 목표 provider 의 키를 **해석**한다(user-config escalate · provider-credentials)
//   ② spawn 이 그 키를 **자식 env 로 릴레이**한다(여기)
// ②가 끊기면 부모가 아무리 옳게 해석해도 자식은 키 없이 떠서 401 이 난다. spawn env 는 replace 라
// 자동 상속이 없으므로 이 릴레이가 유일한 통로다(`headless-elanous-driver.ts:287` 이 실소비처).

import { test, expect, describe, afterEach } from 'bun:test';
import { childLlmSelectionEnv, childProviderKeyEnv } from './run-context.js';
import { CHILD_LLM_PROVIDER_ALIASES, buildChildLlmSelection, defaultChildLlmModel } from '../self-dev/dev-cli.js';
import { RUNTIME_LLM_PROVIDER_NAMES } from '../user-config.js';

const SAVED = new Map<string, string | undefined>();
function setEnv(k: string, v: string | undefined): void {
  if (!SAVED.has(k)) SAVED.set(k, process.env[k]);
  if (v === undefined) delete process.env[k]; else process.env[k] = v;
}

afterEach(() => {
  for (const [k, v] of SAVED) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  SAVED.clear();
});

describe('childLlmSelectionEnv — 자식 spawn 두뇌 선택 릴레이', () => {
  test('provider와 model이 함께 있으면 두 값을 리터럴로 전달한다', () => {
    setEnv('ELANOUS_LLM_PROVIDER', 'grok');
    setEnv('ELANOUS_LLM_MODEL', 'grok-4.6');
    expect(childLlmSelectionEnv()).toEqual({ ELANOUS_LLM_PROVIDER: 'grok', ELANOUS_LLM_MODEL: 'grok-4.6' });
  });

  test('provider만 있으면 provider만 전달한다', () => {
    setEnv('ELANOUS_LLM_PROVIDER', 'grok');
    setEnv('ELANOUS_LLM_MODEL', undefined);
    expect(childLlmSelectionEnv()).toEqual({ ELANOUS_LLM_PROVIDER: 'grok' });
  });

  test('model만 있으면 model만 전달한다', () => {
    setEnv('ELANOUS_LLM_PROVIDER', undefined);
    setEnv('ELANOUS_LLM_MODEL', 'grok-4.6');
    expect(childLlmSelectionEnv()).toEqual({ ELANOUS_LLM_MODEL: 'grok-4.6' });
  });

  test('둘 다 없으면 빈 객체라 기존 replace env를 바꾸지 않는다', () => {
    setEnv('ELANOUS_LLM_PROVIDER', undefined);
    setEnv('ELANOUS_LLM_MODEL', undefined);
    expect(childLlmSelectionEnv()).toEqual({});
  });

  test('local provider는 실제 자식 모델을 local family로 해석할 접두로 릴레이한다', async () => {
    const relay = childLlmSelectionEnv({ provider: 'local', model: 'lmstudio-community/gemma-4-26b-a4b-it', source: 'flag' });
    const { getModelFamily } = await import('../models/prompts.js');
    expect(relay).toMatchObject({
      ELANOUS_LLM_PROVIDER: 'local',
      ELANOUS_LLM_MODEL: 'local:lmstudio-community/gemma-4-26b-a4b-it',
    });
    expect(getModelFamily(relay.ELANOUS_LLM_MODEL)).toBe('local');
  });

  test('local relay prefixing is idempotent and preserves empty models', () => {
    expect(childLlmSelectionEnv({ provider: 'local', model: 'local:llama-3', source: 'flag' })).toMatchObject({ ELANOUS_LLM_MODEL: 'local:llama-3' });
    expect(childLlmSelectionEnv({ provider: 'local', model: '', source: 'flag' })).toMatchObject({ ELANOUS_LLM_MODEL: '' });
  });

  test('별칭 표에서 얻은 모든 provider는 자식 env에서 runtime provider가 된다', () => {
    const runtimeProviders: readonly string[] = RUNTIME_LLM_PROVIDER_NAMES;
    expect(Object.entries(CHILD_LLM_PROVIDER_ALIASES)).toHaveLength(4);
    for (const [alias, provider] of Object.entries(CHILD_LLM_PROVIDER_ALIASES)) {
      const selection = buildChildLlmSelection({ childLlmProvider: alias, childLlmModel: defaultChildLlmModel(provider) });
      expect(selection).toBeDefined();
      const relay = childLlmSelectionEnv(selection);
      expect(relay.ELANOUS_LLM_PROVIDER).toBe(provider);
      expect(runtimeProviders).toContain(relay.ELANOUS_LLM_PROVIDER);
    }
  });

  test('정식 provider는 child relay에서 변하지 않는다', () => {
    expect(childLlmSelectionEnv({ provider: 'openai-codex', model: 'gpt-5.6-terra', source: 'flag' }).ELANOUS_LLM_PROVIDER)
      .toBe('openai-codex');
  });

  test('명시 선택은 부모 선택을 읽거나 바꾸지 않고 선택 provider 키를 함께 릴레이한다', () => {
    setEnv('ELANOUS_LLM_PROVIDER', 'parent');
    setEnv('ELANOUS_LLM_MODEL', 'parent-model');
    setEnv('ANTHROPIC_API_KEY', 'sk-ant-parent');
    expect(childLlmSelectionEnv({ provider: 'anthropic', model: 'claude-opus-4-8', source: 'flag' })).toEqual({
      ELANOUS_LLM_PROVIDER: 'anthropic', ELANOUS_LLM_MODEL: 'claude-opus-4-8', ANTHROPIC_API_KEY: 'sk-ant-parent',
    });
    expect(process.env.ELANOUS_LLM_PROVIDER).toBe('parent');
    expect(process.env.ELANOUS_LLM_MODEL).toBe('parent-model');
  });

  test('config 출처 선택은 자식 env 릴레이 전에도 source=config 로 남고 flag 와 구별된다', () => {
    const fromConfig = buildChildLlmSelection({}, () => ({ provider: 'grok', model: 'grok-4.6' }));
    const fromFlag = buildChildLlmSelection({ childLlmProvider: 'grok', childLlmModel: 'grok-4.6' }, () => {
      throw new Error('flag path must not read config');
    });
    expect(fromConfig).toEqual({ provider: 'grok', model: 'grok-4.6', source: 'config' });
    expect(fromFlag).toEqual({ provider: 'grok', model: 'grok-4.6', source: 'flag' });
    expect(fromConfig?.source).not.toBe(fromFlag?.source);
    expect(childLlmSelectionEnv(fromConfig)).toEqual(expect.objectContaining({
      ELANOUS_LLM_PROVIDER: 'grok',
      ELANOUS_LLM_MODEL: 'grok-4.6',
    }));
    expect(childLlmSelectionEnv(fromFlag)).toEqual(expect.objectContaining({
      ELANOUS_LLM_PROVIDER: 'grok',
      ELANOUS_LLM_MODEL: 'grok-4.6',
    }));
  });
});

describe('childProviderKeyEnv — 자식 spawn 키 릴레이', () => {
  test('★ escalate 목표 provider 의 키를 자식 env 로 싣는다(401 경로 ②)', () => {
    setEnv('ANTHROPIC_API_KEY', 'sk-ant-parent');
    expect(childProviderKeyEnv('anthropic')).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-parent' });
  });

  test('★ openai-codex — catalog 파생이 null 이라 오버레이 없으면 릴레이가 조용히 끊긴다', () => {
    setEnv('OPENAI_API_KEY', 'sk-openai-parent');
    expect(childProviderKeyEnv('openai-codex')).toEqual({ OPENAI_API_KEY: 'sk-openai-parent' });
  });

  test('★ SSOT 승격으로 살아난 provider — 종전 사설 맵엔 없어 릴레이가 누락됐다', () => {
    setEnv('KIMI_API_KEY', 'kimi-parent');
    expect(childProviderKeyEnv('kimi')).toEqual({ KIMI_API_KEY: 'kimi-parent' });
  });

  test('부모 env 에 키가 없으면 빈 객체(자식은 config auth 로 폴백·무회귀)', () => {
    setEnv('GROK_API_KEY', undefined);
    expect(childProviderKeyEnv('grok')).toEqual({});
  });

  test('키가 필요 없는/미지정 provider 는 빈 객체 — 엉뚱한 키를 싣지 않는다', () => {
    setEnv('ANTHROPIC_API_KEY', 'sk-ant-parent');
    expect(childProviderKeyEnv('local')).toEqual({});
    expect(childProviderKeyEnv('auto')).toEqual({});
    expect(childProviderKeyEnv(undefined)).toEqual({});
    expect(childProviderKeyEnv('nonesuch')).toEqual({});
  });

  test('★ 교차 오염 없음 — anthropic 를 요청했는데 openai 키가 실리지 않는다', () => {
    setEnv('OPENAI_API_KEY', 'sk-openai-parent');
    setEnv('ANTHROPIC_API_KEY', undefined);
    expect(childProviderKeyEnv('anthropic')).toEqual({});   // 401 의 자식-쪽 형태
  });
});

// ── 정적 ratchet (self review #5488 6R) ──────────────────────────────────────
//
// ⚠️ must-fix: 위 단위 테스트들은 헬퍼를 **직접** 부르므로, 실제 spawn env 조립부가 헬퍼 호출을
// 잃어도 전부 통과한다("릴레이가 배선돼 있다"를 증명 못 함). escalate 스폰이 키를 안 실으면
// 자식은 키 없이 떠서 401 이 나는데, 그건 런타임에만 드러난다.
//
// 실 spawn 을 띄우는 건 무겁고 불안정하므로, `identity-env.test.ts` 의 정적 ratchet 선례를 그대로
// 차용한다(재발명 0) — **escalate env 를 심는 자리가 키 릴레이도 함께 심는지**를 소스로 고정한다.
//
// ⚠️ **유지보수 제약(리뷰 should-fix 10R · 정직한 한계)**: 이 가드는 정규식·텍스트 기반이다. 따라서
//   ①계산형 프로퍼티(`[K]: v`) ②env 객체를 여러 단계로 조립해 escalate 키와 릴레이가 **다른 리터럴**에
//   흩어지는 형태 ③`git` 부재 환경 — 셋은 원리적으로 우회/미탐지될 수 있다. 그 형태를 도입한다면
//   이 파일의 앵커·판정식을 함께 갱신하거나 AST 기반으로 승격할 것. 아래 음성 fixture 는 우회 형태가
//   늘어날 때 **값싸게 확장하는 자리**다.
describe('ratchet — escalate 스폰은 provider 키 릴레이를 함께 심는다', () => {
  const SPAWN_SITE = 'src/self-implement/headless-elanous-driver.ts';

  /** 릴레이 배선의 유일한 판정식 — **모든** 탐색 지점이 이걸 쓴다(리뷰 must-fix 8R: `includes` 로
   *  느슨하게 보면 문자열 언급 같은 비-배선으로 우회된다). */
  const RELAY_RE = /\.\.\.\s*childProviderKeyEnv\(\s*target\.provider\s*\)/;
  // 인자 «모양»에 기대지 않는다 — B14(#20479)가 `childLlm ?? implementRole…` 로 바꿨을 때 이 자가 조용히 -1 을 냈다.
  const LLM_SELECTION_RE = /\.\.\.\s*childLlmSelectionEnv\(/;

  /** escalate env 프로퍼티의 표기 변형까지 잡는 앵커 — 따옴표 유무·콜론 앞 공백(9R). */
  const ANCHOR_RE = /(['"])?ELANOUS_ESCALATE_PROVIDER\1?\s*:/;
  /** 위와 같은 뜻의 git grep(POSIX ERE) 패턴 — 탐색과 판정이 **같은 형태 집합**을 봐야 한다. */
  const ANCHOR_GREP = "['\"]?ELANOUS_ESCALATE_PROVIDER['\"]?[[:space:]]*:";

  /** escalate env 를 조립하는 객체 리터럴을 **전부** 잘라낸다 — 파일 전체 `toContain` 은 호출이 주석·
   *  dead code 로 옮겨가도 통과하고(7R), 첫 occurrence 만 보면 같은 파일에 **두 번째 미배선 리터럴**을
   *  추가해도 통과한다(8R). `ELANOUS_ESCALATE_PROVIDER:` 프로퍼티마다 괄호 균형으로 블록을 뜬다. */
  function escalateEnvBlocks(src: string): string[] {
    const blocks: string[] = [];
    for (let from = 0; ;) {
      // ⚠️ 표기 변형 허용(리뷰 must-fix 9R) — `'ELANOUS_ESCALATE_PROVIDER':` · `ELANOUS_ESCALATE_PROVIDER :`
      //    같은 유효 형태를 정확 문자열 검색은 놓치고, 그러면 RELAY_RE 판정 자체가 안 돈다.
      const m = ANCHOR_RE.exec(src.slice(from));
      if (!m) break;
      const anchor = from + m.index;
      const start = src.lastIndexOf('{', anchor);
      if (start < 0) { from = anchor + 1; continue; }
      let depth = 0, end = -1;
      for (let i = start; i < src.length; i++) {
        const c = src[i];
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end < 0) break;
      blocks.push(src.slice(start, end + 1));
      from = end + 1;   // 이 블록을 넘겨 **다음** 리터럴을 계속 찾는다
    }
    return blocks;
  }

  /** 주석(줄·블록)을 걷어낸다 — 주석 안의 호출이 배선으로 오인되지 않게. */
  function stripComments(s: string): string {
    return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  }

  /** 한 파일의 escalate env 리터럴 중 릴레이가 없는 것이 있으면 그 개수. 0 이어야 정상. */
  function unwiredBlocks(src: string): number {
    const blocks = escalateEnvBlocks(src);
    return blocks.filter((b) => !RELAY_RE.test(stripComments(b))).length;
  }

  // ── 판정기 자체의 음성 fixture (must-fix 8R) ────────────────────────────────
  // "주석 이동을 잡는다"를 커밋 메시지가 아니라 **테스트로** 증명한다. 아래 fixture 들은 실제 소스가
  // 아니라 판정 로직에 먹이는 합성 입력이라, 회피 형태가 늘어나도 값싸게 고정할 수 있다.
  describe('판정기 음성 fixture — 이런 회피는 반드시 미배선으로 잡힌다', () => {
    const wired = `{ ELANOUS_ESCALATE_MODEL: m, ELANOUS_ESCALATE_PROVIDER: p, ...childProviderKeyEnv(target.provider) }`;

    test('정상 배선은 통과', () => { expect(unwiredBlocks(wired)).toBe(0); });

    test('★ 줄 주석으로 옮긴 호출 — 미배선', () => {
      expect(unwiredBlocks(`{ ELANOUS_ESCALATE_PROVIDER: p, // ...childProviderKeyEnv(target.provider)\n }`)).toBe(1);
    });

    test('★ 블록 주석 안의 호출 — 미배선', () => {
      expect(unwiredBlocks(`{ ELANOUS_ESCALATE_PROVIDER: p, /* ...childProviderKeyEnv(target.provider) */ }`)).toBe(1);
    });

    test('★ 문자열로만 언급 — 미배선(includes 였다면 통과했다)', () => {
      expect(unwiredBlocks(`{ ELANOUS_ESCALATE_PROVIDER: p, note: 'childProviderKeyEnv' }`)).toBe(1);
    });

    test('★ spread 없이 호출만 — 미배선', () => {
      expect(unwiredBlocks(`{ ELANOUS_ESCALATE_PROVIDER: p, k: childProviderKeyEnv(target.provider) }`)).toBe(1);
    });

    test('★ 같은 파일의 **두 번째** 리터럴이 미배선 — 잡힌다(첫 occurrence 만 보면 통과했다)', () => {
      expect(unwiredBlocks(`${wired}\nconst other = { ELANOUS_ESCALATE_PROVIDER: p2 };`)).toBe(1);
    });

    test('배선된 리터럴이 둘이면 둘 다 통과', () => {
      expect(unwiredBlocks(`${wired}\nconst other = ${wired};`)).toBe(0);
    });

    // ★ must-fix(9R) — 표기 변형을 놓치면 판정 자체가 안 돌아 **미배선이 통과**한다.
    test.each([
      ["따옴표", `{ 'ELANOUS_ESCALATE_PROVIDER': p }`],
      ["쌍따옴표", `{ "ELANOUS_ESCALATE_PROVIDER": p }`],
      ["콜론 앞 공백", `{ ELANOUS_ESCALATE_PROVIDER : p }`],
    ])('★ 표기 변형(%s)도 리터럴로 잡아 미배선을 검출', (_label, snippet) => {
      expect(escalateEnvBlocks(snippet).length).toBe(1);
      expect(unwiredBlocks(snippet)).toBe(1);
    });
  });

  test('★ 실 spawn 지점 — 부모 LLM 선택 relay가 escalation보다 앞에서 spread 된다', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(SPAWN_SITE, 'utf-8');
    const selection = src.search(LLM_SELECTION_RE);
    const escalation = src.indexOf('ELANOUS_ESCALATE_PROVIDER');
    expect(selection).toBeGreaterThanOrEqual(0);
    expect(escalation).toBeGreaterThan(selection);
  });

  test('★ 실 spawn 지점 — escalate env 리터럴 전부가 릴레이를 spread 한다', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(SPAWN_SITE, 'utf-8');
    // 이 파일이 escalate 스폰의 env 를 조립한다는 전제 자체를 먼저 고정(파일이 옮겨가면 여기서 실패).
    expect(src).toContain('ELANOUS_ESCALATE_PROVIDER');
    expect(escalateEnvBlocks(src).length).toBeGreaterThan(0);   // 추출이 죽으면 가드가 무력해진다
    expect(unwiredBlocks(src)).toBe(0);
  });

  test('escalate env 를 심는 다른 spawn 지점이 새로 생기면 릴레이도 있어야 한다', async () => {
    const { execFileSync } = await import('node:child_process');
    let out = '';
    let failed: string | null = null;
    try {
      out = execFileSync('git', ['grep', '-lE', ANCHOR_GREP, '--', 'src/'], { encoding: 'utf8' });
    } catch (e) {
      // ⚠️ must-fix(7R): 모든 실패를 "매치 0"으로 삼으면 git 부재·레포 밖 실행 등에서 **조용히 통과**한다.
      //    무매치(exit 1)만 정상으로 받고 나머지는 테스트를 깬다.
      const status = (e as { status?: number }).status;
      if (status !== 1) failed = `git grep 실패(status=${String(status)})`;
    }
    expect(failed).toBeNull();
    // ⚠️ 테스트 파일 제외 — 이 파일 자신이 그 문자열을 담고 있어 탐색이 **자기를 잡는다**(실측).
    const sites = out.split('\n').map((s) => s.trim()).filter(Boolean).filter((f) => !f.endsWith('.test.ts'));
    expect(sites).toContain(SPAWN_SITE);   // 최소 1곳(알려진 지점)은 잡혀야 탐색이 살아있는 것

    const { readFileSync } = await import('node:fs');
    // 같은 판정식(RELAY_RE·블록 전수)을 **모든** 지점에 적용한다(8R: includes 우회 차단).
    const missing = sites.filter((f) => unwiredBlocks(readFileSync(f, 'utf-8')) > 0);
    expect(missing).toEqual([]);
  });
});

// BACKLOG B12 — 상속 갈래도 local 이면 엔드포인트를 넘긴다.
import { childLlmSelectionEnv as relayForB12 } from './run-context.js';
describe('childLlmSelectionEnv inherit branch relays the local endpoint (BACKLOG B12)', () => {
  const keep = { p: process.env.ELANOUS_LLM_PROVIDER, m: process.env.ELANOUS_LLM_MODEL, u: process.env.LOCAL_LLM_URL };
  afterEach(() => {
    for (const [k, v] of [['ELANOUS_LLM_PROVIDER', keep.p], ['ELANOUS_LLM_MODEL', keep.m], ['LOCAL_LLM_URL', keep.u]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  test('inherited local provider carries LOCAL_LLM_URL; other providers do not', () => {
    process.env.ELANOUS_LLM_PROVIDER = 'local'; process.env.ELANOUS_LLM_MODEL = 'local:x'; process.env.LOCAL_LLM_URL = 'http://node-b:1234/v1';
    expect(relayForB12()).toEqual({ ELANOUS_LLM_PROVIDER: 'local', ELANOUS_LLM_MODEL: 'local:x', LOCAL_LLM_URL: 'http://node-b:1234/v1' });
    process.env.ELANOUS_LLM_PROVIDER = 'grok';
    expect(relayForB12().LOCAL_LLM_URL).toBeUndefined();
  });
});
