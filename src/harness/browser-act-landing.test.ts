import { describe, expect, test } from 'bun:test';
import { assessLanding } from './browser-act-landing.js';

describe('assessLanding', () => {
  test('그대로 갔으면 exact — 놀랄 일이 아니다', () => {
    const r = assessLanding('https://a.test/x', 'https://a.test/x');
    expect(r.verdict).toBe('exact');
    expect(r.surprising).toBe(false);
  });

  test('같은 사이트에서 경로만 바뀐 것은 «정상»이다 — 빨강으로 만들지 않는다', () => {
    const r = assessLanding('https://a.test/old', 'https://a.test/new');
    expect(r.verdict).toBe('same-host');
    expect(r.surprising).toBe(false);
  });

  test('www 만 다른 것도 정상이다 — 📏 실측 8건이 이 갈래였다', () => {
    expect(assessLanding('https://iana.org/domains/example', 'https://www.iana.org/help/example-domains').verdict)
      .toBe('www-only');
    expect(assessLanding('https://www.a.test/x', 'https://a.test/x').verdict).toBe('www-only');
  });

  test('⛔ «다른 사이트»로 간 것만 놀랄 일이다', () => {
    const r = assessLanding('https://a.test/x', 'https://evil.test/x');
    expect(r.verdict).toBe('cross-host');
    expect(r.surprising).toBe(true);
    expect(r.detail).toContain('a.test');
    expect(r.detail).toContain('evil.test');
  });

  test('⛔ www 를 «글자»로 떼지 않는다 — wwwx.test 는 x.test 가 아니다', () => {
    expect(assessLanding('https://wwwx.test/a', 'https://x.test/a').verdict).toBe('cross-host');
  });

  test('한쪽이 «없으면» 못 쟀다 — 그리고 «어느 쪽»인지 말한다', () => {
    expect(assessLanding(null, 'https://a.test/x').detail).toContain('가려던 곳이');
    expect(assessLanding('https://a.test/x', null).detail).toContain('간 곳이');
    expect(assessLanding(null, null).detail).toContain('둘 다');
  });

  test('못 쟀다는 «놀랄 일이 아니다» — 없는 것을 사고로 읽지 않는다', () => {
    expect(assessLanding(undefined, undefined).surprising).toBe(false);
  });

  test('URL 이 «깨졌으면» 그렇다고 말한다 — 다른 사이트로 읽지 않는다', () => {
    const r = assessLanding('::::not-a-url::::', 'https://a.test/x');
    expect(r.verdict).toBe('unmeasured');
    expect(r.detail).toContain('못 읽었다');
  });

  test('대소문자가 달라도 같은 호스트다', () => {
    expect(assessLanding('https://A.TEST/x', 'https://a.test/y').verdict).toBe('same-host');
  });

  test('⛔ javascript: 는 호스트가 같아도 못 잰다 — hostOf 가 null 을 돌려 기존 unmeasured 갈래로 간다', () => {
    const r = assessLanding('javascript://a.test/%0aalert(1)', 'https://a.test/x');
    expect(r.verdict).toBe('unmeasured');
    expect(r.detail).toContain('못 읽었다');
  });

  test('⛔ file: 도 못 잰다 — 호스트명만으로 같은 곳으로 읽지 않는다', () => {
    const r = assessLanding('file://a.test/etc/passwd', 'https://a.test/x');
    expect(r.verdict).toBe('unmeasured');
    expect(r.detail).toContain('못 읽었다');
  });

  test('정상 https 는 그대로 잰다 — 알려진 음성', () => {
    expect(assessLanding('https://a.test/old', 'https://a.test/new').verdict).toBe('same-host');
  });

  test('http: 는 허용해 기존처럼 잰다', () => {
    expect(assessLanding('http://a.test/old', 'http://a.test/new').verdict).toBe('same-host');
  });

  test('⛔ javascript: 가 href===landed 여도 exact 가 아니라 unmeasured', () => {
    const js = 'javascript://a.test/%0aalert(1)';
    const r = assessLanding(js, js);
    expect(r.verdict).toBe('unmeasured');
    expect(r.detail).toContain('못 읽었다');
  });

  test('⛔ file: 가 href===landed 여도 exact 가 아니라 unmeasured', () => {
    const f = 'file://a.test/etc/passwd';
    expect(assessLanding(f, f).verdict).toBe('unmeasured');
  });

  test('⛔ javascript: 가 출발지와 같아도 did-not-move 가 아니라 unmeasured', () => {
    const start = 'javascript://a.test/start';
    const r = assessLanding('javascript://a.test/dest', start, start);
    expect(r.verdict).toBe('unmeasured');
    expect(r.detail).toContain('못 읽었다');
  });

  test('⛔ file: 가 출발지와 같아도 did-not-move 가 아니라 unmeasured', () => {
    const start = 'file://a.test/start';
    expect(assessLanding('file://a.test/dest', start, start).verdict).toBe('unmeasured');
  });

  test('정상 https 동일 URL 은 여전히 exact — 알려진 음성', () => {
    expect(assessLanding('https://a.test/x', 'https://a.test/x').verdict).toBe('exact');
  });
});

