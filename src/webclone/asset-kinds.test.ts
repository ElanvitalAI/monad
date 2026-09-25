import { describe, expect, test } from 'bun:test';
import {
  ASSET_EXTENSIONS, assetExtRegex, isAsset, assetKindOf, assetKindOfMime, mimeVerdict, tallyAssets, formatAssetTally, countAssetRefs,
} from './asset-kinds.js';

describe('🩸 골프 사이트가 드러낸 것 — 받아 놓고 «안 세는» 확장자', () => {
  test('⛔ m4a 를 «센다» — 이것이 안 세어져 BGM 이 목록에서 사라졌다', () => {
    expect(isAsset('bgm.m4a')).toBe(true);
    expect(assetKindOf('bgm.m4a')).toBe('audio');
  });

  test('두 자리가 «달랐던» 확장자를 전부 센다', () => {
    // extract-design-run 에만 있던 것 ⊕ archive-run 에만 있던 것 ⊕ 둘 다 없던 것
    for (const f of ['a.mp4', 'a.webm', 'a.gif', 'a.avif', 'a.ico', 'a.mp3', 'a.svg', 'a.woff2', 'a.m4a', 'a.mov', 'a.wav']) {
      expect(isAsset(f)).toBe(true);
    }
  });

  test('⛔ 정규식을 «만들어» 낸다 — 손으로 적으면 또 갈린다', () => {
    const re = assetExtRegex();
    for (const ext of ASSET_EXTENSIONS) expect(re.test(`x.${ext}`)).toBe(true);
  });

  test('모르는 확장자는 null — 「이미지」로 «몰지» 않는다', () => {
    expect(assetKindOf('a.zzz')).toBeNull();
    expect(assetKindOf('확장자없음')).toBeNull();
  });
});

describe('⛔⭐⭐ 「받은 것」과 「센 것」을 맞대 본다', () => {
  // 📏 골프 사이트 실측 그대로의 미러 목록
  const golf = [
    'assets/index.html', 'assets/media/course-still.jpg', 'assets/media/bgm.m4a',
    'assets/_next/static/css/x.css', 'assets/_next/static/chunks/a.js',
    'assets/_next/static/chunks/b.js', 'assets/_next/static/chunks/c.js',
  ];

  test('자산 둘을 세고, html·css·js 는 «자산이 아니다»', () => {
    const t = tallyAssets(golf);
    expect(t.total).toBe(2);
    expect(t.byKind.image).toBe(1);
    expect(t.byKind.audio).toBe(1);      // ⬅ 옛 자는 여기서 0 이었다
    expect(t.mirroredNotCounted).toEqual([]);
  });

  test('🚨 받았는데 «안 센» 것이 있으면 «먼저» 말한다', () => {
    const t = tallyAssets([...golf, 'assets/x.heic', 'assets/y.zzz']);
    expect(t.mirroredNotCounted).toEqual(['assets/x.heic', 'assets/y.zzz']);
    expect(formatAssetTally(t)).toContain('안 센');
  });

  // ⛔ 판별 검사 ⓑ: 「늘 0 을 내는」 구현으로는 이 줄을 못 지난다.
  test('어긋남이 «없을» 때는 그 줄을 «안 붙인다»(소음 금지)', () => {
    expect(formatAssetTally(tallyAssets(golf))).not.toContain('안 센');
  });

  test('하나도 못 받았으면 「0개」가 아니라 «못 받았다»고 말한다', () => {
    expect(formatAssetTally(tallyAssets(['assets/index.html']))).toContain('못 받았다');
  });

  test('종류별로 «이름을 대고» 낸다 — 「몇 개」로 끝내지 않는다', () => {
    const s = formatAssetTally(tallyAssets(['a.png', 'b.jpg', 'c.m4a', 'd.mp4', 'e.woff2']));
    expect(s).toContain('image 2');
    expect(s).toContain('audio 1');
    expect(s).toContain('video 1');
    expect(s).toContain('font 1');
  });
});

/**
 * ⛔⭐ MIME 축 — 「확장자가 없는 자산」과 「이름이 거짓말하는 자산」.
 * 문면은 2026-09-11 실물(fbcdn `rsrc.php` · starbucks `.do`)에서 떠 왔다.
 */
