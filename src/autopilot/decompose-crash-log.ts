// ── 분해 크래시 근본조사 조회 (대표 2026-07-17 관측성) ────────────────────────────
// logDecomposeCrash 가 durable 로 남긴 decompose_crash.log(validationErrors·rawTextHead·컨텍스트)를
// 사람이 읽을 수 있게 조회한다. `monad logs`(요약·structured) 너머 전문(LLM 원문·검증 에러) 진단 창구.
// 순수 파싱(parseCrashLines/formatCrashEntry)은 단위테스트, 파일 IO 는 read* 래퍼.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { monadStateRoot } from './state-paths.js';

export interface DecomposeCrashEntry {
  ts: string;
  missionId: string;
  code?: string | null;
  message?: string;
  validationErrors?: unknown;
  rawTextChars?: number | null;
  rawTextHead?: string | null;
  model?: string;
  [k: string]: unknown;
}

export function decomposeCrashLogPath(): string {
  return join(monadStateRoot(), 'conatus/decompose_crash.log');
}

/** JSONL 라인 → 엔트리(순수) — missionId 필터·최근 우선·limit. 깨진 라인 skip. */
export function parseCrashLines(
  lines: readonly string[],
  opts: { missionId?: string; limit?: number } = {},
): DecomposeCrashEntry[] {
  const out: DecomposeCrashEntry[] = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    try {
      const o = JSON.parse(l) as DecomposeCrashEntry;
      if (!opts.missionId || o.missionId === opts.missionId) out.push(o);
    } catch { /* 깨진 라인 skip */ }
  }
  return out.slice(-(opts.limit ?? 5)).reverse(); // 최근 우선
}

/** durable crash 로그 읽기 — 없으면 빈 배열(fail-soft). */
export function readDecomposeCrashLog(opts: { missionId?: string; limit?: number } = {}): DecomposeCrashEntry[] {
  const p = decomposeCrashLogPath();
  if (!existsSync(p)) return [];
  try { return parseCrashLines(readFileSync(p, 'utf-8').split('\n'), opts); }
  catch { return []; }
}

/** 사람용 요약 포맷(순수) — code·검증에러·rawTextHead. */
export function formatCrashEntry(e: DecomposeCrashEntry): string {
  const errs = Array.isArray(e.validationErrors) && e.validationErrors.length
    ? (e.validationErrors as { code?: string; taskIndex?: number; message?: string }[])
        .slice(0, 10).map((x) => `    - [${x.code ?? ''}${x.taskIndex !== undefined ? `#${x.taskIndex}` : ''}] ${x.message ?? ''}`).join('\n')
    : '    (없음)';
  const lines = [
    `⏺ ${e.ts} · ${e.missionId}`,
    `  code=${e.code ?? '?'} · model=${e.model ?? '?'} · rawTextChars=${e.rawTextChars ?? 0}`,
    `  message: ${String(e.message ?? '').slice(0, 180)}`,
    '  validationErrors:',
    errs,
  ];
  if (e.rawTextHead) {
    lines.push('  rawTextHead(앞 800자·LLM 원문):', `    ${String(e.rawTextHead).slice(0, 800).replace(/\n/g, '\n    ')}`);
  }
  return lines.join('\n');
}
