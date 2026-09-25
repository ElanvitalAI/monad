// ── 로컬 LLM 벤치마크 · Python 코드 실행기 (2026-07-15) ──────────────────────────
//
// 모델이 낸 코드 답변을 **실제 Python subprocess 에서 실행**해 통과 테스트 수로 채점한다(대표 평가 방식과
// 동형: temperature 0·순차·실행 기반). 순수 실행 유틸 — 모델/네트워크 무관·주입(runner)로 테스트.
//
// 안전: `python3 -I`(격리 모드·유저 site 무시) + 하드 타임아웃 + stdin 차단. 코드는 로컬 벤치 전용이며
// node-b/본머신 로컬 실행이라 매매/발송/외부와 무접촉(불변식). 절대 신뢰 입력이 아니므로 timeout·kill 강제.

import { spawn } from 'node:child_process';

export interface PyRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly elapsedMs: number;
}

export interface PyRunOpts {
  /** 하드 타임아웃(ms) · 기본 10초. 무한루프 코드 방어. */
  readonly timeoutMs?: number;
  /** python 바이너리 override(테스트/환경) · 기본 'python3'. */
  readonly python?: string;
  /** now 주입(결정론 테스트). */
  readonly now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * 파이썬 소스를 subprocess 로 실행하고 stdout/stderr/exit 을 돌려준다. stdin 은 즉시 닫아 대화형 블록을
 * 방지하고, timeout 초과 시 SIGKILL. `-I`(isolated) 로 유저 환경 오염을 배제한다.
 */
export function runPython(source: string, opts: PyRunOpts = {}): Promise<PyRunResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const python = opts.python ?? 'python3';
  const now = opts.now ?? Date.now;
  const startedAt = now();
  return new Promise((resolve) => {
    // `-I` isolated · `-c` inline source. stdin ignored so input() 계열이 즉시 EOF.
    const proc = spawn(python, ['-I', '-c', source], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, timedOut, elapsedMs: now() - startedAt });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGKILL'); } catch { /* already gone */ }
      finish(null);
    }, timeoutMs);
    proc.stdout?.on('data', (d) => { stdout += d.toString('utf8'); if (stdout.length > 256_000) stdout = stdout.slice(-256_000); });
    proc.stderr?.on('data', (d) => { stderr += d.toString('utf8'); if (stderr.length > 64_000) stderr = stderr.slice(-64_000); });
    proc.once('error', (err) => {
      stderr += `\n[spawn error] ${err instanceof Error ? err.message : String(err)}`;
      finish(null);
    });
    proc.once('close', (code) => finish(code));
  });
}

/**
 * 모델 답변에서 첫 ```python(또는 ```py / 무언어) 코드블록을 추출. 코드블록이 없으면 원문 전체를 코드로
 * 간주(모델이 순수 코드만 냈을 때). 채점 전처리 — 순수·결정론.
 */
export function extractCodeBlock(answer: string): string {
  const fenced = answer.match(/```(?:python|py)?\s*\n([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  // 코드펜스 없음 — 산문 섞였을 수 있으나 원문을 그대로(모델이 코드만 낸 케이스).
  return answer.trim();
}

/** 실행 하네스 출력의 `__PASS__ <name>` / `__FAIL__ <name>` 마커를 세어 통과/전체를 돌려준다. 순수. */
export function tallyMarkers(stdout: string): { passed: number; failed: number; passedNames: string[]; failedNames: string[] } {
  const passedNames: string[] = [];
  const failedNames: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const p = line.match(/^__PASS__\s+(.+)$/);
    const f = line.match(/^__FAIL__\s+(.+)$/);
    if (p) passedNames.push(p[1]!.trim());
    else if (f) failedNames.push(f[1]!.trim());
  }
  return { passed: passedNames.length, failed: failedNames.length, passedNames, failedNames };
}
