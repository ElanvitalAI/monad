/**
 * asset-kinds.ts — ⛔⭐⭐ ***「무엇을 «자산»으로 세나」를 «한 자리»에서 낸다.***
 *
 * 🩸 왜 생겼나(2026-09-11 🅕 · 자산 클론 검증):
 *    내가 정답을 «아는» 사이트(내 골프 사이트)에 자를 대 봤다.
 *    미러는 파일을 **10개** 받았는데 자는 ***「에셋 1개」***라고 말했다.
 *    🔑 `bgm.m4a` 를 ***받아 놓고 «세지 않았다»*** — 목록의 확장자에 `m4a` 가 «없었다».
 *    ⇒ ***「받았다」와 「셌다」가 어긋나면, 클론은 조용히 «반쪽»이 된다.***
 *
 * 🩸 그리고 같은 결함이 «두 자리»에 있었고 서로 «달랐다»:
 *      extract-design-run  png jpe?g gif webp avif svg ico woff2? ttf otf mp3 mp4 webm
 *      archive-run         png jpe?g svg woff2? mp3            ⬅ 더 좁다(mp4·webm·gif·avif·ico 도 없다)
 *    ⇒ 같은 페이지를 두 도구가 «다른 수»로 셌다. 그래서 목록을 «한 자리»로 모은다.
 *
 * ⛔ 목록을 늘릴 때 규율: ***「내가 정답을 아는 페이지」로 다시 재라.*** 늘리기만 하면 또 어긋난다.
 */

/** ⛔ 종류별로 «이름을 대고» 둔다 — 한 줄 정규식이면 「무엇이 빠졌나」를 못 본다. */
export const ASSET_KINDS = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp'],
  font: ['woff', 'woff2', 'ttf', 'otf', 'eot'],
  /** 🩸 `m4a` 가 여기 «없어서» 골프 사이트의 BGM 이 안 세어졌다. */
  audio: ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'wav', 'flac', 'opus'],
  video: ['mp4', 'm4v', 'webm', 'mov', 'ogv'],
} as const;

export type AssetKind = keyof typeof ASSET_KINDS;

/** 전 종류의 확장자. ⛔ 값으로 내보낸다 — 세는 쪽이 「무엇을 세는지」 말할 수 있게. */
export const ASSET_EXTENSIONS: readonly string[] =
  Object.values(ASSET_KINDS).flatMap((v) => [...v]);

/** ⛔ 정규식을 «만들어» 낸다 — 손으로 적으면 두 자리가 또 갈린다. */
export function assetExtRegex(): RegExp {
  return new RegExp(`\\.(${ASSET_EXTENSIONS.join('|')})$`, 'i');
}

/** 이 파일이 «자산»인가. */
export function isAsset(name: string): boolean {
  return assetExtRegex().test(name);
}

/** 어떤 «종류»인가. ⛔ 모르면 `null` — 「이미지」로 몰지 않는다. */
export function assetKindOf(name: string): AssetKind | null {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  if (m === null) return null;
  const ext = m[1]!.toLowerCase();
  for (const [kind, list] of Object.entries(ASSET_KINDS)) {
    if ((list as readonly string[]).includes(ext)) return kind as AssetKind;
  }
  return null;
}

/**
 * ⛔⭐ ***이름에 확장자가 «없는» 자산이 있다.***
 *
 * 🩸 실측(2026-09-11 · instagram/facebook): fbcdn 은 `rsrc.php/v4/y…/xyz.js` 처럼 «해시 이름»을 쓰고,
 *    이미지·폰트도 확장자 없이 나온다. 확장자만 보는 자는 그것을 ***전부 「안 센 것」으로 흘린다***.
 * 🔑 그런데 미러는 «답을 이미 알고 있다» — `Network.responseReceived` 가 `mimeType` 을 준다.
 *    ⇒ ***자가 «모르는» 게 아니라 «안 물어본» 것이었다.***
 *
 * ⛔ 접두로 «만들어» 본다 — `image/*`·`audio/*`·`video/*`·`font/*`.
 *    옛 이름들(`application/font-woff` 등)만 예외 표로 둔다.
 */
export const ASSET_MIME_PREFIX: { readonly [K in AssetKind]: string } = {
  image: 'image/', font: 'font/', audio: 'audio/', video: 'video/',
};

/** ⛔ 접두로 안 잡히는 옛 이름들. 늘릴 때는 «실물 응답»을 근거로. */
export const ASSET_MIME_EXTRA: readonly (readonly [string, AssetKind])[] = [
  ['application/font-woff', 'font'],
  ['application/x-font-woff', 'font'],
  ['application/font-woff2', 'font'],
  ['application/x-font-woff2', 'font'],
  ['application/x-font-ttf', 'font'],
  ['application/x-font-otf', 'font'],
  ['application/vnd.ms-fontobject', 'font'],
  ['application/ogg', 'audio'],
  ['application/mp4', 'video'],
];

