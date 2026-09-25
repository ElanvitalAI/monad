// ── ToolSearch runtime · Coding Pipeline P1 tests ──
//
// Exercises the parser, keyword ranker, select: path, and runtime
// wrapper shape. Registers a small fake-tool set so ranking is
// deterministic and independent of the real catalog.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  _resetToolRuntimeRegistryForTest,
  registerToolRuntime,
} from '../src/tool-runtime/registry.js';
import { toolSearchRuntime } from '../src/tool-runtime/tool-search-runtime.js';
import { HYDRATED_TOOLS_KEY } from '../src/skills/tools/tool-search-spec.js';
import {
  parseToolSearchQuery,
  dispatchToolSearch,
} from '../src/skills/tools/tool-search.js';
import { nativeToolCatalog, type NativeToolCatalogEntry } from '../src/native-tool-catalog.js';
import type { ToolRuntime } from '../src/tool-runtime/types.js';

// Temporarily push fake catalog entries so the searchable set is
// predictable. We mutate the exported array in-place and restore
// after each test.
let savedCatalogLength = 0;

function pushFakeCatalog(entries: NativeToolCatalogEntry[]): void {
  for (const e of entries) nativeToolCatalog.push(e);
}

function fakeRuntime(id: string, name: string, description: string): ToolRuntime {
  return {
    id,
    spec: {
      name,
      description,
      parameters: {
        type: 'object',
        properties: { q: { type: 'string', description: 'fake param' } },
        required: ['q'],
      },
    },
    async run() {
      return { output: 'fake' };
    },
  };
}

beforeEach(() => {
  _resetToolRuntimeRegistryForTest();
  savedCatalogLength = nativeToolCatalog.length;
});

afterEach(() => {
  // Trim any fake entries pushed during the test.
  nativeToolCatalog.length = savedCatalogLength;
  _resetToolRuntimeRegistryForTest();
});

describe('parseToolSearchQuery', () => {
  test('select: parses comma-separated list, trims whitespace', () => {
    const r = parseToolSearchQuery('select:Foo, Bar ,Baz');
    expect(r.kind).toBe('select');
    expect(r.selectNames).toEqual(['Foo', 'Bar', 'Baz']);
    expect(r.terms).toEqual([]);
    expect(r.required).toEqual([]);
  });

  test('select: is case-insensitive on the keyword prefix', () => {
    const r = parseToolSearchQuery('Select:A,B');
    expect(r.kind).toBe('select');
    expect(r.selectNames).toEqual(['A', 'B']);
  });

  test('keyword path lowercases terms', () => {
    const r = parseToolSearchQuery('Slack Send Message');
    expect(r.kind).toBe('keyword');
    expect(r.terms).toEqual(['slack', 'send', 'message']);
    expect(r.required).toEqual([]);
  });

  test('+term marks a term as required', () => {
    const r = parseToolSearchQuery('+slack send');
    expect(r.kind).toBe('keyword');
    expect(r.required).toEqual(['slack']);
    expect(r.terms).toEqual(['send']);
  });

  test('empty query produces zero terms', () => {
    const r = parseToolSearchQuery('   ');
    expect(r.kind).toBe('keyword');
    expect(r.terms).toEqual([]);
  });
});

