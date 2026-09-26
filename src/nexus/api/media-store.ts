/**
 * 생성물(그림·영상) 로컬 보관소.
 *
 * ## 왜 있나
 * 복원(`OBS-T524`)은 저장소에 적어 둔 **상대 CDN 주소**로 그림·영상을 되살린다. 그런데 그 주소는
 * 우리 것이 아니다 — 힉스필드 플레이북 실측: ***생성물은 30일 뒤 삭제***. 그날이 오면 복원은
 * 「돌아왔는데 안 열린다」가 된다. ⇒ 우리 쪽에 한 벌을 둔다.
 *
 * ## ⛔ 왜 `/v1/attachments` 를 «안» 쓰나 — 그 파일 머리말이 스스로 말한다
 * ```
 * // Path lives under /tmp because (a) these are intentionally ephemeral …
 * const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
 * ```
 * ⇒ 재부팅에 사라지고 10MB 상한이라 영상이 안 들어간다. ***재사용이 아니라 오용이 된다.***
 *
 * ## ⭐ 디스크가 «새지 않게» 하는 것이 이 모듈의 절반이다
 * 생성물은 계속 쌓이고 영상은 한 편이 수십 MB 다. 그래서 **총량 상한 ⊕ 오래된 것부터 회수**를
 * 저장 «경로 안»에 둔다 — 별도 크론이나 사람 손에 기대지 않는다.
 * ⛔ 상한을 넘겨 «못 담는» 것은 실패가 아니다 — 원격 주소가 그대로 살아 있으므로 복원은 계속 된다.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { elanousStateRoot } from '../../autopilot/state-paths.js';
import { debug } from '../../debug/log.js';

/** 한 파일 상한. ⛔ 영상 한 편이 들어갈 만큼은 되어야 한다(플레이북 실측: 4초 1080p ≈ 수 MB~수십 MB). */
export const MEDIA_STORE_MAX_FILE_BYTES = 64 * 1024 * 1024;
/** 보관소 총량 상한. 넘으면 «오래된 것부터» 지운다. */
export const MEDIA_STORE_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

/** 보관소 뿌리.
 *
 *  ⛔⭐ 경로를 «손으로» 짓지 않는다 — `join(homedir(), '.elanous', …)` 는
 *  test↔prod 격리를 «조용히» 깨뜨린다. 🩸 실측(2026-09-11): 처음엔 그렇게 썼고 게이트가 착지를 막았다
 *  (*"스토어 경로는 resolver 를 거쳐야 격리가 성립합니다"*). ⇒ 공용 리졸버를 쓴다.
 *  ⭐ 그래야 대본(세션 저장소)과 그 대본이 «가리키는 파일»이 같은 우주에 산다.
 */
export function mediaStoreRoot(): string {
  const override = process.env.ELANOUS_MEDIA_ROOT?.trim();
  if (override) return override;
  return join(elanousStateRoot(), 'media');
}

/** 주소에서 확장자를 뽑는다. 못 뽑으면 종류로 기본값을 준다.
 *  ⛔ 확장자를 «지어내지 않는다** — 잘못 붙이면 브라우저·플레이어가 못 연다. */
export function mediaFileExtension(url: string, kind: string): string {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    /* 상대 주소·이상한 문자열 — 아래 확장자 추출이 알아서 빈 값을 낸다 */
  }
  const ext = extname(pathname).toLowerCase();
  if (/^\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v)$/.test(ext)) return ext;
  return kind === 'video' ? '.mp4' : '.png';
}

/** 보관 id — 주소에서 «결정적으로» 나온다.
 *  ⭐ 같은 주소를 두 번 담으면 같은 id 라 파일이 하나만 남는다(재시도·중복 폴링에 안전). */
export function mediaStoreId(url: string, kind: string): string {
  const digest = createHash('sha256').update(url).digest('hex').slice(0, 32);
  return `${digest}${mediaFileExtension(url, kind)}`;
}

export interface MediaStoreEntry {
  id: string;
  path: string;
  bytes: number;
}