/**
 * ⛔⭐⭐ ***자산이 «아님을 안다»는 MIME 들.***
 *
 * 🩸 왜 이 표가 «따로» 필요한가(2026-09-11 실측): 처음엔 「MIME 이 자산 표에 없다」를 곧
 *    「자산이 아니다」로 읽었다. 그러자 starbucks 의 `NanumBarunGothic.woff` 가
 *    ***`application/x-font-woff`(내 표에 없던 이름)라는 이유로 「이름이 거짓말한다」로 몰려***
 *    자산 수가 144 → 143 으로 «줄었다».
 * 🔑 ⇒ ***「내가 모른다」를 「저쪽이 틀렸다」로 읽으면 안 된다.*** 셋을 가른다:
 *      ⓐ 자산이다 ⓑ 자산이 아님을 «안다» ⓒ ***모른다***.
 *    ⓒ 일 때는 «이름을 믿고» 세되 «모른다»고 적어 둔다 — 그것이 표를 늘릴 근거가 된다.
 */
export const NON_ASSET_MIME: readonly string[] = [
  'text/', 'application/json', 'application/javascript', 'application/x-javascript',
  'application/xml', 'application/xhtml+xml', 'application/manifest+json',
  'application/ld+json', 'application/x-www-form-urlencoded',
];

export type MimeVerdict = { readonly kind: AssetKind } | 'not-asset' | 'unknown';

/** ⛔ 셋을 «가른다» — 「자산이 아니다」와 「모른다」는 다른 값이다. */
export function mimeVerdict(mime: string | null | undefined): MimeVerdict {
  if (typeof mime !== 'string' || mime.trim().length === 0) return 'unknown';
  const bare = mime.split(';')[0]!.trim().toLowerCase();
  const kind = assetKindOfMime(bare);
  if (kind !== null) return { kind };
  if (NON_ASSET_MIME.some((n) => bare.startsWith(n))) return 'not-asset';
  return 'unknown';
}

/** MIME 으로 종류를 낸다. ⛔ 모르면 `null` — 「이미지」로 몰지 않는다. */
export function assetKindOfMime(mime: string | null | undefined): AssetKind | null {
  if (typeof mime !== 'string' || mime.length === 0) return null;
  // ⛔ `image/png; charset=…` 같은 꼬리를 «잘라» 본다.
  const bare = mime.split(';')[0]!.trim().toLowerCase();
  for (const [k, prefix] of Object.entries(ASSET_MIME_PREFIX) as Array<[AssetKind, string]>) {
    if (bare.startsWith(prefix)) return k;
  }
  for (const [name, kind] of ASSET_MIME_EXTRA) if (bare === name) return kind;
  return null;
}

/**
 * ⛔⭐⭐⭐ ***확장자가 «없으면» 브라우저가 그 파일을 «다르게» 읽는다.***
 *
 * 🩸 실측(2026-09-11 · about.instagram): 미러가 ✅ self-contained 이고 stylesheet 4개가
 *    전부 파일로 있는데도 화면이 ***Times 세리프 · h1 16px*** 였다.
 *    네트워크로 물으니 답이 나왔다:
 *      `Stylesheet 200 mime=text/plain  …_50ewOfgQe914i-0wsm13o`   ← 확장자가 «없다»
 *      `Stylesheet 200 mime=text/css    …fHcFuvqsAK-.css`
 *    ⛔ ***`text/plain` 인 stylesheet 를 Chrome 은 적용하지 «않는다»***(strict MIME checking).
 *    그리고 그것이 하필 Meta 의 «메인» 시트였다. ⊕ Font 응답은 ***0건***이었다 —
 *    `@font-face` 가 든 CSS 가 안 먹었으니 폰트 요청이 «나가지도» 않았다.
 * 🔑 ⇒ ***파일 이름은 「구분용」이 아니라 「계약」이다.*** `file://` 에서 MIME 은 확장자가 «정한다».
 */
export const MIME_TO_EXTENSION: { readonly [mime: string]: string } = {
  'text/css': 'css',
  'text/javascript': 'js',
  'application/javascript': 'js',
  'application/x-javascript': 'js',
  'text/html': 'html',
  'application/json': 'json',
  'application/manifest+json': 'webmanifest',
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
  'font/woff': 'woff', 'font/woff2': 'woff2', 'font/ttf': 'ttf', 'font/otf': 'otf',
  'application/font-woff': 'woff', 'application/x-font-woff': 'woff',
  'application/font-woff2': 'woff2', 'application/x-font-woff2': 'woff2',
  'application/x-font-ttf': 'ttf', 'application/x-font-otf': 'otf',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};