describe('did-not-move (2026-08-28 · VM 실물에서 나왔다)', () => {
  // 📏 VM 의 newsbot 브라우저에서 target="_blank" 링크를 눌렀을 때:
  //    clickedHref=/dest · landedUrl=/newtab(출발지) ⇒ 옛 판정기는 `same-host` 라 했다.
  //    ⛔ 그런데 이 페이지는 ***이동을 «아예 안 했다»*** — 새 탭이 열렸을 뿐이다.
  const start = 'http://127.0.0.1:1/newtab';

  test('링크는 다른 곳인데 «출발지 그대로»면 did-not-move 다', () => {
    const r = assessLanding('http://127.0.0.1:1/dest', start, start);
    expect(r.verdict).toBe('did-not-move');
    expect(r.detail).toContain('안 움직였다');
    expect(r.surprising).toBe(false);   // ⛔ 결함이 아니다 — 사실이다
  });

  test('끝의 «슬래시 하나»로 다르다고 하지 않는다', () => {
    expect(assessLanding('http://a.test/x', 'http://a.test/', 'http://a.test').verdict).toBe('did-not-move');
  });

  test('⛔ 출발지를 «안 주면» 그 갈래를 만들지 않는다 — 없는 정보로 지어내지 않는다', () => {
    expect(assessLanding('http://127.0.0.1:1/dest', start).verdict).toBe('same-host');
  });

  test('진짜로 «움직였으면» did-not-move 가 아니다', () => {
    expect(assessLanding('http://a.test/x', 'http://a.test/x', 'http://a.test/start').verdict).toBe('exact');
    expect(assessLanding('http://a.test/x', 'http://a.test/y', 'http://a.test/start').verdict).toBe('same-host');
  });

  test('다른 사이트로 갔으면 «출발지를 줘도» cross-host 다', () => {
    expect(assessLanding('http://a.test/x', 'http://b.test/x', 'http://a.test/start').verdict).toBe('cross-host');
  });
});

describe('제출 클릭의 «못 쟀다»는 이유가 다르다 (VM 실물)', () => {
  test('href 가 «구조적으로» 없는 클릭임을 말한다 — 옛 행과 뭉치지 않는다', () => {
    // 📏 VM 실물: --allow any 로 폼 버튼을 눌렀을 때 clickedHref=null · landedUrl=/submitted?
    const r = assessLanding(null, 'http://127.0.0.1:1/submitted?');
    expect(r.verdict).toBe('unmeasured');
    expect(r.detail).toContain('원리상 불가');
  });
  test('둘 다 없으면 그 이유를 «안» 붙인다', () => {
    expect(assessLanding(null, null).detail).not.toContain('원리상 불가');
  });
});
