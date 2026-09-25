// ⛔⭐ 대표 2026-08-21: *"결과물이 그냥 링크로만 나옵니다."*
//   📏 상대는 주소를 «구조로» 준다 — 실물 job_status 응답에서 그대로 가져온 모양을 쓴다.

import { describe, expect, test } from 'bun:test';
import { mcpResultImages } from './chat-runtime';

/** 실물 `higgsfield.job_status` 응답의 모양(2026-08-21 실측). */
const LIVE = {
  content: [
    { type: 'text', text: 'Job 6194b3e4 — completed\nhttps://cdn.example/hf_1.png' },
    { name: 'hf_1.png', uri: 'https://cdn.example/hf_1.png', description: 'A single maple leaf' },
  ],
};

describe('결과에서 «보여 줄 이미지»를 뽑는다', () => {
  test('구조에 실린 uri 를 그린다', () => {
    expect(mcpResultImages(LIVE)).toEqual([
      { src: 'https://cdn.example/hf_1.png', mediaType: 'image/png', alt: 'A single maple leaf' },
    ]);
  });

  test('⛔ 같은 주소를 두 번 그리지 않는다 — 요약과 구조에 «둘 다» 실려 온다', () => {
    const dup = { content: [...LIVE.content, { uri: 'https://cdn.example/hf_1.png' }] };
    expect(mcpResultImages(dup)).toHaveLength(1);
  });

  test('⛔ 이미지가 «아닌» 주소는 안 그린다 — 남의 페이지를 <img> 로 걸면 안 된다', () => {
    expect(mcpResultImages({ content: [{ uri: 'https://example.com/page' }] })).toEqual([]);
    expect(mcpResultImages({ content: [{ uri: 'javascript:alert(1)' }] })).toEqual([]);
  });

  test('확장자로 매체형을 가른다', () => {
    const got = mcpResultImages({ a: { uri: 'https://c/x.webp' }, b: { uri: 'https://c/y.JPG' } });
    expect(got.map((g) => g.mediaType).sort()).toEqual(['image/jpeg', 'image/webp']);
  });

  test('쿼리가 붙어도 인식한다', () => {
    expect(mcpResultImages({ uri: 'https://c/x.png?sig=abc' })).toHaveLength(1);
  });

  test('결과가 이미지를 안 담으면 빈 배열 — 빈 자리를 만들지 않는다', () => {
    expect(mcpResultImages({ output: 'ok', structured: { a: 1 } })).toEqual([]);
    expect(mcpResultImages(undefined)).toEqual([]);
    expect(mcpResultImages('text')).toEqual([]);
  });

  test('너무 깊이 파고들지 않는다 — 큰 결과에서 시간을 쓰지 않는다', () => {
    let deep: unknown = { uri: 'https://c/deep.png' };
    for (let i = 0; i < 8; i += 1) deep = { nest: deep };
    expect(mcpResultImages(deep)).toEqual([]);
  });
});

/** ⛔⭐ 프록시가 상대의 `content[]` 를 «텍스트로 접는다» — 실측(2026-08-21):
 *  `higgsfield.job_status` → `{output: "Job … — completed\nhttps://….png", structured: {…}}`
 *  ⇒ `uri` 칸이 «없다». 글 안의 주소를 못 보면 이미지가 영영 안 뜬다. */
describe('접혀서 «글»로 온 결과', () => {
  const WRAPPED = {
    output: 'Job 6194b3e4 — completed\nhttps://cdn.example/hf_1.png',
    structured: { status: 'completed' },
  };

  test('글 안의 주소를 찾아 그린다', () => {
    expect(mcpResultImages(WRAPPED).map((i) => i.src)).toEqual(['https://cdn.example/hf_1.png']);
  });

  test('한 글에 여러 장이면 여러 장', () => {
    const two = { output: 'a https://c/1.png b https://c/2.webp' };
    expect(mcpResultImages(two)).toHaveLength(2);
  });

  test('⛔ 구조와 글에 «같은» 주소가 있어도 한 번만', () => {
    const both = { output: 'see https://c/x.png', content: [{ uri: 'https://c/x.png' }] };
    expect(mcpResultImages(both)).toHaveLength(1);
  });

  test('⛔ 글 안의 «이미지 아닌» 주소는 안 그린다', () => {
    expect(mcpResultImages({ output: 'docs at https://example.com/guide' })).toEqual([]);
  });

  test('괄호·따옴표로 끝나도 주소만 자른다', () => {
    expect(mcpResultImages({ output: '(https://c/x.png)' })[0]?.src).toBe('https://c/x.png');
  });
});
