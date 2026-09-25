// ⛔⭐⭐⭐ 대시보드는 stdin TTY 없이는 «뜨면 안 된다» — 뜨면 «엔터 폭풍»이 된다.
//
// 기전(🅣 실측 2026-09-17 · draw 탐침 771회/초):
//   ① `initTui()` 는 `if (!process.stdin.isTTY) return;` 으로 «조용히» 돌아간다 ⇒ `_raw` 가 false 로 남는다.
//   ② `readKey()` 는 `if (!_raw) { resolve({ name: 'enter' }) }` 로 ***엔터를 지어낸다***(`src/tui.ts`).
//   ③ 그래서 컴포저가 매번 `submitted: true` 로 즉시 돌아오고,
//      `chat-main-entry-runtime.ts` 의 `if (result.submitted) { invalidate…; redraw(); }` 가 발화하며
//      `showDashboard` 의 바깥 루프가 다시 입력을 묻는다 ⇒ 초당 수백 프레임을 다시 그린다.
//   📏 실측: stdin=/dev/null 이면 CPU 72~127% · 8초에 화면 재출력 25~44MB ·
//           진짜 PTY 를 붙이면 CPU 0.0% · draw 0회(같은 코드·같은 인자).
//
// ⛔ 「그냥 조용히 돌아가기」는 답이 아니다 — 그것이 ①이고, 그 침묵이 이 폭주를 만들었다.
//    도구는 «못 한다»를 말해야 한다(2026-09-17 `#18720` 비-TTY 거부와 같은 계약).

/** 대시보드가 뜰 수 있는 자리인지. `false` 면 호출부는 «읽히는 실패»로 거부한다. */
export function dashboardCanUseTty(stdin: { isTTY?: boolean } = process.stdin): boolean {
  return stdin.isTTY === true;
}

/** 거부 문면 — 스택 없이 사람이 읽고 «다음에 칠 것»을 안다. */
export function dashboardTtyRefusalMessage(): string {
  return [
    'monad 대시보드는 stdin TTY가 있는 자리에서만 뜰 수 있다.',
    '  지금 stdin 이 TTY 가 아니다(파이프·리다이렉트·비대화형 실행).',
    '  ⛔ 그대로 띄우면 키를 못 읽고 화면만 초당 수백 번 다시 그린다.',
    '  ✅ 한 줄 물어보기 :  monad ask "<질문>"',
    '  ✅ 이어서 대화하기:  monad repl',
    '  ✅ 터미널에서 직접 :  monad        (파이프 없이)',
  ].join('\n');
}