/** 보관소에서 그 id 의 실제 경로. 없으면 null. ⛔ 경로 탈출(`..`·구분자)을 막는다. */
export function resolveMediaPath(id: string, root: string = mediaStoreRoot()): string | null {
  if (!/^[0-9a-f]{32}\.[a-z0-9]{2,4}$/.test(id)) return null;
  const path = join(root, id);
  return existsSync(path) ? path : null;
}

/** 총량이 상한을 넘으면 «오래된 것부터» 지운다. 지운 바이트 수를 돌려준다. */
export function gcMediaStore(
  maxTotalBytes: number = MEDIA_STORE_MAX_TOTAL_BYTES,
  root: string = mediaStoreRoot(),
): number {
  if (!existsSync(root)) return 0;
  const files = readdirSync(root)
    .map((name) => {
      const path = join(root, name);
      try {
        const stat = statSync(path);
        return stat.isFile() ? { path, bytes: stat.size, mtimeMs: stat.mtimeMs } : null;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { path: string; bytes: number; mtimeMs: number } => entry !== null);
  let total = files.reduce((sum, entry) => sum + entry.bytes, 0);
  if (total <= maxTotalBytes) return 0;
  // 오래된 것부터 — mtime 오름차순.
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  let freed = 0;
  for (const entry of files) {
    if (total <= maxTotalBytes) break;
    try {
      rmSync(entry.path);
      total -= entry.bytes;
      freed += entry.bytes;
    } catch {
      /* 못 지운 것은 건너뛴다 — 회수가 실패해도 저장 경로를 깨뜨리지 않는다 */
    }
  }
  if (freed > 0) debug.log('media.store', 'gc', { freedBytes: freed, remainingBytes: total });
  return freed;
}

export interface SaveRemoteMediaDeps {
  /** ⭐ `typeof fetch` 로 받지 «않는다** — 런타임마다 딸린 확장(Bun 의 `preconnect` 등)까지
   *  요구해 시험이 목을 못 만든다. ***우리가 쓰는 만큼만*** 계약으로 적는다. */
  fetchImpl?: (url: string) => Promise<Response>;
  root?: string;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

/** 원격 생성물을 한 벌 내려받아 보관한다.
 *
 *  ⭐ 실패는 «없음(null)»으로 돌려준다 — 예외로 올리지 않는다. 보관은 «보험»이고,
 *  보험이 안 들렸다고 원래 일(원격 주소로의 복원)이 깨지면 안 된다.
 *  ⛔ 다만 «조용히» 실패하지 않는다 — 왜 못 담았는지 관측에 남긴다.
 */
export async function saveRemoteMedia(
  url: string,
  kind: string,
  deps: SaveRemoteMediaDeps = {},
): Promise<MediaStoreEntry | null> {
  const root = deps.root ?? mediaStoreRoot();
  const maxFileBytes = deps.maxFileBytes ?? MEDIA_STORE_MAX_FILE_BYTES;
  const id = mediaStoreId(url, kind);
  const path = join(root, id);
  try {
    mkdirSync(root, { recursive: true });
    if (existsSync(path)) {
      // ⭐ 이미 담았다 — 다시 안 받는다(재시도·중복 폴링이 대역폭을 두 번 쓰지 않는다).
      return { id, path, bytes: statSync(path).size };
    }
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
    const response = await fetchImpl(url);
    if (!response.ok) {
      debug.log('media.store', 'save-skipped', { reason: 'http', status: response.status, kind });
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
      debug.log('media.store', 'save-skipped', { reason: 'empty', kind });
      return null;
    }
    if (bytes.byteLength > maxFileBytes) {
      // ⛔ 상한을 넘는 것은 «담지 않는다» — 원격 주소가 살아 있으므로 복원은 계속 된다.
      debug.log('media.store', 'save-skipped', { reason: 'too-large', bytes: bytes.byteLength, maxFileBytes, kind });
      return null;
    }
    writeFileSync(path, bytes);
    gcMediaStore(deps.maxTotalBytes ?? MEDIA_STORE_MAX_TOTAL_BYTES, root);
    debug.log('media.store', 'saved', { id, bytes: bytes.byteLength, kind });
    return { id, path, bytes: bytes.byteLength };
  } catch (err) {
    debug.log('media.store', 'save-failed', {
      kind,
      error: err instanceof Error ? err.message : String(err),
    }, { level: 'error' });
    return null;
  }
}
