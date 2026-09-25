// ── 보관한 자산이 «온전한가» — ⛔ 「셌다」와 「쓸 수 있다」는 다른 값 (2026-09-08) ──
//
// 🩸 계기: 보관 산출이 `원문 파일 11개` 라고 말한다. 그것은 «수»이지 «온전성»이 아니다.
//    실측으로는 세 보관본 다 0% 였지만, ⛔ ***도구가 안 보면 다음 사이트에서 조용히 깨진다.***
//    이 창이 종일 밟은 그 형태(수는 그럴듯한데 내용이 다르다)의 자산판이다.
//
// ⛔ 이 파일은 파일을 «읽지 않는다» — 호출자가 머리 바이트를 주고, 여기서는 «판정»만 한다.
//    (그래야 시험이 디스크 없이 문면을 물 수 있다)

/** 왜 깨졌다고 보나. ⛔ 「깨짐」 하나로 접지 않는다 — 원인마다 대처가 다르다. */
export type AssetDefect =
  /** 크기 0 — 받다 만 것이다. */
  | 'empty'
  /** `.js`/`.css` 자리에 HTML 이 들어 있다 — 오류 페이지를 받아 저장한 것이다. */
  | 'html-in-code-slot'
  /** 확장자가 말하는 형식과 «머리 바이트»가 안 맞는다.
   *  🩸 2026-09-08: 처음엔 `not-an-image` 였다 — png/jpeg 만 봤기 때문이다.
   *     폰트·미디어까지 넓히면서 «이미지»라는 이름이 거짓이 되어 바꿨다.
   *     ⛔ 두 이름을 나란히 두지 «않는다» — 같은 사실에 어휘가 둘이면 세는 자가 갈린다. */
  | 'wrong-magic';

export interface AssetCheck {
  readonly path: string;
  readonly bytes: number;
  /** 앞 512바이트. 없으면 빈 배열 — ⛔ 「못 읽었다」를 「비었다」로 읽지 않으려면 bytes 를 같이 본다. */
  readonly head: Uint8Array;
}

export interface AssetVerdict {
  readonly path: string;
  readonly defect: AssetDefect;
  /** `wrong-magic` 일 때 «무엇이었어야 하나». ⛔ 그것 없이 「틀렸다」만 내면 고칠 수가 없다. */
  readonly expected?: string;
}

const CODE_SLOT = /\.(js|mjs|css)$/i;

/** 확장자 → 「머리 바이트가 이래야 한다」. ⛔ 목록에 «없는» 확장자는 검사하지 않는다 —
 *  모르는 형식을 「틀렸다」고 하면 그것이 거짓양성이다. */
const MAGIC: ReadonlyArray<{ ext: RegExp; ok: (h: Uint8Array, text: string) => boolean; label: string }> = [
  { ext: /\.png$/i, label: 'PNG', ok: (h) => h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47 },
  { ext: /\.jpe?g$/i, label: 'JPEG', ok: (h) => h[0] === 0xff && h[1] === 0xd8 },
  { ext: /\.gif$/i, label: 'GIF', ok: (h, t) => t.startsWith('GIF8') },
  // RIFF....WEBP — 4~8바이트는 «길이»라 건너뛴다
  { ext: /\.webp$/i, label: 'WebP', ok: (h, t) => t.startsWith('RIFF') && t.slice(8, 12) === 'WEBP' },
  { ext: /\.ico$/i, label: 'ICO', ok: (h) => h[0] === 0x00 && h[1] === 0x00 && h[2] === 0x01 && h[3] === 0x00 },
  // ⛔ SVG 는 주석·DOCTYPE·BOM 으로 시작할 수 있다 — «시작»이 아니라 «있나»로 본다
  { ext: /\.svg$/i, label: 'SVG', ok: (h, t) => /<svg[\s>]/i.test(t) },
  { ext: /\.woff2$/i, label: 'WOFF2', ok: (h, t) => t.startsWith('wOF2') },
  { ext: /\.woff$/i, label: 'WOFF', ok: (h, t) => t.startsWith('wOFF') },
  // TrueType 0x00010000 · OpenType 'OTTO' · 옛 맥 'true'
  { ext: /\.(ttf|otf)$/i, label: 'TTF/OTF', ok: (h, t) => (h[0] === 0x00 && h[1] === 0x01 && h[2] === 0x00 && h[3] === 0x00) || t.startsWith('OTTO') || t.startsWith('true') },
  // mp4 는 «4바이트 뒤»에 ftyp 가 온다 — 앞 넷은 박스 길이다
  { ext: /\.mp4$/i, label: 'MP4', ok: (h, t) => t.slice(4, 8) === 'ftyp' },
  { ext: /\.webm$/i, label: 'WebM', ok: (h) => h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3 },
  { ext: /\.mp3$/i, label: 'MP3', ok: (h, t) => t.startsWith('ID3') || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0) },
];

const inspectPath = (path: string) => path.split(/[?#]/, 1)[0]!;

function isInspectedPath(path: string): boolean {
  return CODE_SLOT.test(path) || MAGIC.some((m) => m.ext.test(path));
}

/** 파일 하나를 본다. 성한 것은 null. */
export function inspectAsset(a: AssetCheck): AssetVerdict | null {
  if (a.bytes === 0) return { path: a.path, defect: 'empty' };
  const path = inspectPath(a.path);
  const text = new TextDecoder('utf8', { fatal: false }).decode(a.head);
  if (CODE_SLOT.test(path) && /^\s*(<!doctype html|<html)/i.test(text)) {
    return { path: a.path, defect: 'html-in-code-slot' };
  }
  const rule = MAGIC.find((m) => m.ext.test(path));
  // ⛔ 목록에 없으면 «검사 안 함» — 모르는 형식을 틀렸다고 하지 않는다.
  if (rule && !rule.ok(a.head, text)) return { path: a.path, defect: 'wrong-magic', expected: rule.label };
  return null;
}

export interface IntegrityReport {
  readonly checked: number;
  readonly broken: readonly AssetVerdict[];
  /** ⛔ 분모가 0 이면 비율은 «없다» — 0% 로 «몰지» 않는다. */
  readonly brokenRatio: number | null;
}

export function checkAssets(assets: readonly AssetCheck[]): IntegrityReport {
  const inspected = assets.filter((asset) => asset.bytes === 0 || isInspectedPath(inspectPath(asset.path)));
  const broken = inspected.map(inspectAsset).filter((v): v is AssetVerdict => v !== null);
  return {
    checked: inspected.length,
    broken,
    brokenRatio: inspected.length === 0 ? null : broken.length / inspected.length,
  };
}

/** 사람이 읽는 한 줄. ⛔ 0건과 「안 봤다」를 다른 말로 낸다. */
export function formatIntegrity(r: IntegrityReport): string {
  if (r.checked === 0) return '자산 온전성 ⚪ 볼 파일이 «없었다» (⛔ 「성하다」가 아니다)';
  if (r.broken.length === 0) return `자산 온전성 ✅ ${r.checked}개 전부 성하다 (0바이트·코드자리 HTML·매직 바이트 12종)`;
  const first = r.broken.slice(0, 3).map((b) => `${b.path}(${b.defect}${b.expected ? `: ${b.expected} 이어야` : ''})`).join(' · ');
  return `자산 온전성 🔴 ${r.checked}개 중 ***${r.broken.length}개 깨짐*** — ${first}`
    + (r.broken.length > 3 ? ` 외 ${r.broken.length - 3}개` : '');
}
