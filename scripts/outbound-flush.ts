#!/usr/bin/env bun
// ── 야간 보류 알림 플러시 (2026-07-06 대표 지시) ─────────────────────────
// 00:00~06:30 KST 무음 창에 보류된 알림을 아침에 묶음 1건으로 전달.
// 무음 창 밖 첫 sendOutbound 도 자동 플러시하지만, 발송 크론이 없는 아침
// (US 휴장 등)을 대비해 06:31 에 결정론으로 보장.
// cron: 31 6 * * *
//
// 격리 우주 큐는 세어서 말하기만 한다 — 읽어서 보내지 않고, 지우거나 옮기지 않는다.
// 열거 실패는 플러시를 막지 않으며 0으로 접지 않는다.
// 우주 목록은 resolveLogTargets({ all: true, includeTest: true }) 가 연다 — find 로 훑지 않는다.

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { flushDeferred, inQuietHours } from '../src/domains/outbound-alert.js';
import { conatusPath } from '../src/domains/conatus-data-dir.js';
import { ensureCronNodePath } from '../src/domains/cron-path.js';
import * as logsCli from '../src/cli/logs-cli.js';
import type { LogTarget } from '../src/cli/logs-cli.js';

export const DEFERRED_QUEUE_FILENAME = 'outbound_deferred.jsonl';

export type ForeignQueueScan =
  | { ok: true; population: number; files: number; items: number; paths: string[] }
  | { ok: false; error: string };

export type ResolveTargetsOpts = { all: boolean; includeTest: boolean };

export type ResolveTargetsFn = (opts: ResolveTargetsOpts) => { targets: LogTarget[]; error?: string };

export type RealpathFn = (p: string) => string;

function errorCode(e: unknown): string | undefined {
  return e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : undefined;
}

function isNotFoundError(e: unknown): boolean {
  return errorCode(e) === 'ENOENT';
}

/** 큐 파일 실체 검사 — 부재만 건너뛰고, EACCES 등 검사 실패는 throw(상위가 unknown/error). */
export function inspectDeferredQueueFile(path: string): 'missing' | 'present' {
  try {
    return statSync(path).isFile() ? 'present' : 'missing';
  } catch (e) {
    if (isNotFoundError(e)) return 'missing';
    throw e;
  }
}

/** 발견된 큐 파일은 canonical path 로만 센다. 정규화 실패는 throw — 조용히 빼지 않는다. */
export function canonicalQueuePath(p: string, realpath: RealpathFn = realpathSync): string {
  return realpath(resolve(p));
}

function activeQueueCanon(activePath: string, realpath: RealpathFn): string {
  try {
    return realpath(activePath);
  } catch (e) {
    if (isNotFoundError(e)) return resolve(activePath);
    throw e;
  }
}

/**
 * 한 우주의 deferred 큐 경로.
 * `conatusPath('outbound_deferred.jsonl')` 가 `MONAD_STATE_DIR=<universe>` 일 때 내는 값과 같다.
 * LogTarget.dbPath 는 `<stateDir>/logs/logs.db`.
 */
export function deferredQueuePathForTarget(target: Pick<LogTarget, 'dbPath'>): string {
  return join(dirname(dirname(target.dbPath)), 'conatus', DEFERRED_QUEUE_FILENAME);
}

/** deferOutbound 가 적재하는 레코드: `{ ts, kind, text, origin? }`. 빈 객체·타입 오류는 건수가 아니다. */
export function isValidQueuedRecord(rec: unknown): rec is { ts: string; kind: string; text: string } {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return false;
  const o = rec as Record<string, unknown>;
  return typeof o.ts === 'string' && o.ts.length > 0
    && typeof o.kind === 'string'
    && typeof o.text === 'string';
}

/** 읽기 실패는 throw — 0으로 접지 않는다. 호출부가 unknown/error 로 접는다. */
export function countValidQueuedRecords(path: string): number {
  let n = 0;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as unknown;
      if (isValidQueuedRecord(rec)) n++;
    } catch { /* 손상 라인은 건수에서 제외 */ }
  }
  return n;
}

/** 이 우주(해석된 활성 큐) 밖에 남은 같은 이름 큐를 센다. 배달·이동·삭제는 하지 않는다. */
export function scanForeignDeferredQueues(opts?: {
  activePath?: string;
  targets?: LogTarget[];
  resolveTargets?: ResolveTargetsFn;
  realpath?: RealpathFn;
}): ForeignQueueScan {
  try {
    const realpath = opts?.realpath ?? realpathSync;
    const activePath = resolve(opts?.activePath ?? conatusPath(DEFERRED_QUEUE_FILENAME));
    const activeCanon = activeQueueCanon(activePath, realpath);
    let targets: LogTarget[];
    if (opts?.targets) {
      targets = opts.targets;
    } else {
      const resolved = (opts?.resolveTargets ?? logsCli.resolveLogTargets)({ all: true, includeTest: true });
      if (resolved.error) throw new Error(resolved.error);
      targets = resolved.targets;
    }
    const found = new Set<string>();
    for (const target of targets) {
      const queuePath = deferredQueuePathForTarget(target);
      if (inspectDeferredQueueFile(queuePath) === 'missing') continue;
      const canon = canonicalQueuePath(queuePath, realpath);
      if (canon === activeCanon) continue;
      found.add(canon);
    }
    let items = 0;
    for (const p of found) items += countValidQueuedRecords(p);
    return { ok: true, population: targets.length, files: found.size, items, paths: [...found] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function formatForeignQueueScan(scan: ForeignQueueScan): string {
  if (!scan.ok) return `격리 우주 큐 못 셌다: ${scan.error}`;
  return `격리 우주 큐 ${scan.files}곳 · ${scan.items}건 (모집단 ${scan.population})`;
}

export function formatFlushResult(n: number): string {
  return n > 0 ? `야간 보류 ${n}건 일괄 발송` : '보류분 없음';
}

export function runOutboundFlush(opts?: {
  quiet?: boolean;
  flush?: () => number;
  scan?: () => ForeignQueueScan;
  log?: (msg: string) => void;
}): { flushed: number; scan: ForeignQueueScan | null } {
  const log = opts?.log ?? ((msg: string) => { console.log(msg); });
  if (opts?.quiet ?? inQuietHours()) {
    log('아직 무음 창 — skip');
    return { flushed: 0, scan: null };
  }
  const flushed = (opts?.flush ?? (() => flushDeferred()))();
  log(formatFlushResult(flushed));
  let scan: ForeignQueueScan;
  try {
    scan = (opts?.scan ?? (() => scanForeignDeferredQueues()))();
  } catch (e) {
    scan = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  log(formatForeignQueueScan(scan));
  return { flushed, scan };
}

if (import.meta.main) {
  ensureCronNodePath();
  runOutboundFlush();
}
