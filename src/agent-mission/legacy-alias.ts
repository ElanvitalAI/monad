// U2 명명 중립화 관측(순수) — 레거시 `codex` alias 진입 판정.
//
// canonical=`agent-mission` · deprecated alias=`codex`(commander .alias). cron/스크립트가 옛 이름을
// 계속 쓰는지 관측해 alias 제거 안전시점을 판정한다(관측=elanous logs --category agent-cli.alias).
//
// ⚠️ argv[2] 고정 인덱스 판정은 브리틀 — 옵션 플래그가 명령 앞에 올 수 있고, 미션 텍스트에
//   'codex'/'agent-mission' 문자열이 섞일 수도 있다. top-level 명령 토큰은 **첫 positional** 이므로
//   [node, script] 이후 선행 옵션('-' 시작)을 스킵하고 처음 나오는 positional 로 판정한다(그 뒤의
//   서브옵션·미션 텍스트에 강건).
//
// 옵션 "값"이 명령을 가리지 않는 이유: 프로그램 레벨 값-옵션은 `--config-dir <dir>` 하나뿐이고,
//   applyConfigDirFlagFromArgv(src/cli/config-dir-flag.ts)가 이 지점 도달 전 `process.argv` 에서
//   플래그+값을 통째로 제거한다(process.argv = argv). 따라서 훅이 보는 argv 엔 값-옵션이 없어
//   첫 positional == 명령 토큰이 성립한다(E2E: --config-dir 경로가 있어도 alias 정확 판정).

/** `elanous logs --category` 로 조회하는 브레드크럼 카테고리(제1원칙 관측). */
export const AGENT_ALIAS_LOG_CATEGORY = 'agent-cli.alias';

/**
 * top-level 명령 토큰이 deprecated `codex` alias 였으면 true, canonical `agent-mission` 이면 false.
 * @param argv process.argv 형태([node, script, <command>, ...]) — --config-dir 는 상류에서 제거된 상태.
 */
export function isLegacyCodexInvocation(argv: readonly string[]): boolean {
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok.startsWith('-')) continue; // 선행 옵션 플래그 스킵(값-옵션 --config-dir 는 상류 제거)
    return tok === 'codex'; // 첫 positional == 명령 토큰
  }
  return false;
}
