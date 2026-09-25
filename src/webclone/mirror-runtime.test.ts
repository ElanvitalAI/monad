// ── 실행 자기완결 시험 — ⛔ 「문서가 자기완결」과 «다른 값»인가 ─────────────────
//
// 🩸 계기(2026-09-11): starbucks 미러가 문서로는 ✅ self-contained 였는데
//    `http://` 로 열면 원격 요청이 «나갔다». 저장된 문서의 참조는 «제대로» 로컬이었고,
//    JS 가 런타임에 «또» 만들어 부른 것이었다.

import { describe, expect, test } from 'bun:test';

import {
  classifyRequestOrigin, isMirrorFilePath, judgeRuntime, tallyRuntime,
  INLINE_SCHEMES, MIRROR_RUNTIME_BLIND_SPOTS, type RuntimeRequest,
} from './mirror-runtime.js';

const ORIGIN = 'http://127.0.0.1:8921';

describe('classifyRequestOrigin', () => {
  test('같은 «출처»면 로컬이다', () => {
    expect(classifyRequestOrigin(`${ORIGIN}/index.html`, ORIGIN)).toBe('local');
    expect(classifyRequestOrigin(`${ORIGIN}/_r/a/x.png`, ORIGIN)).toBe('local');
  });
  test('⛔ 포트가 다르면 «다른 곳»이다 — 호스트 이름이 아니라 출처로 본다', () => {
    expect(classifyRequestOrigin('http://127.0.0.1:9999/x.png', ORIGIN)).toBe('remote');
  });
  test('다른 호스트는 원격이다', () => {
    expect(classifyRequestOrigin('https://image.istarbucks.co.kr/a.jpg', ORIGIN)).toBe('remote');
  });
  test('네트워크를 «안 타는» 것은 inline 이다', () => {
    for (const s of INLINE_SCHEMES) expect(classifyRequestOrigin(`${s}whatever`, ORIGIN)).toBe('inline');
  });
  test('상대 경로는 문서 출처로 풀리니 로컬이다', () => {
    expect(classifyRequestOrigin('/common/js/a.js', ORIGIN)).toBe('local');
    expect(classifyRequestOrigin('_r/a/x.png', ORIGIN)).toBe('local');
  });
  test('⛔ 빈 값은 «모른다» — 로컬로 몰지 않는다', () => {
    expect(classifyRequestOrigin('', ORIGIN)).toBe('unknown');
    expect(classifyRequestOrigin('   ', ORIGIN)).toBe('unknown');
  });
});

describe('tallyRuntime', () => {
  const reqs: RuntimeRequest[] = [
    { url: `${ORIGIN}/index.html`, resourceType: 'Document' },
    { url: `${ORIGIN}/_r/a/x.png`, resourceType: 'Image' },
    { url: 'https://image.istarbucks.co.kr/a.jpg', resourceType: 'Image' },
    { url: 'https://image.istarbucks.co.kr/b.jpg', resourceType: 'Image' },
    { url: 'https://www.googletagmanager.com/gtag/js', resourceType: 'Script' },
    { url: 'data:image/gif;base64,AAA', resourceType: 'Image' },
  ];
  test('갈래마다 «수»가 맞는다', () => {
    const t = tallyRuntime(reqs, ORIGIN);
    expect(t.total).toBe(6);
    expect(t.local).toBe(2);
    expect(t.remote).toBe(3);
    expect(t.inline).toBe(1);
  });
  test('원격 호스트를 «이름으로» 낸다 — 많은 순으로', () => {
    expect(tallyRuntime(reqs, ORIGIN).remoteByHost[0]).toEqual(['image.istarbucks.co.kr', 2]);
  });
  test('⛔ 「미러가 줬어야 할 것」의 실패만 결손으로 센다', () => {
    const t = tallyRuntime([
      { url: `${ORIGIN}/_r/a/missing.png`, resourceType: 'Image', failure: 'net::ERR_FILE_NOT_FOUND' },
      { url: 'https://a.example.com/x.png', resourceType: 'Image', failure: 'net::ERR_FAILED' },
    ], ORIGIN);
    expect(t.failedMirrorFile).toBe(1);
    expect(t.failedRemote).toBe(1);
    expect(t.failedInventedPath).toBe(0);
  });
});

describe('judgeRuntime', () => {
  test('⛔ 요청이 «하나도» 없으면 「못 쟀다」이지 「성공」이 아니다', () => {
    const v = judgeRuntime(tallyRuntime([], ORIGIN));
    expect(v.kind).toBe('unmeasured');
    expect(v.why).toContain('못 쟀다');
  });
  test('전부 로컬·인라인이면 실행도 자기완결이다', () => {
    const v = judgeRuntime(tallyRuntime([
      { url: `${ORIGIN}/index.html`, resourceType: 'Document' },
      { url: 'data:image/gif;base64,AAA', resourceType: 'Image' },
    ], ORIGIN));
    expect(v.kind).toBe('runtime-self-contained');
  });
  test('원격이 하나라도 있으면 «부른다»고 말한다 — 호스트 이름과 함께', () => {
    const v = judgeRuntime(tallyRuntime([
      { url: `${ORIGIN}/index.html`, resourceType: 'Document' },
      { url: 'https://image.istarbucks.co.kr/a.jpg', resourceType: 'Image' },
    ], ORIGIN));
    expect(v.kind).toBe('runtime-calls-remote');
    expect(v.why).toContain('image.istarbucks.co.kr');
    expect(v.why).toContain('원리상');
  });
  test('⭐ 미러 파일이 실패하면 «미러의 결손»이라고 «따로» 말한다', () => {
    const v = judgeRuntime(tallyRuntime([
      { url: `${ORIGIN}/_r/a/missing.png`, resourceType: 'Image', failure: 'net::ERR_FILE_NOT_FOUND' },
    ], ORIGIN));
    expect(v.why).toContain('미러의 «결손»');
  });
  test('⛔ 못 담는 것을 «값»으로 낸다', () => {
    expect(MIRROR_RUNTIME_BLIND_SPOTS.length).toBeGreaterThanOrEqual(4);
    expect(MIRROR_RUNTIME_BLIND_SPOTS.join(' ')).toContain('service-worker');
  });
});

