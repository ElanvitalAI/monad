/** ⛔⭐⭐⭐ `/v1/dist/*` 디스패치의 «행위» 자 — 17차 `[F]` · `#11257` 무인 리뷰 should-fix.
 *
 *  ## 왜 이 파일이 있나
 *
 *  📏 `#11257` 이 `IPA_PATH_PREFIX`(`/v1/dist/`)를 잎으로 접으면서 ***행동이 안 바뀌었음을
 *  손으로 쟀다*** — 데몬을 두 번 재시작해 전/후 7/7 동일을 확인했다.
 *  ⛔ 그런데 ***그 측정은 다음 창에게 남지 않는다.*** 무인 리뷰가 정확히 그것을 지적했다:
 *
 *  > 정적 소스 스캔 테스트는 import 별칭/동명 지역변수로 우회될 여지가 있으므로,
 *  > 장기적으로는 AST 기반 검사 또는 `/v1/dist/*` 디스패치의 **행위 테스트**를 권장합니다.
 *
 *  ⇒ 이 파일이 그 행위 축이다. 짝은 `test/rest-route-paths-single-home.test.ts`(정적 축)다.
 *
 *  ## ⛔⭐⭐ 어떻게 「환경 무관」하게 재나 — 이것이 이 자의 설계 핵심
 *
 *  dist 핸들러의 **상태 코드는 `~/.monad/dist/dist.json` 유무에 따라 갈린다**
 *  (📏 실측: IPA 가 발행된 기계에서 `manifest.plist` 는 200, 안 된 기계에서는 404).
 *  ⇒ 그래서 ***상태 코드로 판정하면 기계마다 다른 답이 나온다.***
 *
 *  🔑 대신 ***「디스패처가 잡았나」***만 묻는다. 세 갈래가 응답 «모양»으로 갈린다:
 *  ```
 *  안 잡힘  404 {"error":"not-found","path":"…"}      · application/json
 *  안 잡힘  405 {"error":"method-not-allowed",…}      · ⭐ 메서드 게이트가 라우팅보다 «앞»이다
 *  잡힘     unknown-artifact / not-published /        · text/plain · text/html · x-plist
 *           「No IPA published yet」/ 설치 페이지 / plist XML / 「bad filename」
 *  ```
 *  ⛔📏 **첫 판은 405 를 «잡힘»으로 읽었다** — 판정을 「기본 404 가 아니면 잡힘」으로 썼기 때문이다.
 *    그 상태로 「dist 는 GET 게이트 안에 있다」를 단언했고 ***자가 그것을 반증했다.***
 *    ⇒ 실측하니 `/v1/nonexistent` 도 `/v1/dist/` 도 POST 는 «전부» 405 다 —
 *      ***405 는 경로를 «가르지 않는다».*** 그래서 메서드 축은 이 자의 주제가 아니라 «뺐다».
 *    🔑 ***판정 함수가 두 갈래만 알고 있으면 세 번째 상태를 「아는 쪽」으로 잘못 접는다.***
 *
 *  ## ⛔ 왜 경로를 «잎 상수로 조립»하나
 *
 *  하드코딩하면 이 자가 「정적 축」과 같은 것을 두 번 재는 꼴이 된다.
 *  ⭐ 잎에서 읽어 조립하면 ***`http-server.ts` 쪽만 갈렸을 때 이 자가 «행위»로 잡는다***
 *  (조립한 경로가 안 잡히므로). 잎 자체를 바꾸는 것은 «의도적 계약 변경»이라 따라가는 게 맞다.
 *
 *  ## ⚠️ 이 자가 답하지 «않는» 것
 *
 *  진짜 데몬 프로세스가 이 라우트를 띄우나 — 그건 `bun bin/monad.mjs nexus run` 축이고
 *  in-process 로는 원리상 못 답한다(`#6701`→`#6710`). 여기서는 **같은 `startNexusHttpServer`
 *  진입점**을 실제로 띄워 진짜 HTTP 로 친다 — 그 아래 배선까지가 사정권이다. */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startNexusHttpServer, type NexusHttpServer } from '../src/nexus/api/http-server.js';
import { NexusEventBus } from '../src/nexus/api/event-bus.js';
import { createNexusState } from '../src/nexus/state/state.js';
import { TabRegistry } from '../src/nexus/state/tab-registry.js';
import { IPA_PATH_PREFIX, MANIFEST_PATH } from '../src/nexus/api/rest-route-paths.js';

let server: NexusHttpServer;

beforeAll(() => {
  const state = createNexusState({ nexusVersion: 'test', phase: 'test' });
  const eventBus = new NexusEventBus();
  state.bus = eventBus;
  server = startNexusHttpServer({
    state,
    eventBus,
    registry: new TabRegistry(state),
    metaApi: { noAuth: true },
    // ⚠️📏 무인 리뷰 should-fix(PR #11264): *"OS 할당 포트(0)를 쓰라"* — **지금 구조로는 못 쓴다.**
    //   `http-server.ts` 가 `resolvedPort = port`(루프 «변수»)로 url 을 만들어서
    //   `startPort: 0` 을 주면 `http://127.0.0.1:0` 이 나온다. 고치려면 `server.port` 를
    //   읽도록 «데몬 부팅 경로»를 바꿔야 하고, 그것은 이 자의 축이 아니다.
    // ✅ 대신 flaky 는 이미 두 겹으로 막혀 있다 — 랜덤 시작(2000칸) ⊕ 서버 자체의
    //   포트 재시도 16회(`NEXUS_HTTP_PORT_RANGE`). 16칸이 «연속으로» 점유돼야 실패하고,
    //   그때는 서버가 조용히 죽지 않고 범위를 적어 throw 한다.
    startPort: 57000 + Math.floor(Math.random() * 2000),
  });
});

