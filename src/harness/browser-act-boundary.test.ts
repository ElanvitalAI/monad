import { describe, expect, test } from 'bun:test';
import { decideActionBoundary } from './browser-act-boundary.js';

const at = (over: Partial<Parameters<typeof decideActionBoundary>[0]> = {}) =>
  decideActionBoundary({ hosts: ['news.ycombinator.com'], url: 'https://news.ycombinator.com/', href: null, ...over });

describe('decideActionBoundary', () => {
  test('선언이 «없으면» 막지 않는다 — 대신 그렇다고 «말한다»', () => {
    const r = at({ hosts: undefined });
    expect(r.verdict).toBe('undeclared');
    expect(r.allowed).toBe(true);
    expect(r.detail).toContain('어디로든');
  });

  test('빈 배열·빈 문자열도 «선언 없음»이다 — 조용히 막지 않는다', () => {
    expect(at({ hosts: [] }).verdict).toBe('undeclared');
    expect(at({ hosts: ['', '  '] }).verdict).toBe('undeclared');
  });

  test('여는 주소가 «밖»이면 아예 손을 안 쓴다', () => {
    const r = at({ url: 'https://evil.test/' });
    expect(r.verdict).toBe('outside');
    expect(r.allowed).toBe(false);
    expect(r.detail).toContain('여는 주소');
  });

  /** ⭐ 이 시험이 이 모듈의 «요지»다 — 누르기 «전»에 목적지를 보고 막는다. */
  test('⭐ 링크가 «경계 밖»을 가리키면 «누르기 전»에 막는다', () => {
    const r = at({ href: 'https://elsewhere.test/x' });
    expect(r.verdict).toBe('outside');
    expect(r.allowed).toBe(false);
    expect(r.detail).toContain('링크가 가리키는 곳');
    expect(r.detail).toContain('elsewhere.test');
  });

  test('둘 다 안이면 통과하고 «그렇다고» 말한다', () => {
    const r = at({ href: 'https://news.ycombinator.com/item?id=1' });
    expect(r.verdict).toBe('inside');
    expect(r.detail).toContain('둘 다');
  });

  test('이동이 «아닌» 클릭은 링크 검사를 건너뛴다 — 없는 것을 밖이라 하지 않는다', () => {
    const r = at({ href: null });
    expect(r.verdict).toBe('inside');
    expect(r.detail).toContain('이동이 아니다');
  });

  test('www 는 같은 것으로 본다 (양방향)', () => {
    expect(at({ hosts: ['example.com'], url: 'https://www.example.com/' }).verdict).toBe('inside');
    expect(at({ hosts: ['www.example.com'], url: 'https://example.com/' }).verdict).toBe('inside');
  });

  test('⛔ 하위 도메인은 «암묵»으로 안 열린다 — 점을 명시해야 열린다', () => {
    expect(at({ hosts: ['example.com'], url: 'https://a.example.com/' }).verdict).toBe('outside');
    expect(at({ hosts: ['.example.com'], url: 'https://a.example.com/' }).verdict).toBe('inside');
    expect(at({ hosts: ['.example.com'], url: 'https://example.com/' }).verdict).toBe('inside');
  });

  test('⛔ 접두가 겹치는 «다른» 도메인이 새어 들지 않는다', () => {
    expect(at({ hosts: ['.example.com'], url: 'https://evil-example.com/' }).verdict).toBe('outside');
    expect(at({ hosts: ['example.com'], url: 'https://evilexample.com/' }).verdict).toBe('outside');
  });

  test('⛔ 주소를 «못 읽으면» 안이라 하지 않는다 — 모르면 막는다', () => {
    const r = at({ url: '::::not-a-url::::' });
    expect(r.verdict).toBe('outside');
    expect(r.detail).toContain('못 읽었다');
  });

  test('대소문자는 «같은 것»이다', () => {
    expect(at({ hosts: ['News.YCombinator.COM'], url: 'https://NEWS.ycombinator.com/' }).verdict).toBe('inside');
  });

  test('⛔ javascript: 는 허용 호스트를 담아도 막는다 — 호스트가 같다고 같은 곳이 아니다', () => {
    const r = at({ href: 'javascript://news.ycombinator.com/%0aalert(1)' });
    expect(r.allowed).toBe(false);
    expect(r.verdict).toBe('outside');
  });

  test('⛔ file: 는 허용 호스트를 담아도 막는다', () => {
    const r = at({ href: 'file://news.ycombinator.com/etc/passwd' });
    expect(r.allowed).toBe(false);
    expect(r.verdict).toBe('outside');
  });

  test('정상 https 링크는 통과한다 — 알려진 음성 (전부 막는 구현이 통과하지 못하게)', () => {
    const r = at({ href: 'https://news.ycombinator.com/x' });
    expect(r.allowed).toBe(true);
    expect(r.verdict).toBe('inside');
  });

  test('http: 는 허용한다 — 기존 동작 유지', () => {
    const r = at({ url: 'http://news.ycombinator.com/', href: 'http://news.ycombinator.com/x' });
    expect(r.allowed).toBe(true);
    expect(r.verdict).toBe('inside');
  });
});

