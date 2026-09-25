import { appendMessage } from '../session/index.js';
// ⛔ 메시지 «모양»은 `session/chat.ts` 가 갖는다 — 여기서 베끼지 않는다.
//   같은 계약을 두 벌로 두면 한쪽만 자라고, 그때 「어느 표면의 기록인가」가 갈린다.
import { buildToolTraceMessage } from '../session/chat.js';
import { debug } from '../debug/log.js';

/** ⛔⭐⭐⭐ **ACP 턴(= PWA 채팅이 «실제로» 타는 길)의 툴 감사 추적을 세션에 남긴다.**
 *
 *  ## 왜 이 파일이 있나
 *
 *  📏 2026-08-22 실측(16차 `[F]`): ***PWA 세션에는 툴 추적이 «하나도» 없었다.***
 *  저장소 role 분포가 `user 205 · assistant 241 · system 12` 였고 **`tool` 이 «0»**.
 *  ⛔ 전수: `buildToolTraceMessage()` 를 부르는 곳은 `session/chat.ts`(CLI·TUI) ·
 *  `discord-self-message.ts` · `telegram-commands.ts` 뿐이고 ***`src/acp/`·`src/nexus/` 에는 없었다.***
 *
 *  > 🔑 ***표면마다 감사 추적이 갈렸다*** — CLI·TUI·텔레그램은 남기고 **PWA 만 안 남겼다.**
 *  > 그래서 「PWA 에서 어떤 도구를 호출했나」에는 «지어낸 답»밖에 나올 수 없었다
 *  > (`session/chat.ts` 주석이 그 위험을 이미 적었다 — *"the REAL trace, not a confabulated one"*).
 *
 *  ## ⛔ 왜 «떼어냈나» — 시험이 「모양」이 아니라 「동작」을 물게 하려고
 *
 *  📏 무인 리뷰 must-fix(PR #11120): 1차판은 이 로직을 `server.ts` 의 깊은 클로저 안에 두고
 *  시험이 **소스 문자열만** 검사했다. ⇒ ***배선이 런타임에 죽어도, 엉뚱한 세션·인자를 저장해도 초록***인
 *  Goodhart 시험이었다. ⇒ 주입 가능한 함수로 떼어 **실행으로** 문다. */
/** ⛔ 이 저장소 «밖»으로 열지 않는다 — 소비처가 이 파일과 그 시험뿐이다(리뷰 must-fix:
 *  쓰이지 않는 공개 표면). 시험은 리터럴로 넘기므로 이름을 export 할 필요가 없다. */
interface AcpToolTraceDeps {
  /** 시험 주입점. 기본은 실제 세션 저장소. */
  readonly append?: (sessionId: string, msg: ReturnType<typeof buildToolTraceMessage>) => unknown;
  /** ⛔⭐ 메시지 «모양»을 만드는 자리 — 기본은 `session/chat.ts` 의 공유 빌더.
   *
   *  📏 무인 리뷰 must-fix(PR #11120): 산출 필드(`role`/`toolName`/…)만 검사하면
   *  ***이 모듈이 모양을 «수동 복제»해도 시험이 통과한다.*** 그러면 계약이 조용히 둘이 되고,
   *  한쪽만 자란 날 「어느 표면의 기록인가」가 갈린다(16차에 그 부류가 네 번 실제 결함이었다).
   *  ⇒ 주입점으로 열어 **「공유 빌더를 쓴다」를 시험이 «실행으로» 확인**할 수 있게 한다. */
  readonly buildMessage?: typeof buildToolTraceMessage;
  /** 실패를 «이름으로» 남기는 자리. 기본은 관측 로그. */
  readonly observeFailure?: (info: { sessionId: string; tool: string; id: string; reason: string }) => void;
}

/** 한 번의 툴 호출을 감사 기록으로 남긴다.
 *
 *  ⛔ **fail-soft** — 저장이 실패해도 던지지 않는다. 사람이 보는 화면이 감사 기록보다 앞선다
 *    (`session/chat.ts` 가 세운 규율).
 *  ⚠️ **그러나 «조용히 삼키지 않는다»** — 실패하면 이름을 대고 관측에 남긴다.
 *    ***조용한 실패야말로 16차가 내내 잡던 형태고, 이 PR 초판이 또 만들었다.***
 *
 *  @returns 저장을 시도해 «성공»했으면 `true`. ⛔ 「안 했다」와 「했는데 실패했다」는 다른 값이다. */
export function persistAcpToolTrace(
  sessionId: string,
  call: { readonly id: string; readonly name: string; readonly result?: unknown },
  args: unknown,
  deps: AcpToolTraceDeps = {},
): boolean {
  const append = deps.append ?? appendMessage;
  // ⛔ 모양은 «공유 빌더»가 만든다 — 여기서 손으로 조립하지 않는다(계약을 두 벌로 두지 않는다).
  const build = deps.buildMessage ?? buildToolTraceMessage;
  try {
    append(sessionId, build(call.name, args, call.result));
    return true;
  } catch (err) {
    const reason = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
    const observe = deps.observeFailure
      ?? ((info) => { debug.log('acp.tool', 'trace-persist-failed', info); });
    // ⛔ 관측 자체가 던져도 턴을 깨지 않는다 — 그러면 fail-soft 가 무의미해진다.
    try { observe({ sessionId, tool: call.name, id: call.id, reason }); } catch { /* 관측은 마지막 방어선이다 */ }
    return false;
  }
}