afterAll(() => server?.stop());

/** ⛔ 이 판정이 이 자의 전부다 — 세 갈래 중 「잡힘」만 참.
 *  ⚠️ 본문을 읽으므로 응답이 커질 수 있는 경로(실제 IPA 스트림)는 부르지 않는다 —
 *    시험이 쓰는 파일 이름은 존재하지 않는 것뿐이라 항상 짧은 오류 본문이다. */
/** ⛔⭐⭐ 게이트가 낸 «거절 봉투»의 코드들. 이 목록에 없는 `error` 코드를 만나면
 *  ***조용히 「잡힘」으로 접지 않고 던진다*** — 그것이 이 자가 첫 판에서 낸 바로 그 실수다
 *  (405 를 몰라서 「잡힘」으로 읽었다). 📏 무인 리뷰 should-fix(PR #11264)도 같은 곳을 짚었다:
 *  *"JSON 이 아닌 모든 응답을 dist 로 간주한다"*.
 *  ⇒ 🔑 ***모르는 상태를 만나면 「아는 쪽」으로 접는 대신 «말하게» 한다.*** */
const GATE_REFUSAL_CODES = new Set(['not-found', 'method-not-allowed']);

async function probe(path: string): Promise<{ dispatched: boolean; status: number }> {
  const res = await fetch(`${server.url}${path}`);
  const type = res.headers.get('content-type') ?? '';
  // dist 핸들러는 넷 다 «JSON 이 아닌» 것을 낸다(text/html · x-plist · text/plain).
  // ⇒ JSON 이 아니면 잡힌 것이다.
  if (!type.includes('application/json')) return { dispatched: true, status: res.status };
  const body = (await res.json()) as { error?: unknown };
  if (typeof body?.error !== 'string') {
    // JSON 인데 오류 봉투도 아니다 — dist 핸들러가 JSON 을 내기 시작했다는 뜻일 수 있다.
    // ⛔ 그것도 «모르는 상태»라 삼키지 않는다.
    throw new Error(`판정 불가: ${path} 가 오류 봉투가 아닌 JSON 을 냈다 (status=${res.status})`);
  }
  if (!GATE_REFUSAL_CODES.has(body.error)) {
    throw new Error(`판정 불가: ${path} 가 «모르는» 거절 코드를 냈다 — error=${body.error} status=${res.status}`);
  }
  return { dispatched: false, status: res.status };
}

const reachedFor = async (paths: readonly string[]): Promise<Array<[string, boolean]>> => {
  const out: Array<[string, boolean]> = [];
  for (const p of paths) out.push([p, (await probe(p)).dispatched]);
  return out;
};

// ⭐ 접두에서 «파생»한다 — 하드코딩하지 않는다(위 머리말의 이유).
const PREFIX_NO_SLASH = IPA_PATH_PREFIX.replace(/\/$/, '');

describe('/v1/dist/* 디스패치 (행위 축)', () => {
  test('접두로 갈리는 네 경로가 «전부» dist 핸들러에 닿는다', async () => {
    const paths = [
      IPA_PATH_PREFIX,                        // 설치 페이지 (접두 «그 자체»)
      `${IPA_PATH_PREFIX}install`,            // 설치 페이지 (명시)
      MANIFEST_PATH,                          // OTA 매니페스트
      `${IPA_PATH_PREFIX}NoSuchArtifact.ipa`, // IPA 스트림 (없는 이름 → 짧은 오류 본문)
    ];
    expect(await reachedFor(paths)).toEqual(paths.map((p) => [p, true]));
  });

  test('⛔ 대조군 — 「닿지 «않아야» 하는」 넷', async () => {
    // 📏 이 줄이 없으면 위 시험은 「전부 잡힌다」로도 통과한다(공허한 통과).
    //   ⇒ 자가 «갈리는 자리»를 실제로 재고 있음을 이 대조군이 증명한다.
    const paths = [
      `${IPA_PATH_PREFIX}xyz`,          // 접두는 맞지만 `.ipa` 가 아니다
      `${IPA_PATH_PREFIX}install/deep`, // 설치 경로의 «하위»는 계약이 아니다
      PREFIX_NO_SLASH,                  // ⭐ 끝 슬래시가 «계약의 일부»다
      '/v1/nonexistent',                // 접두와 무관
    ];
    expect(await reachedFor(paths)).toEqual(paths.map((p) => [p, false]));
  });

  test('⛔⭐ 경로 순회 방어 — 접두 «뒤»에 디렉토리가 오면 400 으로 거절한다', async () => {
    // 📏 `handleDistIpa` 가 `filename.includes('/')` 로 막는다. 이 라우트는 인증 «밖»이라
    //   (Tailscale 경계가 유일한 접근 제어) 이 방어가 조용히 사라지면 홈 디렉토리가 열린다.
    //   ⇒ 「잡혔다」가 아니라 ***「잡혔고 400 으로 거절했다」***까지 못 박는다.
    const traversal = await probe(`${IPA_PATH_PREFIX}a/b.ipa`);
    expect(traversal.dispatched).toBe(true);
    expect(traversal.status).toBe(400);
  });
});