/** ⛔ 모르면 `null` — 아무 확장자나 붙이지 않는다(붙이면 «또 다른» 거짓말이 된다). */
export function extensionForMime(mime: string | null | undefined): string | null {
  if (typeof mime !== 'string' || mime.trim().length === 0) return null;
  const bare = mime.split(';')[0]!.trim().toLowerCase();
  return MIME_TO_EXTENSION[bare] ?? null;
}

/** 이름이 «이미» 이 MIME 에 맞는 확장자를 갖고 있나. */
export function extensionMatchesMime(name: string, mime: string | null | undefined): boolean {
  const want = extensionForMime(mime);
  if (want === null) return true;               // 모르면 «맞다고» 본다 — 건드리지 않는다
  const m = /\.([a-z0-9]+)$/i.exec(name);
  if (m === null) return false;
  const have = m[1]!.toLowerCase();
  if (have === want) return true;
  // jpg/jpeg · htm/html 같은 동의어는 «같다»고 본다.
  const same: Record<string, string> = { jpeg: 'jpg', htm: 'html', mjs: 'js' };
  return (same[have] ?? have) === want;
}

/** ⛔ 미러가 «받은 한 개» — 이름과, 서버가 «뭐라고 했는지». */
export interface MirroredFile {
  readonly path: string;
  readonly mime?: string | null;
}

export interface AssetTally {
  readonly total: number;
  readonly byKind: { readonly [K in AssetKind]: number };
  /** ⛔ 미러가 «받았는데» 자산으로 안 센 것 — 「받았다」와 「셌다」의 차. */
  readonly mirroredNotCounted: readonly string[];
  /** 확장자로는 «못 봤고» MIME 으로만 잡은 것 — 이 수가 크면 이름 기반 자가 반쪽이었다는 뜻이다. */
  readonly byMimeOnly: number;
  /**
   * ⛔⭐ ***이름과 MIME 이 «다르게» 말한 것.*** 조용히 한쪽을 고르지 않는다.
   * 예: `.png` 인데 `text/html` ⇒ 그건 이미지가 아니라 «오류 페이지»다.
   */
  readonly kindDisagreements: readonly string[];
  /**
   * ⛔ 서버가 «내가 모르는» MIME 을 말한 것. 이름을 믿고 세었다.
   * 🔑 이 목록이 비지 않으면 `ASSET_MIME_EXTRA`·`NON_ASSET_MIME` 을 늘릴 «근거»다.
   */
  readonly unknownMimes: readonly string[];
}

/**
 * ⛔⭐⭐ ***「받은 것」과 「센 것」을 «맞대 본다».***
 * 🔑 이 함수가 이 파일의 존재 이유다 — 골프 사이트에서 그 둘이 10 ↔ 1 로 어긋나 있었다.
 * ⚠️ `index.html`·`.css`·`.js` 는 «자산이 아니다»(재현의 근거이지 저작물 미러가 아니다) —
 *    그래서 차이 목록에서 «뺀다». 그 판단을 여기 적어 둔다.
 */
export const NOT_ASSET_EXT: readonly string[] = ['html', 'htm', 'css', 'js', 'mjs', 'map', 'json', 'txt', 'xml'];

/**
 * ⛔ 이름만 주면 옛 동작 그대로(확장자 축), `{ path, mime }` 를 주면 MIME 축이 «같이» 돈다.
 *    ⇒ 호출부를 한 번에 안 고쳐도 «틀리지 않는다».
 */
export function tallyAssets(mirroredFiles: readonly (string | MirroredFile)[]): AssetTally {
  const byKind = { image: 0, font: 0, audio: 0, video: 0 };
  const notCounted: string[] = [];
  const disagreements: string[] = [];
  const unknownMimes: string[] = [];
  let byMimeOnly = 0;
  for (const raw of mirroredFiles) {
    const f = typeof raw === 'string' ? raw : raw.path;
    const mime = typeof raw === 'string' ? null : (raw.mime ?? null);
    const byExt = assetKindOf(f);
    const v = mimeVerdict(mime);

    if (v === 'unknown') {
      // ⛔ ⓒ 모른다 — «이름»을 믿는다. 다만 모른다는 사실을 «적어» 둔다.
      if (mime !== null && mime.trim().length > 0) unknownMimes.push(`${mime.split(';')[0]!.trim()} (${f})`);
      if (byExt !== null) { byKind[byExt] += 1; continue; }
      const m0 = /\.([a-z0-9]+)$/i.exec(f);
      const ext0 = m0 === null ? '' : m0[1]!.toLowerCase();
      if (!NOT_ASSET_EXT.includes(ext0)) notCounted.push(f);
      continue;
    }

    if (v === 'not-asset') {
      // ⛔ ⓑ 자산이 «아님을 안다» — 결손이 아니다.
      //    🩸 이것이 없으면 starbucks 의 `checkLogin.do`(application/json)가 「안 센 것」으로 새어
      //       「미러가 열을 흘렸다」는 거짓 경보가 된다.
      if (byExt !== null) disagreements.push(`${f} (이름=${byExt} ↔ 서버=${mime!.split(';')[0]!.trim()})`);
      continue;
    }

    // ⓐ 자산이다.
    if (byExt !== null && byExt !== v.kind) disagreements.push(`${f} (이름=${byExt} ↔ 서버=${v.kind})`);
    const kind = byExt ?? v.kind;
    byKind[kind] += 1;
    if (byExt === null) byMimeOnly += 1;
  }
  return {
    total: byKind.image + byKind.font + byKind.audio + byKind.video,
    byKind,
    mirroredNotCounted: notCounted,
    byMimeOnly,
    kindDisagreements: disagreements,
    unknownMimes,
  };
}