describe('dispatchToolSearch — select path', () => {
  test('returns full schema for listed tool', () => {
    pushFakeCatalog([
      {
        id: 'fake_foo',
        aliases: ['FakeFoo', 'fake_foo'],
        displayName: 'FakeFoo',
        description: 'A fake tool for testing',
        promptSummary: '`FakeFoo` (fake test tool)',
        surface: ['skill'],
        safety: ['read-only'],
        supportsParallel: true,
        defaultEnabled: true,
      },
    ]);
    registerToolRuntime(fakeRuntime('fake_foo', 'FakeFoo', 'A fake tool for testing'));

    const result = dispatchToolSearch({ query: 'select:FakeFoo' });
    expect(result.matched).toEqual(['FakeFoo']);
    expect(result.unknown).toEqual([]);
    expect(result.content).toContain('<functions>');
    expect(result.content).toContain('<function>{');
    expect(result.content).toContain('"name":"FakeFoo"');
    expect(result.content).toContain('</functions>');
  });

  test('unknown names are reported but not fatal', () => {
    pushFakeCatalog([
      {
        id: 'fake_known',
        aliases: ['FakeKnown'],
        displayName: 'FakeKnown',
        description: 'known',
        promptSummary: '`FakeKnown` (known)',
        surface: ['skill'],
        safety: ['read-only'],
        supportsParallel: true,
        defaultEnabled: true,
      },
    ]);
    registerToolRuntime(fakeRuntime('fake_known', 'FakeKnown', 'known'));

    const result = dispatchToolSearch({ query: 'select:FakeKnown,NoSuchTool' });
    expect(result.matched).toEqual(['FakeKnown']);
    expect(result.unknown).toEqual(['NoSuchTool']);
    expect(result.content).toContain('unknown (NoSuchTool)');
  });

  test('case-insensitive alias match', () => {
    pushFakeCatalog([
      {
        id: 'alias_test',
        aliases: ['AliasTest', 'alias_test'],
        displayName: 'AliasTest',
        description: 'alias',
        promptSummary: '`AliasTest` (alias)',
        surface: ['skill'],
        safety: ['read-only'],
        supportsParallel: true,
        defaultEnabled: true,
      },
    ]);
    registerToolRuntime(fakeRuntime('alias_test', 'AliasTest', 'alias'));

    const result = dispatchToolSearch({ query: 'select:aliastest' });
    expect(result.matched).toEqual(['AliasTest']);
  });
});

describe('dispatchToolSearch — keyword path', () => {
  test('ranks name hit higher than description hit', () => {
    pushFakeCatalog([
      {
        id: 'slack_send',
        aliases: ['SlackSend'],
        displayName: 'SlackSend',
        description: 'Push an event to a channel',
        promptSummary: '`SlackSend` (push to channel)',
        surface: ['skill'],
        safety: ['network'],
        supportsParallel: true,
        defaultEnabled: true,
      },
      {
        id: 'other_thing',
        aliases: ['OtherThing'],
        displayName: 'OtherThing',
        description: 'Unrelated tool mentioning slack in passing',
        promptSummary: '`OtherThing` (mentions slack)',
        surface: ['skill'],
        safety: ['read-only'],
        supportsParallel: true,
        defaultEnabled: true,
      },
    ]);
    registerToolRuntime(fakeRuntime('slack_send', 'SlackSend', 'Push an event to a channel'));
    registerToolRuntime(fakeRuntime('other_thing', 'OtherThing', 'Unrelated tool mentioning slack in passing'));

    const result = dispatchToolSearch({ query: 'slack' });
    // SlackSend must rank first (name match > description mention).
    expect(result.matched[0]).toBe('SlackSend');
  });

  test('+required disqualifies entries missing the required term', () => {
    pushFakeCatalog([
      {
        id: 'slack_send_req',
        aliases: ['SlackSendReq'],
        displayName: 'SlackSendReq',
        description: 'send to slack',
        promptSummary: '`SlackSendReq` (slack)',
        surface: ['skill'],
        safety: ['network'],
        supportsParallel: true,
        defaultEnabled: true,
      },
      {
        id: 'email_send_req',
        aliases: ['EmailSendReq'],
        displayName: 'EmailSendReq',
        description: 'send via smtp',
        promptSummary: '`EmailSendReq` (email)',
        surface: ['skill'],
        safety: ['network'],
        supportsParallel: true,
        defaultEnabled: true,
      },
    ]);
    registerToolRuntime(fakeRuntime('slack_send_req', 'SlackSendReq', 'send to slack'));
    registerToolRuntime(fakeRuntime('email_send_req', 'EmailSendReq', 'send via smtp'));

    const result = dispatchToolSearch({ query: '+slack send' });
    expect(result.matched).toEqual(['SlackSendReq']);
  });

  test('empty result when nothing matches', () => {
    const result = dispatchToolSearch({ query: 'zzzzz_nothing_matches' });
    expect(result.matched).toEqual([]);
    expect(result.content).toContain('no matches');
  });

  test('max_results caps the returned schema count', () => {
    for (let i = 0; i < 4; i += 1) {
      pushFakeCatalog([
        {
          id: `bulk_${i}`,
          aliases: [`Bulk${i}`],
          displayName: `Bulk${i}`,
          description: 'bulk test tool',
          promptSummary: `\`Bulk${i}\` (bulk)`,
          surface: ['skill'],
          safety: ['read-only'],
          supportsParallel: true,
          defaultEnabled: true,
        },
      ]);
      registerToolRuntime(fakeRuntime(`bulk_${i}`, `Bulk${i}`, 'bulk test tool'));
    }
    const result = dispatchToolSearch({ query: 'bulk', max_results: 2 });
    expect(result.matched.length).toBe(2);
  });
});

