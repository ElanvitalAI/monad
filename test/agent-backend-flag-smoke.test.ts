// U3 — agent backend auto-approve 플래그 drift smoke.
//
// backend 정의의 auto-approve 플래그가 실제 CLI 에 여전히 유효한지 검증(플래그 rename/제거 = 무인 실행
// 무음 실패의 근본). 실 PTY 기동은 auth+헤비라 범위 밖 — "바이너리가 이 플래그를 안다"까지 값싸게 검증.
//
// ⚠️ 판정은 두 방법을 결합해 Goodhart 를 피한다:
//   (1) `--help` 텍스트에 플래그 문자열이 있으면 유효(claude/gemini/grok — 문서화된 플래그).
//   (2) help 에 없으면(codex 는 --yolo 를 숨긴 alias) 플래그-검증형 CLI 인지 확인 —
//       bogus 플래그는 에러(비0)이고 real 플래그는 수용(0)이면 유효.
//   ※ `<flag> --version` 단독은 부적합 — claude/gemini 는 --version 이 미지원 플래그도 조기종료(0)시켜
//     Goodhart. codex/grok 은 플래그를 먼저 검증하므로 (2)가 성립.
// ⚠️ 바이너리 미설치 환경(CI 등)에선 it.skipIf 로 실제 skip(외부 CLI 의존을 강제하지 않음·무-assert PASS 아님).

import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'child_process';
import { codexBackend, claudeBackend, geminiBackend, grokBackend, type AgentBackend } from '../src/agent-mission/driver.js';

function binOnPath(cmd: string): boolean {
  return spawnSync('command', ['-v', cmd], { shell: true, encoding: 'utf-8' }).status === 0;
}

function statusOf(cmd: string, args: string[]): number {
  return spawnSync(cmd, args, { encoding: 'utf-8', timeout: 30_000 }).status ?? -1;
}

/** 플래그가 CLI 에 유효한가 — help 문서화 OR (검증형 CLI 에서) bogus 는 실패·real 은 수용. */
function flagIsValid(cmd: string, flag: string): boolean {
  const help = spawnSync(cmd, ['--help'], { encoding: 'utf-8', timeout: 30_000 });
  if (`${help.stdout ?? ''}${help.stderr ?? ''}`.includes(flag)) return true; // (1) 문서화된 플래그
  // (2) 검증형 CLI: bogus 플래그가 에러여야 하고(=플래그를 실제로 검증), real 플래그는 수용.
  const bogusRejected = statusOf(cmd, ['--__monad_bogus_flag__', '--version']) !== 0;
  const realAccepted = statusOf(cmd, [flag, '--version']) === 0;
  return bogusRejected && realAccepted;
}

describe('agent backend auto-approve 플래그 drift smoke', () => {
  const backends: AgentBackend[] = [codexBackend, claudeBackend, geminiBackend, grokBackend];
  for (const b of backends) {
    const flag = b.args.find((a) => a.startsWith('--')) ?? b.args[0]!;
    const available = binOnPath(b.cmd);
    it.skipIf(!available)(`${b.name}: '${flag}' 플래그가 CLI 에 유효`, () => {
      expect(flagIsValid(b.cmd, flag)).toBe(true);
    });
  }
});