/**
 * ⛔⭐⭐ 🩸 ***오늘 내내 고친 「분모 오염」이 «내가 방금 만든 자»에 그대로 있었다.***
 * apple 에서 Adobe 분석 비콘(`http://127.0.0.1/b/ss/…`)이 「미러의 결손」으로 세어졌고
 * 실행마다 **5 ↔ 2** 로 흔들렸다. 그것은 ***JS 가 지어낸 경로***다.
 */
describe('미러 파일 ↔ JS 가 지어낸 경로', () => {
  test('문서 자신과 `_r/` 아래만 「미러가 줬어야 할 것」이다', () => {
    expect(isMirrorFilePath(`${ORIGIN}/`, ORIGIN)).toBe(true);
    expect(isMirrorFilePath(`${ORIGIN}/index.html`, ORIGIN)).toBe(true);
    expect(isMirrorFilePath(`${ORIGIN}/_r/a/x.png`, ORIGIN)).toBe(true);
  });
  test('⛔ 그 밖의 경로는 JS 가 «지어낸» 것이다', () => {
    expect(isMirrorFilePath(`${ORIGIN}/b/ss/applestoreww/1/JS-2.23.0/s666`, ORIGIN)).toBe(false);
    expect(isMirrorFilePath(`${ORIGIN}/interface/checkLogin.do`, ORIGIN)).toBe(false);
  });
  test('다른 출처는 미러 파일이 아니다', () => {
    expect(isMirrorFilePath('https://a.example.com/_r/x.png', ORIGIN)).toBe(false);
  });
  test('⭐ 분석 비콘을 «결손»으로 세지 않는다 — 세되 «갈라» 센다', () => {
    const t = tallyRuntime([
      { url: `${ORIGIN}/b/ss/applestoreww/1/JS-2.23.0/s666`, resourceType: 'Image', failure: 'net::ERR_CONNECTION_REFUSED' },
    ], ORIGIN);
    expect(t.failedMirrorFile).toBe(0);
    expect(t.failedInventedPath).toBe(1);
  });
  test('판정 문면이 둘을 «다르게» 말한다', () => {
    const v = judgeRuntime(tallyRuntime([
      { url: `${ORIGIN}/index.html`, resourceType: 'Document' },
      { url: `${ORIGIN}/b/ss/x`, resourceType: 'Image', failure: 'net::ERR_CONNECTION_REFUSED' },
    ], ORIGIN));
    expect(v.kind).toBe('runtime-self-contained');
    expect(v.why).toContain('«결손이 아니다»');
    expect(v.why).not.toContain('미러의 «결손»');
  });
});

/**
 * ⛔⭐ 같은 «호스트»의 다른 포트는 「바깥으로 나간 것」이 아니다.
 * 🩸 apple: `http://127.0.0.1/b/ss/…`(포트 80) 분석 비콘이 «원격 3건»으로 세어졌다.
 */
describe('같은 호스트 · 다른 포트', () => {
  test('원격으로 «안» 센다 — 따로 센다', () => {
    const t = tallyRuntime([
      { url: `${ORIGIN}/index.html`, resourceType: 'Document' },
      { url: 'http://127.0.0.1/b/ss/applestoreww/1/JS/s666', resourceType: 'Image' },
    ], ORIGIN);
    expect(t.remote).toBe(0);
    expect(t.sameHostOtherPort).toBe(1);
  });
  test('⛔ «진짜» 바깥 호스트는 그대로 원격이다', () => {
    const t = tallyRuntime([{ url: 'https://image.istarbucks.co.kr/a.jpg', resourceType: 'Image' }], ORIGIN);
    expect(t.remote).toBe(1);
    expect(t.sameHostOtherPort).toBe(0);
  });
  test('그 실패는 «결손»이 아니라 「지어낸 경로」로 센다', () => {
    const t = tallyRuntime([
      { url: 'http://127.0.0.1/b/ss/x', resourceType: 'Image', failure: 'net::ERR_CONNECTION_REFUSED' },
    ], ORIGIN);
    expect(t.failedMirrorFile).toBe(0);
    expect(t.failedInventedPath).toBe(1);
    expect(t.failedRemote).toBe(0);
  });
  test('판정이 그것을 «부작용»이라 말한다', () => {
    const v = judgeRuntime(tallyRuntime([
      { url: `${ORIGIN}/index.html`, resourceType: 'Document' },
      { url: 'http://127.0.0.1/b/ss/x', resourceType: 'Image' },
    ], ORIGIN));
    expect(v.kind).toBe('runtime-self-contained');
    expect(v.why).toContain('부작용');
  });
});
