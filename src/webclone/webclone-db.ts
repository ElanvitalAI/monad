// ── WebClone 인덱스 — 「무엇을 언제 어디서 떠서 어디에 뒀나」 (2026-09-08) ────────
//
// ⛔⭐ 문제: 클론 산출물이 «파일»로만 남으면 하루 뒤에 「이 토큰이 어느 사이트의
//    몇 시 판본에서 나왔나」를 못 답한다. 그리고 그 물음이 재현의 «전부»다 —
//    원본은 바뀌고, 내 템플릿은 안 바뀐다. 둘을 잇는 것이 이 표다.
//
// 원칙:
//   • ⭐⭐ 판정자가 ***둘***이고 «다른 것»을 답한다. ⛔ 섞지 마라:
//       `content_hash`  받아온 바이트가 같나   (⭐ 정규화 «뒤» — CF 토큰·nonce 를 지운 값)
//       `spec_hash`     ***디자인이 같나***    (⭐ 템플릿을 손봐야 하는지는 «이것»이 답한다)
//     ⛔ 시각으로 판정하지 마라 — 같은 날 두 번 떠도 내용이 같을 수 있고,
//        다른 날 떠도 다를 수 있다. 이 저장소가 「시각으로 판정」해 여러 번 데였다.
//     🩸 그리고 «정규화 없는» 원문 해시로는 판정 자체가 불가능하다(2026-09-08 실측 —
//        같은 URL 을 2초 간격으로 두 번 받으니 달랐다). 기전은 `normaliseForHash` 주석.
//   • ⭐ 자산은 «가시성»을 값으로 갖는다(`public` / `reference`).
//     ⛔ 남의 사진·로고를 공개 버킷에 올리는 것은 재현이 아니라 «재배포»다.
//        그 갈림을 사람 기억에 두지 않고 «컬럼»에 둔다.
//   • fail-soft: 인덱스 실패가 클론 자체를 막지 않는다(파일이 1순위).
//   • 스키마는 «추가»만 한다 — 열을 지우면 옛 인덱스가 안 열린다.

import { Database } from 'bun:sqlite';

export type AssetVisibility = 'public' | 'reference';

export interface CloneRow {
  readonly slug: string;
  readonly url: string;
  readonly title: string | null;
  readonly capturedAt: string;
  readonly contentHash: string;
  /** ⭐ 「디자인이 바뀌었나」. contentHash 와 «다른 축»이다 — 위 specHash() 주석 참조. */
  readonly specHash: string;
  readonly specJson: string;
  readonly unresolved: string;
}