describe('MIME 축', () => {
  test('확장자가 «없어도» MIME 이면 센다 — fbcdn rsrc.php', () => {
    const t = tallyAssets([
      { path: '_r/static.cdninstagram.com/rsrc.php/v4/yQ/r/abc123', mime: 'image/png' },
      { path: '_r/static.cdninstagram.com/rsrc.php/v4/yZ/r/def456', mime: 'font/woff2' },
    ]);
    expect(t.total).toBe(2);
    expect(t.byKind.image).toBe(1);
    expect(t.byKind.font).toBe(1);
    expect(t.byMimeOnly).toBe(2);
    expect(t.mirroredNotCounted).toEqual([]);
  });

  test('⛔ 이름이 자산이라 해도 서버가 아니라 하면 «세지 않고 어긋남으로» 낸다', () => {
    const t = tallyAssets([{ path: '_r/x.example.com/missing.png', mime: 'text/html; charset=utf-8' }]);
    expect(t.total).toBe(0);
    expect(t.kindDisagreements.length).toBe(1);
    expect(t.kindDisagreements[0]).toContain('text/html');
    // ⛔ 「안 센 것」으로도 새면 안 된다 — 이유를 «아는» 것이지 놓친 게 아니다.
    expect(t.mirroredNotCounted).toEqual([]);
  });

  test('`.do` 응답은 자산이 아니고 «안 센 것»도 아니다', () => {
    const t = tallyAssets([{ path: '_r/www.starbucks.co.kr/interface/checkLogin.do', mime: 'application/json' }]);
    expect(t.total).toBe(0);
    expect(t.mirroredNotCounted).toEqual([]);
  });

  test('MIME 의 꼬리(charset)를 잘라 본다', () => {
    expect(assetKindOfMime('image/svg+xml; charset=utf-8')).toBe('image');
    expect(assetKindOfMime('AUDIO/MPEG')).toBe('audio');
    expect(assetKindOfMime('application/vnd.ms-fontobject')).toBe('font');
  });

  test('⛔ 모르는 MIME 을 «이미지로 몰지» 않는다', () => {
    expect(assetKindOfMime('application/octet-stream')).toBeNull();
    expect(assetKindOfMime('')).toBeNull();
    expect(assetKindOfMime(null)).toBeNull();
    expect(assetKindOfMime(undefined)).toBeNull();
  });

  test('이름만 주는 옛 호출은 «그대로» 돈다', () => {
    const t = tallyAssets(['a/b/bgm.m4a', 'a/b/hero.png', 'a/b/index.html']);
    expect(t.total).toBe(2);
    expect(t.byMimeOnly).toBe(0);
    expect(t.kindDisagreements).toEqual([]);
  });

  test('이름과 서버가 «둘 다» 자산인데 종류가 다르면 세되 어긋남을 남긴다', () => {
    const t = tallyAssets([{ path: 'a/clip.mp4', mime: 'audio/mp4' }]);
    expect(t.total).toBe(1);
    expect(t.byKind.video).toBe(1);
    expect(t.kindDisagreements.length).toBe(1);
  });
});

/** ⛔⭐ 「자산이 아니다」와 「모르겠다」는 다른 값이다. */
describe('관측 ↔ 못 쟀음', () => {
  test('MIME 이 «없고» 확장자도 모르면 그것은 «모르겠다» — 세어 낸다', () => {
    const t = tallyAssets(['_r/cdn.example.com/rsrc.php/v4/yQ/r/abc123']);
    expect(t.mirroredNotCounted.length).toBe(1);
  });
  test('MIME 이 «있고» 자산이 아니면 그것은 «답»이다 — 결손이 아니다', () => {
    const t = tallyAssets([{ path: '_r/cdn.example.com/rsrc.php/v4/yQ/r/abc123', mime: 'text/javascript' }]);
    expect(t.mirroredNotCounted).toEqual([]);
  });
});

/**
 * ⛔⭐ ***「내가 모른다」를 「저쪽이 틀렸다」로 읽지 않는다.***
 * 🩸 2026-09-11: `application/x-font-woff` 가 표에 없다는 이유로 starbucks 폰트가
 *    「이름이 거짓말한다」로 몰려 자산 수가 144 → 143 으로 «줄었다».
 */