/**
 * 🆕 **목적지를 «미리 못 적는» 봇** — RFC §23b-2 · 2026-08-29(36차).
 *
 * ⛔ 이 묶음의 요점은 「열린다」가 아니라 ***「무엇이 «안» 열리나」***다:
 *    ⑴ 기본은 그대로 막는다 ⑵ 이동이 «아니면» 안 열린다 ⑶ 열려도 `inside` 가 아니라 «셀 수 있는» 값이다.
 */
describe('decideActionBoundary — 바깥 이동(offsiteNavigation)', () => {
  const hn = 'https://news.ycombinator.com/';
  const offsite = 'https://blog.cloudflare.com/some-article';

  test('⛔ 기본은 «지금까지와 똑같다» — 선언이 없으면 목적지가 밖이면 막는다', () => {
    const r = decideActionBoundary({
      hosts: ['news.ycombinator.com'], url: hn, href: offsite, kind: 'navigation',
    });
    expect(r.verdict).toBe('outside');
    expect(r.allowed).toBe(false);
  });

  test('명시 ⊕ 이동이면 «누른다» — ⛔ 그러나 inside 가 아니라 «셀 수 있는» 값이다', () => {
    const r = decideActionBoundary({
      hosts: ['news.ycombinator.com'], url: hn, href: offsite,
      kind: 'navigation', offsiteNavigation: 'allowed',
    });
    expect(r.allowed).toBe(true);
    // ⭐ 이 한 줄이 이 기능의 «값»이다 — `inside` 로 접으면 「몇 번 넘었나」를 영영 못 센다.
    expect(r.verdict).toBe('offsite-navigation');
    expect(r.detail).toContain('센다');
  });

  test('⛔ 명시했어도 «이동이 아니면» 안 열린다 — 넓어지는 것은 「읽으러 나가는 것」 하나뿐이다', () => {
    for (const kind of ['submit', 'other'] as const) {
      const r = decideActionBoundary({
        hosts: ['news.ycombinator.com'], url: hn, href: offsite, kind, offsiteNavigation: 'allowed',
      });
      expect(r.verdict).toBe('outside');
      expect(r.allowed).toBe(false);
    }
  });

  test('⛔ kind 를 «못 읽었으면» 안 열린다 — 「모른다」를 「괜찮다」로 읽지 않는다', () => {
    const r = decideActionBoundary({
      hosts: ['news.ycombinator.com'], url: hn, href: offsite, offsiteNavigation: 'allowed',
    });
    expect(r.verdict).toBe('outside');
    expect(r.allowed).toBe(false);
  });

  test('⛔ «출발지»는 여전히 좁다 — 경계 밖 페이지에서는 명시가 있어도 손을 안 쓴다', () => {
    const r = decideActionBoundary({
      hosts: ['news.ycombinator.com'], url: 'https://evil.test/', href: offsite,
      kind: 'navigation', offsiteNavigation: 'allowed',
    });
    expect(r.verdict).toBe('outside');
    expect(r.allowed).toBe(false);
    expect(r.detail).toContain('여는 주소');
  });

  test('목적지가 «안»이면 명시가 있어도 그냥 inside 다 — 안 넘었으니 셀 것이 없다', () => {
    const r = decideActionBoundary({
      hosts: ['news.ycombinator.com'], url: hn, href: 'https://news.ycombinator.com/item?id=1',
      kind: 'navigation', offsiteNavigation: 'allowed',
    });
    expect(r.verdict).toBe('inside');
  });

  test('⛔ javascript: 는 offsiteNavigation=allowed ⊕ navigation 이어도 막는다', () => {
    const r = decideActionBoundary({
      hosts: ['news.ycombinator.com'], url: hn,
      href: 'javascript://news.ycombinator.com/%0aalert(1)',
      kind: 'navigation', offsiteNavigation: 'allowed',
    });
    expect(r.allowed).toBe(false);
    expect(r.verdict).toBe('outside');
    expect(r.verdict).not.toBe('offsite-navigation');
  });

  test('⛔ file: 도 offsite 허용 ⊕ navigation 이어도 막는다', () => {
    const r = decideActionBoundary({
      hosts: ['news.ycombinator.com'], url: hn,
      href: 'file://news.ycombinator.com/etc/passwd',
      kind: 'navigation', offsiteNavigation: 'allowed',
    });
    expect(r.allowed).toBe(false);
    expect(r.verdict).toBe('outside');
    expect(r.verdict).not.toBe('offsite-navigation');
  });

  test('정상 https 바깥 이동은 명시가 있으면 그대로 센다 — 대조 (스킴 거부가 전부를 막지 못하게)', () => {
    const r = decideActionBoundary({
      hosts: ['news.ycombinator.com'], url: hn, href: offsite,
      kind: 'navigation', offsiteNavigation: 'allowed',
    });
    expect(r.allowed).toBe(true);
    expect(r.verdict).toBe('offsite-navigation');
  });

  test('http: 같은 호스트는 offsite 명시와 무관하게 inside 다 — 기존 동작 유지', () => {
    const r = decideActionBoundary({
      hosts: ['news.ycombinator.com'],
      url: 'http://news.ycombinator.com/',
      href: 'http://news.ycombinator.com/x',
      kind: 'navigation', offsiteNavigation: 'allowed',
    });
    expect(r.allowed).toBe(true);
    expect(r.verdict).toBe('inside');
  });
});
