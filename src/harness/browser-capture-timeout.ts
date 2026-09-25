/**
 * 화면 포착(`Page.captureScreenshot`)의 «시한 경주» — 한 자리가 아니라 «모듈»이다.
 *
 * ⛔⭐⭐ ***이 함수가 왜 모듈로 올라왔나***: 2026-08-26 에 「눈이 조용히 멎는다」를 잡고
 *    `browser-act` 「한 자리만」 고쳤다. 2026-08-28 전수로 세어 보니 `client.screenshot()` 을
 *    ***시한 없이*** 부르는 곳이 «여섯»이었고, 그중 하나가 **`verify-url`** —
 *    즉 아침 봇 루틴의 「본다」 «1단계» 였다. ⇒ 고친 것은 «자리»였고 병은 «부류»였다.
 *
 * ⛔⭐ `Page.captureScreenshot` 은 «에러가 아니라 «영영 안 옴»»으로 실패한다 —
 *    `try/catch` 는 그것을 «못 잡는다». 원시 CDP 기본 시한은 **120,000ms**
 *    (`DEFAULT_CDP_TIMEOUT_MS`)라, 시한을 안 걸면 조작 하나가 «2분» 멎는다.
 *
 * 📏 2026-08-26 실측(같은 창·같은 기계): 헤드리스에서 ***8회 중 6회*** 매달렸고,
 *    그중 ***이동을 「일으키는」 클릭 직후가 6회 중 5회***였다(이동 없는 클릭 0/6). 헤드풀 0/8.
 *    ⇒ 그러므로 이 시한은 «있으면 좋은 것»이 아니라 ***이 경로들의 전제***다.
 */
import type { CdpClient } from '../browser-cdp/client.js';

export const DEFAULT_CAPTURE_TIMEOUT_MS = 5_000;

/** ⛔ 관측 행이 커지면 다른 절단에 걸린다 — 상한을 두고 자른다. */
export const CAPTURE_REASON_MAX_CHARS = 200;

export type CaptureAttempt =
  | { png: Buffer }
  | { stalled: true }
  | { failed: true; reason: string };

/**
 * 화면을 포착하되 «세 갈래»로만 답한다 — 얻었다 / 멎었다 / 던졌다.
 *
 * ⛔ 「멎었다」와 「던졌다」를 «한 값»으로 접지 마라 — 원인도 처방도 다르다
 *    (멎음 = 이동이 대상을 부순 것 · 던짐 = 대상이 이미 없거나 인자가 틀린 것).
 */
export async function captureWithTimeout(
  client: CdpClient,
  timeoutMs: number,
  opts?: { fullPage?: boolean },
): Promise<CaptureAttempt> {
  const timeout = Symbol('capture-timeout');
  // ⛔⭐⭐ 타이머를 «반드시» 걷는다 — 안 걷으면 포착이 «성공해도» 이 타이머가
  //    이벤트 루프를 붙들어 ***CLI 프로세스가 안 끝난다***.
  //    📏 2026-08-28 실측: 이것 때문에 `verify-url` 계약 시험이 5초에 SIGTERM(exit 143)으로 죽었다.
  //    ⚠️ 그러니 이 함수는 「멎음을 잡는다」와 「끝나게 둔다」 ***둘 다***가 계약이다.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      opts?.fullPage ? client.screenshot({ fullPage: true }) : client.screenshot(),
      new Promise<typeof timeout>((resolve) => { timer = setTimeout(() => resolve(timeout), timeoutMs); }),
    ]);
    return result === timeout ? { stalled: true } : { png: result };
  } catch (error) {
    // ⛔ 여기서 예외를 «버리지 않는다» — 버리면 관측에 `error` 라는 라벨만 남고
    //    다음 창이 「무엇이 error 인가」를 처음부터 다시 잰다.
    //    📏 2026-08-27 실측: captureOutcome==='error' 행 전수에 이유를 담은 키가 ***0개***였다.
    return { failed: true, reason: describeCaptureFailure(error) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function describeCaptureFailure(error: unknown): string {
  // ⛔⭐ 「빈 문면」 가드가 `Error` 에는 «안 닿았다» — `new Error('')` 이 `"Error: "` 가 되어
  //    trim 뒤에도 비어 있지 않았고, 그래서 관측에 ***`Error:` 라는 쓸모없는 한 조각***만 남았다.
  //    ⇒ 이름과 «문면»을 따로 본다(2026-08-28 · 시험이 잡았다).
  const message = error instanceof Error ? (error.message ?? '').trim() : '';
  if (error instanceof Error && message === '') {
    return `(예외가 «빈» 문면이다 — 던진 쪽이 이유를 안 남겼다: ${error.name})`;
  }
  const raw = error instanceof Error
    ? `${error.name}: ${message}`
    : typeof error === 'string' ? error : (() => { try { return JSON.stringify(error); } catch { return String(error); } })();
  const text = (raw ?? '').trim();
  if (text === '') return '(예외가 «빈» 문면이다 — 던진 쪽이 이유를 안 남겼다)';
  return text.length > CAPTURE_REASON_MAX_CHARS ? `${text.slice(0, CAPTURE_REASON_MAX_CHARS)}…(잘림)` : text;
}
