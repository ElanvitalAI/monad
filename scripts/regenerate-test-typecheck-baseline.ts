/** Regenerates visible test diagnostic counts for the gate-only tsc scope. */
import { execFileSync } from 'node:child_process';
import { renameSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { TEST_TYPECHECK_BASELINE, TYPECHECK_GATE_CONFIG, isBaselineExemptTestFile, parseTypecheckErrors, tscEnv } from '../src/typecheck-ratchet.js';

export interface TscAnalysis {
  status: number;
  output: string;
}

export type RunTscAnalysis = (root: string) => TscAnalysis;

export function defaultRunTscAnalysis(root: string): TscAnalysis {
  try {
    const output = execFileSync('bunx', ['tsc', '--noEmit', '-p', TYPECHECK_GATE_CONFIG], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: tscEnv(),
    });
    return { status: 0, output };
  } catch (error: unknown) {
    const result = error as { status?: number; stdout?: string; stderr?: string };
    return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }
}

/** PWA 워크스페이스 진단 — 루트 게이트 설정 밖이라 자체 tsconfig 로 따로 돌린다. */
export function runPwaTsc(root: string): TscAnalysis {
  try {
    const output = execFileSync('bunx', ['tsc', '--noEmit', '-p', 'apps/pwa/tsconfig.json'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: tscEnv(),
    });
    return { status: 0, output };
  } catch (error: unknown) {
    const result = error as { status?: number; stdout?: string; stderr?: string };
    return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }
}

export function regenerateTestTypecheckBaseline(root: string, runTsc: RunTscAnalysis = defaultRunTscAnalysis): string[] {
  const analysis = runTsc(root);
  const diagnostics = parseTypecheckErrors(analysis.output);
  if (analysis.status !== 0 && diagnostics.length === 0) {
    throw new Error(`[tsc-ratchet] tsc analysis failed without parseable diagnostics (exit ${analysis.status}); baseline preserved.`);
  }
  const counts = new Map<string, number>();
  for (const error of diagnostics) {
    if (error.file.startsWith('test/')) counts.set(error.file, (counts.get(error.file) ?? 0) + 1);
  }
  // ⛔ 2026-08-14 — 루트 게이트 설정은 `apps/pwa` 를 «품지 않는다». 그래서 PWA 부채는 여기서
  //   따로 세야 한다(#8784 로 게이트가 PWA 를 보게 된 뒤 그 부채가 남을 막고 있었다).
  //   ⚠️⛔ 경로 형태는 «어디서 부르느냐»로 갈린다 — 2026-08-14 실측 둘:
  //        `cd apps/pwa && tsc -p tsconfig.json`      → `src/lib/x.test.ts`        (설정 폴더 기준)
  //        뿌리에서 `tsc -p apps/pwa/tsconfig.json`   → `apps/pwa/src/lib/x.test.ts` (뿌리 기준)
  //      ⇒ 이 스크립트는 «뿌리에서» 부르므로 이미 뿌리 기준이다. 접두를 «다시 붙이지 않는다».
  //      (처음에 붙였다가 `apps/pwa/apps/pwa/...` 가 되어 한 줄도 안 들어갔다.)
  for (const error of parseTypecheckErrors(runPwaTsc(root).output)) {
    if (isBaselineExemptTestFile(error.file)) counts.set(error.file, (counts.get(error.file) ?? 0) + 1);
  }
  const files = [...counts.keys()].sort();
  const target = resolve(root, TEST_TYPECHECK_BASELINE);
  const temporary = resolve(root, `.${basename(TEST_TYPECHECK_BASELINE)}.${process.pid}.tmp`);
  writeFileSync(temporary, `${files.map((file) => `${file}\t${counts.get(file)!}`).join('\n')}\n`);
  renameSync(temporary, target);
  return files;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..');
  const files = regenerateTestTypecheckBaseline(root);
  console.log(`[tsc-ratchet] wrote ${files.length} existing test-debt files with diagnostic counts to ${TEST_TYPECHECK_BASELINE}.`);
}
