import { execFileSync } from 'node:child_process';
import type { CapabilityProbeContext, CapabilityProbeResult, CapabilityProvider } from '../registry.js';

type ProbeResult = CapabilityProbeResult;
type ReadLandingHistory = () => string;

/**
 * ⭐ 측정 창은 «한 곳»에서만 정한다.
 * ⛔ 1판은 이 파일과 블루프린트가 같은 문자열을 «따로» 들고 있었다 — 그러면 둘이 조용히 갈린다(리뷰 should-fix).
 */
export const landingCountSince = '1 day ago';

/**
 * ⭐ 이력을 읽는 곳도 «한 곳»뿐이다 — 블루프린트가 git 을 다시 부르지 않고 이것을 쓴다.
 * ⛔ 1판은 능력이 `process.cwd()` 를, 블루프린트가 `ctx.authorityRoot` 를 각각 봤다.
 *   ⇒ 그 둘이 다르면 ***같은 요청이 「준비됨」인데 리포트는 «다른 트리»를 잰다***(리뷰 must-fix).
 */
export function readLandingHistoryIn(root: string): string {
  return execFileSync('git', ['log', `--since=${landingCountSince}`, '--format=%H'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function countLandings(history: string): number {
  return history.split(/\r?\n/).filter(Boolean).length;
}

/** ⛔ 「어느 트리를 쟀나」를 사유에 «같이» 담는다 — 안 담으면 어긋남이 조용하다. */
function unavailableLandingCount(reason: string, root: string): ProbeResult {
  return {
    ok: false,
    reason: `${reason} (잰 트리: ${root})`,
    repairHint: {
      // ⛔ 1판은 src/cli/pr-granularity.ts 를 댔는데 그 파일은 이 능력과도 git 이력과도 «무관»했다.
      //   ⇒ 코드가 아니라 «상태»가 없는 것이므로, 고칠 곳은 이 능력이 «어느 트리를 보게 할지»다.
      paths: ['src/mission-capabilities/report/landingcount.ts'],
      what: `착지 이력이 있는 저장소 체크아웃을 이 능력이 보도록 한다 — 지금 본 트리는 ${root} 이고 최근 ${landingCountSince} 창에 커밋이 없거나 읽을 수 없다.`,
    },
  };
}

/**
 * 읽기 전용 가용성 검사. 외부 상태는 «그 트리의 최근 git 이력»이다.
 * 선택한 probe 맥락의 authorityRoot 를 재고, 생략하면 기존처럼 `process.cwd()` 를 잰다.
 *
 * ⛔⭐ 리더와 «그 리더가 읽는 트리»는 «같이» 온다 — 따로 받으면 남의 트리를 읽고도
 *   사유에 `잰 트리: <cwd>` 라고 «단정»하게 된다(리뷰 3R must-fix). 그래서 한 객체로 묶어 받는다.
 */
/**
 * ⛔ «불투명»하다 — 밖에서 객체 리터럴로 만들 수 없다.
 *   1판은 공개 구조형이라 `{ readHistory: 남의트리리더, root: cwd }` 를 «여전히» 만들 수 있었고,
 *   그러면 「구조적으로 갈릴 수 없다」는 «과장»이었다(리뷰 4R must-fix).
 *   ⇒ 브랜드를 «비공개 심볼»로 두어 `landingHistorySourceFor(root)` «만» 만들 수 있게 한다.
 */
declare const landingSourceBrand: unique symbol;
export type LandingHistorySource = { readonly root: string; readonly [landingSourceBrand]: true };

/** 브랜드 안쪽 — 이 모듈만 읽는다. */
const readerOf = new WeakMap<object, ReadLandingHistory>();

function makeSource(root: string, readHistory: ReadLandingHistory): LandingHistorySource {
  const source = { root } as unknown as LandingHistorySource;
  readerOf.set(source as unknown as object, readHistory);
  return source;
}

/** ⭐ 기본 소스도 «유일한 생성자»를 거친다 — 그래야 그 생성자가 제품 경로에 «실제로» 있다. */
function configuredSource(context?: CapabilityProbeContext): LandingHistorySource {
  return landingHistorySourceFor(context?.authorityRoot ?? process.cwd());
}

/**
 * ⛔ `source` 는 «필수»다 — 기본값을 두면 소스를 모르는 호출자의 생략을 `process.cwd()` 로 «일방 확정»하고,
 *   그 root 를 실패 사유에 «측정 사실»로 내보내게 된다(리뷰 10R must-fix). 부르는 쪽이 트리를 «말해야» 한다.
 */
export function probeLandingCount(source: LandingHistorySource): ProbeResult {
  const readHistory = readerOf.get(source as unknown as object);
  // ⛔ 이 모듈이 만들지 «않은» 소스는 받지 않는다 — 「모르는 것」을 「cwd」로 접지 않는다.
  if (!readHistory) return unavailableLandingCount('착지 이력 소스가 landingHistorySourceFor 로 만들어지지 않았다.', source?.root ?? '(미상)');
  try {
    if (countLandings(readHistory()) > 0) return { ok: true };
    return unavailableLandingCount(`최근 ${landingCountSince} 창에 착지가 없다.`, source.root);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return unavailableLandingCount(`착지 이력을 읽을 수 없다: ${detail}`, source.root);
  }
}

/** 트리 하나를 읽는 소스 — ***이것이 유일한 생성자***라 리더와 트리가 갈릴 수 없다. */
export function landingHistorySourceFor(root: string): LandingHistorySource {
  return makeSource(root, () => readLandingHistoryIn(root));
}

/** ⭐ 트리에 «묶은» provider — 블루프린트가 자기 authorityRoot 로 이것을 만든다. */
/** ⛔ 비공개다 — 밖에 소비자가 «없다». default export 하나만 내보낸다(리뷰 5R must-fix). */
function createLandingCountProvider(): CapabilityProvider {
  return {
    id: 'report.landingcount',
    async probe(context?: CapabilityProbeContext): Promise<ProbeResult> {
      return probeLandingCount(configuredSource(context));
    },
  };
}

export default createLandingCountProvider();