describe('dispatchToolSearch — safety', () => {
  test('toolSearchable=false entries are hidden from select and keyword', () => {
    pushFakeCatalog([
      {
        id: 'hidden_thing',
        aliases: ['HiddenThing'],
        displayName: 'HiddenThing',
        description: 'should not appear',
        promptSummary: '`HiddenThing` (hidden)',
        surface: ['skill'],
        safety: ['read-only'],
        supportsParallel: true,
        defaultEnabled: true,
        toolSearchable: false,
      },
    ]);
    registerToolRuntime(fakeRuntime('hidden_thing', 'HiddenThing', 'should not appear'));

    const selectResult = dispatchToolSearch({ query: 'select:HiddenThing' });
    expect(selectResult.matched).toEqual([]);
    expect(selectResult.unknown).toEqual(['HiddenThing']);

    const keywordResult = dispatchToolSearch({ query: 'hidden' });
    expect(keywordResult.matched).toEqual([]);
  });
});

describe('toolSearchRuntime — ToolRuntime shape', () => {
  test('spec exposes correct name and required params', () => {
    expect(toolSearchRuntime.id).toBe('tool_search');
    expect(toolSearchRuntime.spec.name).toBe('ToolSearch');
    const params = toolSearchRuntime.spec.parameters as Record<string, unknown>;
    expect(params.required).toEqual(['query']);
  });

  test('run returns output string + matched/unknown arrays', async () => {
    pushFakeCatalog([
      {
        id: 'rt_ok',
        aliases: ['RtOk'],
        displayName: 'RtOk',
        description: 'runtime test',
        promptSummary: '`RtOk` (rt)',
        surface: ['skill'],
        safety: ['read-only'],
        supportsParallel: true,
        defaultEnabled: true,
      },
    ]);
    registerToolRuntime(fakeRuntime('rt_ok', 'RtOk', 'runtime test'));

    const result = await toolSearchRuntime.run({ query: 'select:RtOk' }, { surface: 'skill' });
    expect(result.matched).toEqual(['RtOk']);
    expect(result.unknown).toEqual([]);
    expect(typeof result.output).toBe('string');
    expect(result.output).toContain('<functions>');
  });
});

