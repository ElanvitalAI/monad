// SelfImplement 툴 이름 배열 — ⛔ **잎(leaf) 모듈이다. 여기에 import 를 «절대» 더하지 마라.**
//
// 🚨 왜 갈라졌나 (2026-08-12 `[S]` 77차 · 라이브 실측):
//   이 상수는 `self-implement.ts` 안에 있었고, `agent/autonomous-tools.ts` 가 그것을
//   **모듈 초기화 시점**(`DEV_REQUEST_HARNESS_TOOL_NAMES = [...SELF_IMPLEMENT_TOOL_NAMES, …]`)에 폈다.
//   두 모듈 사이에 순환이 있어 ***import 순서에 따라 프로세스가 죽었다***:
//     A) self-implement.js → autonomous-tools.js  ⛔ ReferenceError: Cannot access
//        'SELF_IMPLEMENT_TOOL_NAMES' before initialization
//     B) autonomous-tools.js → self-implement.js  ✅ ok
//   `src/agent/autonomous-tools.test.ts` 가 A 순서라 **standalone 으로 항상 죽었고**,
//   그래서 그 파일을 만지는 하니스 런은 게이트 «기준선»을 못 만들었다(`unknown`).
//   ⇒ 📌 ***멀쩡한 착지 하나가 그 때문에 「수렴 불가」로 버려졌다***(`#8512`).
//
// ⭐ 그러므로 처방은 「순서를 지키자」가 아니라 ***「순서에 의존할 수 없게 만든다」***다 —
//   잎 모듈에는 순환이 닿을 수 없다.
export const SELF_IMPLEMENT_TOOL_NAMES = ['SelfImplement', 'self_implement'] as const;
