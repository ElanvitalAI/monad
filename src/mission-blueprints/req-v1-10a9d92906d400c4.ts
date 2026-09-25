import {
  countLandings,
  landingCountSince,
  readLandingHistoryIn,
} from '../mission-capabilities/report/landingcount.js';
import type { MissionBlueprint } from './types.js';

const requestId = 'req:v1:10a9d92906d400c4';
const capabilityId = 'report.landingcount';

/**
 * ⛔ 요청의 intent 가 ***「한 줄로 보고한다」***다 — 그래서 body 는 «한 줄»이다(리뷰 8R must-fix).
 *   ⊕ 「어느 트리를 쟀나」는 «모든» 경로에 있어야 한다 — 한 경로라도 빠지면 그 실패가 조용하다.
 */
function oneLine(text: string): string {
  // ⛔ git 오류 문면에는 줄바꿈이 섞인다 — 그대로 실으면 「한 줄」 계약이 깨진다(실측).
  //   ⊕ LF·CRLF «만» 접으면 단독 CR 이 남는다(리뷰 10R) ⇒ 모든 줄 구분자를 정규화한다.
  return text.replace(/\s*(?:\r\n|\r|\n|\u2028|\u2029)\s*/g, ' ').trim();
}

function degraded(reason: string, root: string): { ok: false; body: string; measured: Record<string, number | string> } {
  return {
    ok: false,
    body: oneLine(`저녁 착지 수 리포트 — 판정 불가: ${reason} (잰 트리: ${root})`),
    measured: { window: landingCountSince, landed: 'unmeasurable', root },
  };
}

/** ⛔ default 로만 내보낸다 — named export 는 소비자가 «없었다»(리뷰 4R must-fix). */
function createLandingCountReportBlueprint(): MissionBlueprint {
  return {
    id: requestId,
    requires: [{ id: capabilityId }],
    produces: { kind: 'landing-count-report', deliver: [] },
    async run(ctx) {
      // ⛔ 카탈로그의 provider 는 «도는 트리»에 묶여 있다(probe() 는 맥락 인자를 안 받는다).
      //   ⇒ 이 리포트는 «자기 authorityRoot»를 «한 번» 읽고 그것으로 가용성과 수를 «둘 다» 낸다.
      //   ⭐ 두 번 읽지 «않는다» — 두 번 읽으면 그 사이 상태가 갈릴 수 있고,
      //     둘째 읽기의 실패 경로가 «시험되지 않는 길»로 남는다(리뷰 3R must-fix). 그 길을 «없앴다».
      // ⛔ 루프의 ready 가 «어느 트리»에서 났는지는 이 리포트가 «알 수 없다»(probe 는 맥락을 안 받는다).
      //   ⇒ 지어내지 않는다. ***자기가 잰 트리만 «모든» 산출에 적는다.***
      //     어긋남 판정은 그 값을 가진 쪽(복합 루프)의 몫이고, 그것은 RFC §4⑵ 계약 변경이라 별도 축이다.
      try {
        const landed = countLandings(readLandingHistoryIn(ctx.authorityRoot));
        if (landed === 0) return degraded(`최근 ${landingCountSince} 창에 착지가 없습니다.`, ctx.authorityRoot);
        return {
          ok: true,
          // ⛔ 성공 경로도 접는다 — authorityRoot 에 줄바꿈이 있으면 「한 줄」 계약이 깨진다(리뷰 9R).
          body: oneLine(`저녁 착지 수 리포트 — 최근 ${landingCountSince} 착지 ${landed}건 (잰 트리: ${ctx.authorityRoot})`),
          measured: { window: landingCountSince, landed, root: ctx.authorityRoot },
        };
      } catch (error) {
        return degraded(`착지 이력을 읽을 수 없습니다: ${error instanceof Error ? error.message : String(error)}`, ctx.authorityRoot);
      }
    },
  };
}

export default createLandingCountReportBlueprint();