// ── ⭐ 서피스 spec 풀 하이드레이션 (F2 갭③ · 2026-07-26) ──────────────
// tool-runtime 레지스트리는 **대시보드** 개념이다. 데몬 서피스(webterm/ACP·chat)는
// boot/daemon-tools/index.ts 에서 스펙을 직접 조립하고 이름 switch 로 라우팅하므로
// SelfImplement 같은 배틀쉽은 ToolRuntime 으로 등록된 적이 없다. 레지스트리만 뒤지면
// 정확히 그 툴들에 대해 영원히 "no matches" 가 나온다 — 소환로가 끊기는 세 번째 지점.
describe('dispatchToolSearch — 서피스 spec 풀', () => {
  const poolSpec = {
    name: 'SelfImplementFake',
    description: 'Autonomously implement a feature and open a draft PR.',
    parameters: {
      type: 'object',
      properties: { feature: { type: 'string', description: 'what to build' } },
      required: ['feature'],
    },
  };

  test('레지스트리 미등록 툴도 spec 풀로 select 하이드레이션된다', () => {
    // 레지스트리엔 아무것도 없다(beforeEach 리셋) — 풀만이 유일한 출처.
    const result = dispatchToolSearch({ query: 'select:SelfImplementFake' }, { specs: [poolSpec] });
    expect(result.matched).toEqual(['SelfImplementFake']);
    expect(result.unknown).toEqual([]);
    expect(result.content).toContain('<functions>');
    // 스키마 본문이 실제로 실려야 다음 턴에 호출 가능.
    expect(result.content).toContain('"feature"');
  });

  test('풀 없이는 같은 질의가 unknown 으로 떨어진다(회귀 전 동작 고정)', () => {
    const result = dispatchToolSearch({ query: 'select:SelfImplementFake' });
    expect(result.matched).toEqual([]);
    expect(result.unknown).toEqual(['SelfImplementFake']);
  });

  test('키워드 검색도 spec 풀을 훑는다', () => {
    const result = dispatchToolSearch({ query: 'autonomously implement' }, { specs: [poolSpec] });
    expect(result.matched).toContain('SelfImplementFake');
  });

  test('카탈로그 alias 로도 풀 스펙이 해석된다', () => {
    pushFakeCatalog([
      {
        id: 'self_implement_fake',
        aliases: ['SelfImplementFake', 'self_implement_fake'],
        displayName: 'SelfImplementFake',
        description: 'catalog description',
        promptSummary: '`SelfImplementFake` (summary)',
        surface: ['dashboard'],
        safety: ['agent'],
        supportsParallel: false,
        defaultEnabled: true,
        alwaysLoad: false,
        shouldDefer: true,
      },
    ]);
    const result = dispatchToolSearch({ query: 'select:self_implement_fake' }, { specs: [poolSpec] });
    expect(result.matched).toEqual(['SelfImplementFake']);
    expect(result.content).toContain('"feature"');
  });

  test('toolSearchable:false 는 풀에 있어도 소환 불가(안전 불변식 유지)', () => {
    pushFakeCatalog([
      {
        id: 'hidden_fake',
        aliases: ['HiddenFake'],
        displayName: 'HiddenFake',
        description: 'must never surface',
        promptSummary: '`HiddenFake`',
        surface: ['dashboard'],
        safety: ['read-only'],
        supportsParallel: false,
        defaultEnabled: true,
        toolSearchable: false,
      },
    ]);
    const hidden = { ...poolSpec, name: 'HiddenFake' };
    const result = dispatchToolSearch({ query: 'select:HiddenFake' }, { specs: [hidden] });
    expect(result.matched).toEqual([]);
    expect(result.unknown).toEqual(['HiddenFake']);
  });

  // 레지스트리 등록 여부는 **풀을 넘기지 않은 경로**에서만 의미가 있다.
  // 풀을 넘겼는데도 레지스트리를 뒤지면 서피스가 dispatch 못 하는 스키마가
  // 새어나간다(아래 '권위적 allowlist' describe 가 그 계약을 못박는다).
  test('레지스트리 등록 툴도 풀에 들어있으면 해석된다', () => {
    registerToolRuntime(fakeRuntime('registered_fake', 'RegisteredFake', 'registered tool'));
    pushFakeCatalog([
      {
        id: 'registered_fake',
        aliases: ['RegisteredFake'],
        displayName: 'RegisteredFake',
        description: 'registered tool',
        promptSummary: '`RegisteredFake`',
        surface: ['dashboard'],
        safety: ['read-only'],
        supportsParallel: false,
        defaultEnabled: true,
      },
    ]);
    const exposed = { ...poolSpec, name: 'RegisteredFake' };
    const result = dispatchToolSearch({ query: 'select:RegisteredFake' }, { specs: [exposed] });
    expect(result.matched).toEqual(['RegisteredFake']);
  });
});

