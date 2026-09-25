// ── WebClone 자산 스토어 — S3 공개 버킷 ⊕ «올리면 안 되는 것»의 갈림 (2026-09-08) ──
//
// ⛔⭐⭐ 이 파일의 본체는 업로드가 아니라 ***「무엇을 올리면 안 되나」의 판정***이다.
//    웹 클론은 남의 사이트를 읽는다. 거기서 나온 사진·로고·서체를 «공개 버킷»에 올리면
//    그것은 재현이 아니라 ***재배포***다(저작권·상표). 그래서 이 스토어는
//    ***기본이 「안 올린다」***이고, 올리려면 «파생물임»이 증명돼야 한다.
//
// 갈림 (`classifyAsset`):
//   derived   내가 만든 것 — DESIGN.md · tokens.json · 템플릿 · 스펙   ⇒ ***public***
//   captured  원본에서 받은 것 — 사진 · 로고 · 오디오 · 서체 파일       ⇒ ***reference***(로컬만)
//
// ⚠️ `reference` 는 「지운다」가 아니다. 로컬에 남고 인덱스에도 남는다 —
//    ***재현에 필요한 근거***이기 때문이다. 다만 «공개 URL 을 얻지 못한다».
//
// 원칙:
//   • ⛔ 자격이 없으면 «조용히 로컬로 떨어지지» 않는다. `blockedOn` 을 값으로 낸다
//     (「올렸다」와 「못 올렸다」가 한 값이 되면 다음 창이 공개된 줄 안다).
//   • ⭐ 키는 결정론적이다 — 같은 slug·ref 는 같은 키. 재실행이 새 객체를 안 만든다.
//   • Bun 내장 `Bun.s3` 를 쓴다 — 새 의존성 0(실측 2026-09-08: bun 1.3.12).

import type { AssetVisibility } from './webclone-db.js';

export interface StoreConfig {
  readonly bucket: string;
  readonly region: string;
  /** S3 키 접두. 기본 `monad/webclone` — 이 버킷의 기존 `monad/` 관례를 따른다. */
  readonly prefix: string;
}

export const DEFAULT_STORE: StoreConfig = {
  bucket: 'elanvital-public',
  region: 'ap-northeast-2',
  prefix: 'monad/webclone',
};

/**
 * ⛔⭐⭐ **원문 아카이브는 «다른 버킷»이다.**
 *
 * 🩸 기전(실측 2026-09-08): `elanvital-public` 의 버킷 정책이
 *    `{"Sid":"PublicReadGetObject","Principal":"*","Action":"s3:GetObject","Resource":".../*"}` 다.
 *    ⇒ ***접두를 어떻게 나눠도 그 버킷에 넣으면 공개된다.*** 「비공개 접두」는 없다.
 * ⇒ 그래서 원문(남의 HTML·이미지·폰트)은 ***버킷을 갈라야*** 한다.
 * ⛔ 기본값을 두지 않는다 — 사람이 «이름을 대야» 올라간다. 잘못 고른 버킷이 공개면 되돌릴 수 없다.
 */
export interface ArchiveConfig {
  readonly bucket: string;
  readonly region: string;
  readonly prefix: string;
}

/**
 * 공개 차단 설정으로 «비공개»를 판정한다.
 *
 * 🩸 실측 2026-09-08: 정책이 «없는» 버킷을 정책만 보고 「모른다」로 거절했다.
 *    그런데 그 버킷은 `BlockPublicAcls·IgnorePublicAcls·BlockPublicPolicy·RestrictPublicBuckets`
 *    가 ***전부 true*** 였다 — ***확실히 비공개***다.
 * ⇒ 🔑 「정책 없음」은 「모름」이 아니다. ***공개 차단이 그 답을 갖고 있다.***
 * ⛔ 넷 중 하나라도 false 면 false 를 낸다(부분 차단은 «비공개 보장»이 아니다).
 * ⛔ 못 읽으면 null — 「비공개」로 가정하지 않는다.
 */
export function isFullyBlockedFromPublic(publicAccessBlockJson: string | null): boolean | null {
  if (publicAccessBlockJson === null) return null;
  try {
    const p = JSON.parse(publicAccessBlockJson) as {
      PublicAccessBlockConfiguration?: Record<string, unknown>;
    };
    const c = p.PublicAccessBlockConfiguration;
    if (!c) return null;
    const keys = ['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'];
    if (!keys.every((k) => typeof c[k] === 'boolean')) return null;
    return keys.every((k) => c[k] === true);
  } catch { return null; }
}

/** 버킷이 «공개 읽기»인지 정책 문면으로 본다. ⛔ 못 읽으면 null — 「비공개」로 «가정하지» 않는다. */
export function isPublicReadPolicy(policyJson: string | null): boolean | null {
  if (policyJson === null) return null;
  try {
    const p = JSON.parse(policyJson) as { Statement?: Array<Record<string, unknown>> };
    const st = p.Statement ?? [];
    return st.some((s) => {
      const principal = s['Principal'];
      const effect = s['Effect'];
      const action = s['Action'];
      const anyone = principal === '*' || (typeof principal === 'object' && principal !== null
        && JSON.stringify(principal).includes('"*"'));
      const gets = typeof action === 'string' ? /GetObject/i.test(action)
        : Array.isArray(action) && action.some((a) => typeof a === 'string' && /GetObject/i.test(a));
      return effect === 'Allow' && anyone && gets;
    });
  } catch { return null; }
}

export type AssetOrigin = 'derived' | 'captured';