export interface AssetRow {
  readonly slug: string;
  readonly ref: string;
  readonly visibility: AssetVisibility;
  readonly bytes: number | null;
  readonly contentType: string | null;
  /** 공개 URL. `reference` 면 반드시 null 이다 — 스키마가 아니라 규율이라 검증한다. */
  readonly publicUrl: string | null;
  /** 왜 이 가시성인가. ⛔ 비워 두지 마라 — 다음 창이 판단을 되짚는 유일한 근거다. */
  readonly reason: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clones (
  slug         TEXT PRIMARY KEY,
  url          TEXT NOT NULL,
  title        TEXT,
  captured_at  TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  spec_hash    TEXT NOT NULL DEFAULT '',
  spec_json    TEXT NOT NULL,
  unresolved   TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS assets (
  slug         TEXT NOT NULL,
  ref          TEXT NOT NULL,
  visibility   TEXT NOT NULL CHECK (visibility IN ('public','reference')),
  bytes        INTEGER,
  content_type TEXT,
  public_url   TEXT,
  reason       TEXT NOT NULL,
  PRIMARY KEY (slug, ref)
);
CREATE TABLE IF NOT EXISTS tokens (
  slug   TEXT NOT NULL,
  name   TEXT NOT NULL,
  value  TEXT NOT NULL,
  source TEXT,
  PRIMARY KEY (slug, name)
);
CREATE INDEX IF NOT EXISTS idx_clones_hash ON clones(content_hash);
CREATE INDEX IF NOT EXISTS idx_clones_spec ON clones(spec_hash);
CREATE INDEX IF NOT EXISTS idx_assets_vis  ON assets(visibility);
`;

export function openWebCloneDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  // ⛔ 스키마는 «추가»만 한다 — 옛 인덱스 파일이 그대로 열려야 한다.
  //    `IF NOT EXISTS` 가 열에는 없으므로 존재를 «보고» 더한다.
  const cols = db.query('PRAGMA table_info(clones)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'spec_hash')) {
    db.exec("ALTER TABLE clones ADD COLUMN spec_hash TEXT NOT NULL DEFAULT ''");
  }
  return db;
}

/**
 * ⛔⭐⭐ 요청마다 «바뀌는» 주입을 지운다 — 해시 «전»에 반드시 지난다.
 *
 * 🩸 계기(2026-09-08 실측): 같은 URL 을 2초 간격으로 두 번 받아 해시하니 «달랐다».
 *    범인은 Cloudflare 가 매 응답에 심는 챌린지 토큰이었다:
 *      `window.__CF$cv$params={r:'a37ab76d…',t:'MTc4ODgz…'}`
 *    ⇒ 정규화 없이는 ***「같은 판인가」를 영영 못 답한다*** — 언제 재도 「바뀌었다」가 나온다.
 * 🔑 그리고 이것은 CF 만의 문제가 아니다 — nonce·빌드 타임스탬프가 같은 모양이다.
 *    ⛔ 그러니 「해시가 다르다」를 「사이트가 바뀌었다」로 읽기 «전»에 이 목록을 먼저 본다.
 */
export function normaliseForHash(text: string): string {
  return text
    // Cloudflare 챌린지 파라미터 (요청마다 다르다)
    .replace(/window\.__CF\$cv\$params\s*=\s*\{[^}]*\}/g, 'window.__CF$cv$params={}')
    // CSP nonce
    .replace(/\snonce=["'][^"']*["']/g, ' nonce=""')
    // 캐시 버스터 쿼리 (?v=…, ?t=…)
    .replace(/([?&](?:v|t|ts|_)=)[A-Za-z0-9._-]+/g, '$1');
}

/**
 * 내용 해시 — ⭐ **정규화 «뒤»** 원본 바이트에서 만든다.
 *
 * ⚠️ 이 값이 답하는 것은 「받아온 바이트가 같나」다. ⛔ 「디자인이 같나」는 «다른 축»이고,
 *    그것은 `specHash` 가 답한다. 둘을 섞으면 광고 문구 한 줄 바뀐 것과
 *    팔레트가 통째로 바뀐 것이 같은 신호가 된다.
 */
export function contentHash(parts: readonly string[]): string {
  const h = new Bun.CryptoHasher('sha256');
  for (const p of parts) h.update(normaliseForHash(p));
  return h.digest('hex').slice(0, 16);
}

/**
 * ⭐⭐ **디자인 해시** — 「내가 재현해야 할 것이 바뀌었나」.
 *
 * 측정된 스펙에서 «디자인 축»만 골라 해시한다. ⛔ 제목·설명 같은 내용은 «뺀다** —
 * 문구가 바뀐 것은 재현을 다시 할 이유가 아니다. 이 해시가 바뀌면 템플릿을 손봐야 한다.
 */
export function specHash(spec: {
  colors: ReadonlyArray<{ name: string; value: string }>;
  fontStacks: readonly string[];
  // ⛔ 구체 타입을 요구하지 않는다 — 이 함수는 «직렬화»만 한다.
  //    좁게 잡으면 CloneSpec 의 readonly 필드가 안 들어간다(실측: TS2345).
  typeScale: readonly unknown[];
  sections: readonly unknown[];
  breakpoints: readonly string[];
  motion: { keyframes: readonly string[]; honoursReducedMotion: boolean };
}): string {
  const design = JSON.stringify({
    colors: spec.colors.map((c) => [c.name, c.value]),
    fontStacks: spec.fontStacks,
    typeScale: spec.typeScale,
    sections: spec.sections,
    breakpoints: spec.breakpoints,
    motion: spec.motion,
  });
  return new Bun.CryptoHasher('sha256').update(design).digest('hex').slice(0, 16);
}

export function upsertClone(db: Database, row: CloneRow): void {
  db.query(
    `INSERT INTO clones (slug, url, title, captured_at, content_hash, spec_hash, spec_json, unresolved)
     VALUES ($slug, $url, $title, $capturedAt, $contentHash, $specHash, $specJson, $unresolved)
     ON CONFLICT(slug) DO UPDATE SET
       url=$url, title=$title, captured_at=$capturedAt, content_hash=$contentHash,
       spec_hash=$specHash, spec_json=$specJson, unresolved=$unresolved`,
  ).run({
    $slug: row.slug, $url: row.url, $title: row.title, $capturedAt: row.capturedAt,
    $contentHash: row.contentHash, $specHash: row.specHash,
    $specJson: row.specJson, $unresolved: row.unresolved,
  });
}

/** ⛔ `reference` 인데 공개 URL 이 있으면 «거절»한다. 스키마로는 못 막는 규율이라
 *  여기서 던진다 — 조용히 넘기면 남의 자산이 공개 목록에 실린다. */
export function insertAsset(db: Database, row: AssetRow): void {
  if (row.visibility === 'reference' && row.publicUrl !== null) {
    throw new Error(`reference 자산에 공개 URL 이 붙었다: ${row.slug}/${row.ref}`);
  }
  if (row.reason.trim() === '') {
    throw new Error(`자산 가시성에 이유가 없다: ${row.slug}/${row.ref}`);
  }
  db.query(
    `INSERT INTO assets (slug, ref, visibility, bytes, content_type, public_url, reason)
     VALUES ($slug, $ref, $visibility, $bytes, $contentType, $publicUrl, $reason)
     ON CONFLICT(slug, ref) DO UPDATE SET
       visibility=$visibility, bytes=$bytes, content_type=$contentType,
       public_url=$publicUrl, reason=$reason`,
  ).run({
    $slug: row.slug, $ref: row.ref, $visibility: row.visibility, $bytes: row.bytes,
    $contentType: row.contentType, $publicUrl: row.publicUrl, $reason: row.reason,
  });
}

export function replaceTokens(
  db: Database,
  slug: string,
  tokens: ReadonlyArray<{ name: string; value: string; source: string | null }>,
): void {
  db.query('DELETE FROM tokens WHERE slug = $slug').run({ $slug: slug });
  const stmt = db.query(
    'INSERT INTO tokens (slug, name, value, source) VALUES ($slug, $name, $value, $source)',
  );
  for (const t of tokens) stmt.run({ $slug: slug, $name: t.name, $value: t.value, $source: t.source });
}

export interface CloneSummary {
  readonly slug: string;
  readonly url: string;
  readonly capturedAt: string;
  readonly contentHash: string;
  readonly specHash: string;
  readonly tokenCount: number;
  readonly publicAssets: number;
  readonly referenceAssets: number;
  readonly unresolved: string;
}

export function listClones(db: Database): CloneSummary[] {
  return db.query(`
    SELECT c.slug, c.url, c.captured_at AS capturedAt, c.content_hash AS contentHash, c.spec_hash AS specHash,
           c.unresolved,
           (SELECT COUNT(*) FROM tokens t WHERE t.slug = c.slug) AS tokenCount,
           (SELECT COUNT(*) FROM assets a WHERE a.slug = c.slug AND a.visibility='public')    AS publicAssets,
           (SELECT COUNT(*) FROM assets a WHERE a.slug = c.slug AND a.visibility='reference') AS referenceAssets
    FROM clones c ORDER BY c.captured_at DESC
  `).all() as CloneSummary[];
}