// ── 권위적 allowlist (monad self review #5460 must-fix) ─────────────
// `specs` 를 넘겼는데도 전역 레지스트리로 fallback 하면, 호출 서피스가
// dispatch 할 수 없는 스키마를 모델에 쥐여준다("unknown tool" 로 악화) —
// 그리고 nest-cap 이 카탈로그에서 뺀 자식-spawn 툴이 되살아난다(cap 은
// 서피스 카탈로그를 자르지 레지스트리를 자르지 않는다).
describe('dispatchToolSearch — spec 풀은 권위적 allowlist', () => {
  const poolSpec = {
    name: 'InPool',
    description: 'a tool the surface actually exposes',
    parameters: { type: 'object', properties: {}, required: [] },
  };

  function registerOutsider(): void {
    registerToolRuntime(fakeRuntime('outsider_fake', 'OutsiderFake', 'registered but NOT exposed'));
    pushFakeCatalog([
      {
        id: 'outsider_fake',
        aliases: ['OutsiderFake'],
        displayName: 'OutsiderFake',
        description: 'registered but NOT exposed by the calling surface',
        promptSummary: '`OutsiderFake`',
        surface: ['dashboard'],
        safety: ['agent'],
        supportsParallel: false,
        defaultEnabled: true,
      },
    ]);
  }

  test('레지스트리에 있어도 풀 밖이면 select 불가', () => {
    registerOutsider();
    const result = dispatchToolSearch({ query: 'select:OutsiderFake' }, { specs: [poolSpec] });
    expect(result.matched).toEqual([]);
    expect(result.unknown).toEqual(['OutsiderFake']);
    expect(result.content).not.toContain('<functions>');
  });

  test('레지스트리에 있어도 풀 밖이면 키워드 검색에도 안 뜬다', () => {
    registerOutsider();
    const result = dispatchToolSearch({ query: 'registered exposed' }, { specs: [poolSpec] });
    expect(result.matched).not.toContain('OutsiderFake');
  });

  test('풀을 안 넘기면 레지스트리 조회가 그대로 동작한다(대시보드 경로 무회귀)', () => {
    registerOutsider();
    const result = dispatchToolSearch({ query: 'select:OutsiderFake' });
    expect(result.matched).toEqual(['OutsiderFake']);
  });

  test('빈 배열 풀 = 아무것도 소환 불가(closed world, 레지스트리 폴백 없음)', () => {
    registerOutsider();
    const result = dispatchToolSearch({ query: 'select:OutsiderFake' }, { specs: [] });
    expect(result.matched).toEqual([]);
    expect(result.unknown).toEqual(['OutsiderFake']);
  });
});

// ── 대시보드 래퍼가 하이드레이션 키를 전달하는가 (should-fix · monad review #5461) ──
// 이 래퍼는 원래 output/matched/unknown 만 투영해 **하이드레이션 스펙을 조용히 떨궜다**
// → 대시보드 경로에선 소환해도 툴이 계속 호출 불가였다. 배선 주장을 직접 검증한다.
describe('toolSearchRuntime — 하이드레이션 키 전달', () => {
  function registerSearchable(): void {
    registerToolRuntime(fakeRuntime('wrapped_fake', 'WrappedFake', 'wrapped tool'));
    pushFakeCatalog([
      {
        id: 'wrapped_fake',
        aliases: ['WrappedFake'],
        displayName: 'WrappedFake',
        description: 'wrapped tool',
        promptSummary: '`WrappedFake`',
        surface: ['dashboard'],
        safety: ['read-only'],
        supportsParallel: false,
        defaultEnabled: true,
        alwaysLoad: false,
        shouldDefer: true,
      },
    ]);
  }

  test('run() 결과가 스펙을 실어 보낸다(투영에서 떨구지 않음)', async () => {
    registerSearchable();
    const out = await toolSearchRuntime.run(
      { query: 'select:WrappedFake' },
      {} as never,
    ) as Record<string, unknown>;
    expect(out.matched).toEqual(['WrappedFake']);
    const hydrated = out[HYDRATED_TOOLS_KEY] as { name: string }[] | undefined;
    expect(hydrated?.map((s) => s.name)).toEqual(['WrappedFake']);
    // 렌더 블록도 그대로 유지(모델이 읽는 쪽).
    expect(String(out.output)).toContain('<functions>');
  });

  test('소환 실패면 키를 아예 붙이지 않는다(빈 배열 노이즈 금지)', async () => {
    const out = await toolSearchRuntime.run(
      { query: 'select:NoSuchToolAtAll' },
      {} as never,
    ) as Record<string, unknown>;
    expect(out.matched).toEqual([]);
    expect(HYDRATED_TOOLS_KEY in out).toBe(false);
  });
});
