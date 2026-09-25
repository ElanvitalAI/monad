/**
 * 🍎 iOS 순수-로직 시험 게이트 — ⛔ 「돌지 않았다」를 「통과」로 읽지 않는다.
 *
 * 🚨 왜: 2026-09-08 실측으로 `apps/ios/` 에 Swift **101개**인데 시험 **0개**였다.
 *   ⛔ 원인은 「아무도 안 썼다」가 아니라 «구조»였다 — 순수 로직이 3176줄·8 import
 *      파일에 묶여 격리 호출이 불가능했다. 묶이지 않은 파일만 모은 SwiftPM 패키지가
 *      `apps/ios/MonadiOSKitTests` 이고, 이 게이트가 그것을 «문»으로 만든다.
 *
 * ⭐ 안드로이드 게이트(`ci-android-unit-tests.ts`)와 «같은 판정 규율»을 쓴다:
 *      1급 판정은 「실패가 있나」가 아니라 ***「몇 개가 «돌았나»」***다. ⛔ 0개는 통과가 아니다.
 * ⚠️ 그리고 이 게이트가 «못 재는 것»을 스스로 말한다 — 화면·네트워크·ACP 왕복은
 *    이 패키지 밖이다. 그건 실기기의 몫이고, 초록을 그것으로 읽으면 안 된다.
 *
 * 사용: bun run scripts/ci-ios-unit-tests.ts [--changed-files a b …]
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = join(import.meta.dir, '..');
export const IOS_PREFIX = 'apps/ios/';
const TRIGGER_RE = /\.(swift|plist|pbxproj|resolved)$/i;

export function iosFilesIn(changed: readonly string[]): string[] {
  return changed.filter((f) => f.startsWith(IOS_PREFIX) && TRIGGER_RE.test(f));
}

/** `swift test` 산출에서 «실제로 돈» 수를 센다. ⛔ 없으면 0 — 「못 셌음」이 분명히 드러난다. */
export function parseSwiftTestTally(output: string): { ran: number; failed: number } {
  // 마지막 "Executed N tests, with M failure(s)" 줄이 총계다.
  const all = [...output.matchAll(/Executed (\d+) tests?, with (\d+) failures?/g)];
  const last = all[all.length - 1];
  if (!last) return { ran: 0, failed: 0 };
  return { ran: Number(last[1]), failed: Number(last[2]) };
}

/** 「잴 수 없었다」를 「통과」로 접지 않는다 — 이름 붙여 돌려준다. */
export function classifyIosUnmeasurable(output: string): string | null {
  if (/xcrun: error|unable to find utility|no such module 'XCTest'/i.test(output)) {
    return 'Swift 툴체인을 못 찾았다 — Xcode 명령줄 도구가 필요하다 (xcode-select --install).';
  }
  if (/error: manifest parse|Package\.swift.*error/i.test(output)) {
    return 'SwiftPM 매니페스트를 못 읽었다.';
  }
  return null;
}

export type IosGateIo = {
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly log?: (line: string) => void;
  readonly error?: (line: string) => void;
  readonly runSwiftTest?: (pkgDir: string) => { readonly status: number | null; readonly output: string };
};

export function parseChangedFiles(args: readonly string[]): string[] | null {
  const at = args.indexOf('--changed-files');
  if (at < 0) return null;
  const files: string[] = [];
  for (const arg of args.slice(at + 1)) {
    if (arg.startsWith('--')) break;
    for (const part of arg.split(',')) { const t = part.trim(); if (t) files.push(t); }
  }
  return files;
}

function defaultRunSwiftTest(pkgDir: string) {
  const r = spawnSync('swift', ['test'], { cwd: pkgDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, output: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

export function runIosUnitTestGate(io: IosGateIo = {}): number {
  const args = io.args ?? process.argv.slice(2);
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;
  const root = io.cwd ?? ROOT;
  const changed = parseChangedFiles(args);

  if (changed !== null) {
    const hits = iosFilesIn(changed);
    if (hits.length === 0) {
      log(`[ios-gate] 해당 없음 — 변경 ${changed.length}개 중 ${IOS_PREFIX} 아래 파일 0개.`);
      return 0;
    }
    log(`[ios-gate] 대상 ${hits.length}개 — 시험을 돌린다.`);
  }

  const pkgDir = join(root, 'apps', 'ios', 'MonadiOSKitTests');
  if (!existsSync(join(pkgDir, 'Package.swift'))) {
    error(`[ios-gate] FAIL — ${pkgDir}/Package.swift 가 없다. 「없어서 통과」로 두지 않는다.`);
    return 1;
  }

  const run = (io.runSwiftTest ?? defaultRunSwiftTest)(pkgDir);
  const unmeasurable = classifyIosUnmeasurable(run.output);
  if (unmeasurable) {
    error(`[ios-gate] ⛔ 측정 불가 — ${unmeasurable}`);
    return 1;
  }

  const { ran, failed } = parseSwiftTestTally(run.output);
  if (ran === 0) {
    error('[ios-gate] ⛔ FAIL — 돈 시험이 «0개»다. ⛔ 0 은 통과가 아니다.');
    for (const line of run.output.split('\n').filter((l) => /error:/.test(l)).slice(0, 10)) error(`   ${line}`);
    return 1;
  }
  if (failed > 0) {
    error(`[ios-gate] FAIL — 시험 ${ran}개 중 ${failed}개 실패.`);
    return 1;
  }
  log(`[ios-gate] PASS — 시험 ${ran}개 돌았고 실패 0.`);
  log('   ⚠️ 이 게이트가 «못 재는 것»: 화면 · 네트워크 · ACP 왕복 — 그건 실기기의 몫이다.');
  return run.status === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(runIosUnitTestGate());
