import { describe, expect, it } from 'bun:test';
import { graphAuthorityFields, resolveGraphAuthority } from '../src/self-implement/graph-authority.js';
import { loadGraphTemplatesFrom, defaultGraphsDir } from '../src/self-implement/graph-templates.js';

/** ⭐ 제어 «출처»가 런마다 원장에 남는가.
 *
 *  🩸 2026-09-08: 이 값은 `gate-skipped-by-graph` «한 자리»에서만 났고, 그 사건은
 *    research-loop 이 문서만 바꿨을 때만 난다 ⇒ ***대부분의 런에서 「무엇이 켰나」가 원장에 없었다***.
 *    ⇒ A/B 의 관문(「두 팔이 갈렸나」)이 «원리상» 답을 못 얻었다.
 *  ⛔ 「켜짐」만 남기면 ***「안 켰다」와 「켰는데 안 먹었다」가 같은 값***이 된다 — `source` 가 그것을 가른다. */
describe('제어 출처 관측', () => {
  const t = loadGraphTemplatesFrom(defaultGraphsDir()).templates['self-implement']!;

  it('⛔ 출처 셋이 «서로 다른 값»으로 나온다 — 하나로 접히지 않는다', () => {
    const of = (a: Parameters<typeof graphAuthorityFields>[0]) => graphAuthorityFields(a, t).graphAuthoritativeSource;
    expect(of(resolveGraphAuthority({ flag: true }))).toBe('flag');
    expect(of(resolveGraphAuthority({ config: true }))).toBe('config');
    expect(of(resolveGraphAuthority({}))).toBe('default');
  });

  it('⛔ 「꺼짐」도 «출처»를 갖는다 — 「안 켰다」와 「끄라고 했다」는 다른 값이다', () => {
    const off = graphAuthorityFields(resolveGraphAuthority({ flag: false }), t);
    expect(off.graphAuthoritative).toBe(false);
    expect(off.graphAuthoritativeSource).toBe('flag');      // ⭐ default 가 아니다
    const none = graphAuthorityFields(resolveGraphAuthority({}), t);
    expect(none.graphAuthoritativeSource).toBe('default');
  });

  it('⛔ 반증 — flag 가 config 를 «이긴다»(사람이 명시로 준 것이 위다)', () => {
    expect(resolveGraphAuthority({ flag: false, config: true }).enabled).toBe(false);
    expect(resolveGraphAuthority({ flag: false, config: true }).source).toBe('flag');
  });
});