/** ⛔ 「몇 개」로 끝내지 않는다 — 종류별로 말하고, 어긋남이 있으면 «먼저» 말한다. */
/**
 * ⛔⭐⭐⭐ ***「자산이 «없다»」와 「자산을 «못 받았다»」는 다른 값이다.***
 *
 * 🩸 실측(2026-09-11 🅕): 내가 «직접 지은» 열 사이트에 자를 대니 전부
 *    ***`⚠️ 자산을 «못 받았다»`*** 가 떴다. 그런데 세어 보니
 *    `public` 0개 · `<img>` 0개 · `background-image` 0곳 · `<svg>` 0개 —
 *    ***순수 CSS 디자인이라 자산이 «원래» 없다.***
 * 🔑 오늘 내내 고친 ⛔「0과 못 쟀음을 가른다」가 ***자산 문면에 «그대로» 남아 있었다.***
 *    ⊕ 그리고 그 문면은 ***「좋은 것을 나쁘게」*** 말한다 — 멀쩡한 사이트에 경고를 붙였다.
 *
 * ⇒ 가르는 근거는 ***「문서가 자산을 «부르나»」***다. 부르는데 0 이면 결손,
 *    안 부르는데 0 이면 «그게 맞다». ⛔ 근거를 «안 주면» 「못 가른다」고 말한다.
 */
export function countAssetRefs(html: string): number {
  let n = 0;
  for (const m of html.matchAll(/<(img|video|audio|source|picture|embed|object)\b/gi)) { void m; n += 1; }
  for (const m of html.matchAll(/\bsrcset\s*=/gi)) { void m; n += 1; }
  for (const m of html.matchAll(/background-image\s*:/gi)) { void m; n += 1; }
  for (const m of html.matchAll(/<link\b[^>]*rel\s*=\s*["']?(?:icon|apple-touch-icon)/gi)) { void m; n += 1; }
  return n;
}

export interface AssetTallyContext {
  /** 문서가 자산을 «몇 곳»에서 부르나. ⛔ 안 주면 「못 가른다」고 말한다. */
  readonly documentAssetRefs?: number;
}

export function formatAssetTally(t: AssetTally, ctx: AssetTallyContext = {}): string {
  const parts = (Object.entries(t.byKind) as Array<[AssetKind, number]>)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`);
  // ⛔ 0 일 때 «세 갈래»로 말한다 — 「없다」 · 「못 받았다」 · 「못 가른다」.
  let head: string;
  if (t.total > 0) {
    head = `${t.total}개 (${parts.join(' · ')})`;
  } else if (ctx.documentAssetRefs === undefined) {
    head = '⚪ 자산 0 — 「없다」인지 「못 받았다」인지 «못 가른다»(문서 참조 수를 안 줬다)';
  } else if (ctx.documentAssetRefs === 0) {
    head = '자산 «없다» — 문서가 자산을 «안 부른다»(순수 CSS 디자인 따위 · 결손이 아니다)';
  } else {
    head = `🚨 자산을 «못 받았다» — 문서는 ${ctx.documentAssetRefs}곳에서 «부른다»`;
  }
  if (t.byMimeOnly > 0) head += ` · 그중 ${t.byMimeOnly}개는 확장자가 «없어» MIME 으로 잡았다`;
  if (t.kindDisagreements.length > 0) {
    head += `  ⚠️ 이름과 서버가 «다르게» 말한 것 ${t.kindDisagreements.length}개: ${t.kindDisagreements.slice(0, 3).join(', ')}`;
  }
  if (t.unknownMimes.length > 0) {
    head += `  ⚪ 서버가 «모르는» MIME 을 말한 것 ${t.unknownMimes.length}개(이름으로 셌다): ${t.unknownMimes.slice(0, 2).join(', ')}`;
  }
  if (t.mirroredNotCounted.length === 0) return head;
  return `${head}  🚨 받았는데 «안 센» 것 ${t.mirroredNotCounted.length}개: ${t.mirroredNotCounted.slice(0, 4).join(', ')}`;
}
