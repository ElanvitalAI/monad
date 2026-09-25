/**
 * 🖥️ **봇 화면 «벽»의 주소를 고른다** — §22 `A0`·`A1` 의 PWA 쪽 조각 (🅕 45차)
 *
 * ⛔⭐ **새로 «짓는» 것이 거의 없다.** 이 축은 이미 서 있다:
 * ```
 * 화면      noVNC 6081~6084 (VM)                          ← 이미 돈다
 * 경로      tailscale serve --set-path=/botN               ← deploy-bot-wall.sh 가 편다
 * 벽        scripts/botlab/bot-wall.html                   ← 「문서 하나 · RFB 넷」(비번 «한 번»)
 * 주소 조립  src/bots/screen-url.ts buildBotWallUrl()       ← 이미 있다 · 시험도 있다
 * ```
 * ⇒ 📌 이 파일이 하는 일은 ***「그 주소를 «어느 호스트»로 지을까」 한 칸***뿐이다.
 *
 * ### ⛔ §22n 이 못 박은 네 줄 — 이 화면이 그것을 지킨다
 * ```
 * ① 주소는 serve 경유 ***https*** 로만   (http://100.x 는 Mixed Content 로 «막힌다»)
 * ② `?path=botN/` 을 «반드시»            (없으면 «뜨는데 안 붙는다» — 가장 헷갈리는 실패)
 * ③ 문서는 «하나» — RFB 를 N 개 연다     (iframe 넷이면 비번을 «네 번» 친다)
 * ④ 기본은 «보기 전용»                   (조작은 `&control=1` 로 사람이 명시)
 * ```
 * ⛔ ①②③④ 는 `buildBotWallUrl` ⊕ `bot-wall.html` 이 «이미» 지킨다 — 여기서 다시 만들지 않는다.
 */

/**
 * ⚠️⛔ **기본 호스트는 «설정»이다** (2026-09-25 공개 준비 — 한 사람의 tailnet 이름이 박혀 있던 자리).
 * canonical 한 «출처»는 ***VM 자신***이다 — `deploy-bot-wall.sh` 가 매번 `tailscale status --json` 의
 * `DNSName` 으로 «재서» 쓴다. 브라우저는 그 명령을 못 돌리므로 순서대로 고른다:
 * ```
 * ① ?host=<이름>                    사람이 준 값 — 유효하면 이 기기에 «기억»한다
 * ② 이 기기에 기억된 값              localStorage `monad.botlab.wallHost`
 * ③ 빌드 설정                        NEXT_PUBLIC_MONAD_BOTLAB_HOST (정적 export 라 «빌드 때» 박힌다)
 * ④ 없음                             벽을 안 띄우고 「?host= 를 달라」고 말한다
 * ```
 */
export const DEFAULT_WALL_HOST: string = (process.env.NEXT_PUBLIC_MONAD_BOTLAB_HOST ?? '').trim();
export const WALL_HOST_STORAGE_KEY = 'monad.botlab.wallHost';

export interface WallHost {
  host: string;
  /** ⛔ 「기본값을 썼다」와 「사람이 줬다」와 「없다」를 «가른다» — 틀렸을 때 처방이 다르다. */
  source: 'query' | 'remembered' | 'default' | 'unset';
}

/** ⛔ 호스트도 «주소»에 들어간다 — 좁게 막는다(스킴·경로·질의를 못 끼우게). */
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
export function isValidWallHost(host: string): boolean {
  return host.length > 0 && host.length <= 253 && HOST_RE.test(host);
}

/**
 * `?host=` → 기억된 값 → 빌드 설정 → 없음.
 * ⛔ 못 읽거나 «계약 밖»이면 조용히 «떨어지지 않고» 그 사실을 낸다.
 */
export function resolveWallHost(search: string, remembered: string | null = null): WallHost & { rejected: string | null } {
  let raw: string | null = null;
  try { raw = new URLSearchParams(search).get('host'); } catch { raw = null; }
  const trimmed = raw?.trim() ?? '';
  if (trimmed !== '' && isValidWallHost(trimmed)) return { host: trimmed, source: 'query', rejected: null };
  // ⛔ 「무시했다」를 «말한다» — 조용히 기본값을 쓰면 사람이 「왜 내 host 가 안 먹지」로 헤맨다.
  const rejected = trimmed === '' ? null : trimmed;
  const mem = remembered?.trim() ?? '';
  if (mem !== '' && isValidWallHost(mem)) return { host: mem, source: 'remembered', rejected };
  if (DEFAULT_WALL_HOST !== '' && isValidWallHost(DEFAULT_WALL_HOST)) return { host: DEFAULT_WALL_HOST, source: 'default', rejected };
  return { host: '', source: 'unset', rejected };
}
