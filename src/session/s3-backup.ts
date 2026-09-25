// ── 세션 object-storage 백업 (S3 · 2026-07-10) ────────────────────────────
//
// 라이브 세션 관리 S3 잔여(대표 후속 연구 지시): on-disk 세션(~/.monad/sessions/
// {id}.jsonl)을 S3(s3://<bucket>/monad/<monad_id>/sessions/)로 durable 백업.
// 기존 s3.ts(S3_FEATURE_PREFIXES.sessions·uploadFile/downloadFile) 재사용.
//
// 삽입점 = onMessageAppended/onSessionCreated(세션 변경 이벤트). 매 메시지마다 업로드는
// 비싸므로(aws cli spawn) 세션별 디바운스(기본 30s) 후 flush. fail-soft: S3 없으면
// no-op(로컬only). 복원 = loadSession miss 시 또는 CLI 로 downloadFile.

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { sessionRoot, onMessageAppended, onSessionCreated } from './index.js';
import { s3MonadKey, uploadFile, downloadFile, objectExists, isS3Available } from '../storage/s3.js';

/** {id}.jsonl 의 canonical S3 key(per-machine·sessions prefix). */
export function sessionS3Key(id: string): string {
  return s3MonadKey('sessions', `${id}.jsonl`);
}

/** index.json(세션 목록 메타)의 S3 key. */
export function sessionIndexS3Key(): string {
  return s3MonadKey('sessions', 'index.json');
}

/** 세션 파일 1건 업로드(존재할 때). 실패/부재 시 false(fail-soft). */
export function backupSessionFile(id: string, root: string = sessionRoot()): boolean {
  const local = join(root, `${id}.jsonl`);
  if (!existsSync(local)) return false;
  try { uploadFile(local, sessionS3Key(id)); return true; } catch { return false; }
}

/** index.json 업로드(존재할 때). */
export function backupSessionIndex(root: string = sessionRoot()): boolean {
  const local = join(root, 'index.json');
  if (!existsSync(local)) return false;
  try { uploadFile(local, sessionIndexS3Key()); return true; } catch { return false; }
}

/** S3 → 로컬 복원(로컬에 없을 때만). S3 에도 없거나 실패면 false. */
export function restoreSessionFile(id: string, root: string = sessionRoot()): boolean {
  const local = join(root, `${id}.jsonl`);
  if (existsSync(local)) return true; // 이미 있음
  const key = sessionS3Key(id);
  try {
    if (!objectExists(key)) return false;
    downloadFile(key, local);
    return existsSync(local);
  } catch { return false; }
}

// ── 디바운스 트래커(순수·테스트 가능) ─────────────────────────────────────
//
// markDirty 로 변경을 기록하고, due(now) 가 delayMs 이상 조용해진(=마지막 변경 후
// delayMs 경과) 세션 id 를 반환하며 트래킹에서 제거. flush 주기 타이머가 due 를 폴링.

export interface DirtyTracker {
  markDirty(id: string, nowMs: number): void;
  due(nowMs: number, delayMs: number): string[];
  size(): number;
}

export function makeDirtyTracker(): DirtyTracker {
  const lastChange = new Map<string, number>();
  return {
    markDirty(id, nowMs) { lastChange.set(id, nowMs); },
    due(nowMs, delayMs) {
      const out: string[] = [];
      for (const [id, ts] of lastChange) {
        if (nowMs - ts >= delayMs) { out.push(id); lastChange.delete(id); }
      }
      return out;
    },
    size() { return lastChange.size; },
  };
}

export interface SessionS3BackupOpts {
  now?: () => number;
  /** 마지막 변경 후 이 시간 조용하면 백업(기본 30s). */
  debounceMs?: number;
  /** due 폴링 주기(기본 10s). */
  tickMs?: number;
  /** 테스트/특수용 — 실제 업로드 대신 주입(기본 backupSessionFile). */
  backup?: (id: string) => boolean;
  backupIndex?: () => boolean;
  /** setInterval 주입(테스트). */
  setIntervalImpl?: (cb: () => void, ms: number) => { unref?: () => void } | number;
  clearIntervalImpl?: (h: unknown) => void;
}

/** 데몬 부팅에서 1회 — 세션 변경을 디바운스 후 S3 백업. 해제 함수 반환.
 *  S3 미가용이면 no-op(로컬only). fail-soft: 개별 백업 실패는 무시. */
export function wireSessionS3Backup(opts: SessionS3BackupOpts = {}): () => void {
  if (!isS3Available()) return () => { /* S3 없음 — 로컬only */ };

  const now = opts.now ?? Date.now;
  const debounceMs = opts.debounceMs ?? 30_000;
  const tickMs = opts.tickMs ?? 10_000;
  const backup = opts.backup ?? ((id: string) => backupSessionFile(id));
  const backupIdx = opts.backupIndex ?? (() => backupSessionIndex());
  const setIv = opts.setIntervalImpl ?? ((cb, ms) => setInterval(cb, ms));
  const clearIv = opts.clearIntervalImpl ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));

  const tracker = makeDirtyTracker();
  const offAppended = onMessageAppended((id: string) => tracker.markDirty(id, now()));
  const offCreated = onSessionCreated((meta) => tracker.markDirty(meta.id, now()));

  const handle = setIv(() => {
    const due = tracker.due(now(), debounceMs);
    if (!due.length) return;
    let ok = 0;
    for (const id of due) { try { if (backup(id)) ok++; } catch { /* fail-soft */ } }
    if (ok > 0) { try { backupIdx(); } catch { /* fail-soft */ } } // 세션 백업됐으면 목록도 갱신
  }, tickMs);
  if (typeof handle === 'object' && handle.unref) handle.unref(); // 타이머가 프로세스 종료 막지 않게

  return () => {
    offAppended(); offCreated();
    try { clearIv(handle); } catch { /* */ }
  };
}