describe('MIME 세 갈래 — 자산 · 자산아님 · 모름', () => {
  test('아는 자산 MIME 은 { kind } 를 낸다', () => {
    expect(mimeVerdict('image/webp')).toEqual({ kind: 'image' });
    expect(mimeVerdict('application/x-font-woff')).toEqual({ kind: 'font' });
  });
  test('자산이 «아님을 아는» MIME 은 not-asset 이다', () => {
    expect(mimeVerdict('text/html; charset=utf-8')).toBe('not-asset');
    expect(mimeVerdict('application/json')).toBe('not-asset');
  });
  test('⛔ 모르는 MIME 은 unknown 이다 — not-asset 이 «아니다»', () => {
    expect(mimeVerdict('application/octet-stream')).toBe('unknown');
    expect(mimeVerdict('binary/weird-thing')).toBe('unknown');
    expect(mimeVerdict(null)).toBe('unknown');
  });
  test('모르는 MIME 이면 «이름»을 믿고 세되 모른다고 적는다', () => {
    const t = tallyAssets([{ path: 'a/NanumBarunGothic.woff', mime: 'binary/octet-stream' }]);
    expect(t.total).toBe(1);
    expect(t.byKind.font).toBe(1);
    expect(t.kindDisagreements).toEqual([]);
    expect(t.unknownMimes.length).toBe(1);
  });
  test('⛔ 그 표를 넓힌 뒤에는 「모른다」도 안 뜬다 — x-font-woff 는 이제 안다', () => {
    const t = tallyAssets([{ path: 'a/NanumBarunGothic.woff', mime: 'application/x-font-woff' }]);
    expect(t.total).toBe(1);
    expect(t.unknownMimes).toEqual([]);
    expect(t.kindDisagreements).toEqual([]);
  });
  test('모르는 MIME ⊕ 모르는 이름이면 그것만이 「못 쟀음」이다', () => {
    const t = tallyAssets([{ path: 'a/rsrc.php/v4/yQ/r/abc', mime: 'application/octet-stream' }]);
    expect(t.mirroredNotCounted.length).toBe(1);
    expect(t.unknownMimes.length).toBe(1);
  });
});

/**
 * ⛔⭐⭐ 「자산이 «없다»」와 「자산을 «못 받았다»」는 다른 값이다.
 * 🩸 2026-09-11: 내가 «직접 지은» 열 사이트가 전부 `⚠️ 자산을 «못 받았다»` 로 찍혔다.
 *    실제로는 순수 CSS 디자인이라 ***자산이 원래 없다***(public 0 · <img> 0 · svg 0).
 *    ⊕ 그 문면은 ***「좋은 것을 나쁘게」*** 말한다 — 멀쩡한 사이트에 경고를 붙였다.
 */
describe('자산 0 — 「없다」 · 「못 받았다」 · 「못 가른다」', () => {
  const empty = tallyAssets([]);
  test('⛔ 근거를 «안 주면» 「못 가른다」고 말한다', () => {
    expect(formatAssetTally(empty)).toContain('못 가른다');
  });
  test('문서가 자산을 «안 부르면» 그것은 «없는» 것이다 — 결손이 아니다', () => {
    const s = formatAssetTally(empty, { documentAssetRefs: 0 });
    expect(s).toContain('자산 «없다»');
    expect(s).not.toContain('못 받았다');
  });
  test('🚨 부르는데 0 이면 «못 받은» 것이고 «몇 곳»인지 말한다', () => {
    const s = formatAssetTally(empty, { documentAssetRefs: 7 });
    expect(s).toContain('못 받았다');
    expect(s).toContain('7곳');
  });
  test('자산이 «있으면» 근거와 무관하게 수를 낸다', () => {
    const t = tallyAssets(['a/x.png', 'a/y.woff2']);
    expect(formatAssetTally(t, { documentAssetRefs: 0 })).toContain('2개');
  });
});

describe('countAssetRefs — 문서가 자산을 «부르나»', () => {
  test('자산 태그를 센다', () => {
    expect(countAssetRefs('<img src="a"><video><source src="b"></video>')).toBe(3);
  });
  test('`srcset` · `background-image` · favicon 도 «부르는» 것이다', () => {
    expect(countAssetRefs('<img srcset="a 1x">')).toBe(2);          // img ⊕ srcset
    expect(countAssetRefs('<div style="background-image:url(a)">')).toBe(1);
    expect(countAssetRefs('<link rel="icon" href="a.ico">')).toBe(1);
  });
  test('⭐ 순수 CSS 디자인은 «0» 이다 — 내 열 사이트가 그렇다', () => {
    expect(countAssetRefs('<main><h1>빌려쓰는 동네</h1><p>공구를 빌립니다</p></main>')).toBe(0);
  });
  test('⛔ `<link rel="stylesheet">` 는 «자산이 아니다» — 재현의 근거다', () => {
    expect(countAssetRefs('<link rel="stylesheet" href="a.css">')).toBe(0);
  });
});
