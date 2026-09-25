/** ⛔⭐⭐⭐ MCP 전선 이름 계약의 «집» — 이름을 «만드는 쪽»과 «읽는 쪽»이 같은 상수를 본다.
 *
 *  📏 왜 별도 모듈인가 (2026-08-21 · `[F]` 15차):
 *    ① 이 계약은 데몬(`boot/daemon-tools`)이 «만들고», 정책(`tool-runtime/tool-policy`)과
 *       브라우저(`apps/pwa`)가 «읽는다». 만드는 쪽에 두면 읽는 쪽이 import 할 수 없다 —
 *       `boot/daemon-tools/index.ts` 는 `tool-runtime/registry.js` 를 import 하므로 역방향은 «순환»이고,
 *       PWA 가 그 모듈을 import 하면 데몬 그래프가 통째로 브라우저 번들에 딸려온다.
 *    ② 그래서 셋 다 닿을 수 있는 «잎» 모듈에 둔다 — 이 파일은 아무것도 import 하지 않는다.
 *
 *  📏 이 계약이 어긋나서 난 일 (2026-08-21 하루):
 *    `#10767` 이 전선 이름을 `.` → `__` 로 바꿨는데, 그 이름을 «읽는» PWA 쪽이 `.` 만 찾고 있어서
 *    서버 접두가 `""` 가 됐고 위젯 리소스 조회를 통째로 건너뛰었다(`#10815`).
 *  ⇒ 📌 ***바꿨는데 「읽는 쪽」을 안 셌다*** — 상수를 베끼면 시험도 «한쪽만» 문다.
 *  ⇒ 이 자리를 «세는» 자 = `scripts/f12-sweep.ts` 의 `bucket b`(베낀 상수 후보). */

/** 프로바이더가 툴 이름에 점을 금지하므로(`^[a-zA-Z0-9_-]+$`) 전선에서는 이 구분자를 쓴다. */
export const MCP_WIRE_DELIMITER = '__';

/** 레지스트리 이름(점)을 전선에 실을 수 있는 이름으로 바꾼다. 레지스트리 이름 자체는 그대로 둔다. */
export function toWireToolName(registryName: string): string {
  return registryName.replaceAll('.', MCP_WIRE_DELIMITER);
}

/** ⛔ 읽는 쪽은 «둘 다» 받는다 — 레지스트리 이름(`.`)도 전선 이름(`__`)도 같은 서버를 가리킨다. */
export const MCP_TOOL_NAME_SEPARATORS: readonly string[] = [MCP_WIRE_DELIMITER, '.'];

/** 툴 이름에서 MCP 서버 접두를 뽑는다. 접두가 없으면 `''` — 이 표면의 MCP 툴이 아니다. */
export function mcpServerPrefixOf(toolName: string): string {
  for (const separator of MCP_TOOL_NAME_SEPARATORS) {
    const at = toolName.indexOf(separator);
    if (at > 0) return toolName.slice(0, at);
  }
  return '';
}