/**
 * 자산 하나의 가시성을 정한다. ⛔ 이 함수가 이 모듈의 «관문»이다.
 *
 * ⭐ 기본이 `reference` 인 이유: 분류를 못 하겠으면 «안 올리는» 쪽이 되돌릴 수 있다.
 *    올린 뒤에 「올리면 안 됐다」를 아는 것은 되돌릴 수 없다(이미 공개됐다).
 */
export function classifyAsset(origin: AssetOrigin): { visibility: AssetVisibility; reason: string } {
  if (origin === 'derived') {
    return { visibility: 'public', reason: '이 저장소가 만든 파생물 — 원본 저작물을 담지 않는다' };
  }
  return {
    visibility: 'reference',
    reason: '원본에서 받은 저작물 — 공개 재배포가 아니라 «재현 근거»로 로컬에만 둔다',
  };
}

/** 결정론적 S3 키. 같은 입력은 언제나 같은 키다. */
export function assetKey(cfg: StoreConfig, slug: string, name: string): string {
  const clean = name.replace(/^\/+/, '').replace(/\.\.+/g, '.');
  return `${cfg.prefix}/${slug}/${clean}`;
}

export function publicUrl(cfg: StoreConfig, key: string): string {
  return `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${key}`;
}

export type UploadOutcome =
  | { readonly ok: true; readonly key: string; readonly url: string; readonly bytes: number }
  | { readonly ok: false; readonly blockedOn: 'not-public' | 'no-credentials' | 'upload-failed'; readonly detail: string };

export interface UploadInput {
  readonly cfg: StoreConfig;
  readonly slug: string;
  readonly name: string;
  readonly body: string | Uint8Array;
  readonly origin: AssetOrigin;
  readonly contentType?: string;
  /** 명시 자격. 없으면 환경변수에 기댄다(⛔ `~/.aws` 는 «안» 읽힌다 — readAwsProfile 참조). */
  readonly credentials?: S3Credentials;
}

export interface S3Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

/**
 * ⛔⭐ **`Bun.s3` 는 `~/.aws/credentials` 를 «안 읽는다».** 환경변수나 명시 옵션만 본다.
 *    ⇒ aws CLI 가 잘 도는 기계에서도 업로드가 «자격 없음»으로 떨어진다. 실측 2026-09-08.
 *    그래서 프로필을 «직접» 파싱해 넘긴다 — 환경변수를 쓰지 않는 것이 이 저장소 규율이기도 하다.
 *
 * ⚠️ INI 파서는 최소다: `[profile]` 헤더 ⊕ `key = value`. 주석(`#`·`;`)과 공백만 다룬다.
 *    ⛔ 못 읽으면 null 이다 — 「빈 자격」을 만들지 않는다(그러면 실패가 뒤로 밀린다).
 */
export function readAwsProfile(
  profile: string,
  readFile: (p: string) => string,
  home: string = process.env.HOME ?? '',
): S3Credentials | null {
  let text: string;
  try { text = readFile(`${home}/.aws/credentials`); } catch { return null; }
  const want = profile.replace(/^profile\s+/, '');
  let inSection = false;
  const found: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const header = /^\[(.+?)\]$/.exec(line);
    if (header) { inSection = header[1].replace(/^profile\s+/, '') === want; continue; }
    if (!inSection) continue;
    const kv = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (kv) found[kv[1].toLowerCase()] = kv[2].trim();
  }
  const id = found['aws_access_key_id'];
  const secret = found['aws_secret_access_key'];
  if (!id || !secret) return null;
  return { accessKeyId: id, secretAccessKey: secret, sessionToken: found['aws_session_token'] };
}

/** 자격이 «있나»만 본다. ⛔ 「없다」와 「못 읽었다」를 가르지 않는 판정이라
 *  호출자는 이 값을 「업로드가 성공한다」의 근거로 쓰면 안 된다. */
export function hasS3Credentials(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(
    (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) ||
    env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
    env.AWS_WEB_IDENTITY_TOKEN_FILE,
  );
}

/**
 * 공개 버킷에 «파생물만» 올린다.
 *
 * ⛔ `origin: 'captured'` 는 «업로드하지 않고» `not-public` 으로 거절한다 —
 *    호출자가 실수로 원본을 넘겨도 여기서 멎는다(이중 방어).
 */
export async function uploadAsset(input: UploadInput): Promise<UploadOutcome> {
  const { visibility } = classifyAsset(input.origin);
  if (visibility !== 'public') {
    return { ok: false, blockedOn: 'not-public', detail: '원본 저작물은 공개 버킷에 올리지 않는다' };
  }
  if (!input.credentials && !hasS3Credentials()) {
    return {
      ok: false, blockedOn: 'no-credentials',
      detail: '자격이 없다 — `--profile <이름>` 으로 ~/.aws 프로필을 주거나 AWS_ACCESS_KEY_ID 를 주십시오',
    };
  }
  const key = assetKey(input.cfg, input.slug, input.name);
  try {
    const file = Bun.s3.file(key, {
      bucket: input.cfg.bucket,
      region: input.cfg.region,
      ...(input.credentials ?? {}),
    });
    await file.write(input.body, input.contentType ? { type: input.contentType } : undefined);
    const bytes = typeof input.body === 'string' ? Buffer.byteLength(input.body) : input.body.byteLength;
    return { ok: true, key, url: publicUrl(input.cfg, key), bytes };
  } catch (e) {
    return { ok: false, blockedOn: 'upload-failed', detail: String(e).slice(0, 200) };
  }
}
