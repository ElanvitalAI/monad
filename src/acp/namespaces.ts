/** ⛔⭐⭐ ACP 세션 id 의 «네임스페이스 접두» 계약. **이 잎은 import-free 로 남는다.**
 *
 *  ## 왜 이 파일이 있나
 *
 *  📏 2026-08-22 실측(17차 `[F]`): 자(`scripts/f12-sweep.ts --bucket-b`)가 `'acp-cli:'` 를
 *  **희소성 상위**로 올렸다 — `dual-role-manager.ts` 가 상수로 «선언»한 값을
 *  `domains/acp-backend-sessions.ts` 가 ***문자열로 베끼고*** 있었다.
 *
 *  ⛔ 그렇다고 소비처가 `dual-role-manager.js` 를 import 할 수는 없다 —
 *  그 모듈은 `globalAcpAgentManager` 를 비롯한 «무거운» 그래프를 끌고 오는데,
 *  소비처(`acp-backend-sessions.ts`)는 머리말이 스스로 **"read-only·쓰기경로 무접촉"**
 *  이라고 못 박은 가벼운 열람 모듈이다.
 *  ⇒ 그래서 `rest-route-paths.ts`(16차) · `mcp-route-path.ts`(15차)의 선례대로 «잎»을 세운다.
 *  ⛔ **여기에 어떤 import 도 추가하지 마라.**
 *
 *  🔎 이 계약이 다시 갈렸는지 재는 명령:
 *  ```bash
 *  bun run scripts/f12-sweep.ts --bucket-b | grep -F "const=CLIENT_NAMESPACE"
 *  bun test test/acp-backend-sessions.test.ts
 *  ``` */

/** monad 가 «클라이언트»로서 외부 백엔드(codex/claude…)를 몰 때 붙는 접두.
 *  전체 형태는 `acp-cli:<brand>:<raw>`. */
export const CLIENT_NAMESPACE = 'acp-cli:';

/** monad 가 «서버»로서 상대에게 노출하는 세션의 접두. 전체 형태는 `acp-srv:<raw>`. */
export const SERVER_NAMESPACE = 'acp-srv:';
