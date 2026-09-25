// 대화 전사 내보내기 — 공유 순수함수 (PLAN 1-D · 2026-07-24).
//
// 레포 관례("단일 창구") — dispatchSessionQuery 처럼 CLI(`monad session export`)·
// TUI(`/export`)·(후속) 텔레그램이 이 한 함수를 공유한다. 세션 JSONL(또는 라이브
// TUI history)을 마크다운 전사로 렌더해 홈 하위 경로에 쓴다.
//
// 안전: 홈 밖 경로는 거부(resolveTargetKind → 'outside-home'). 기본 경로
// `~/temp/monad-transcript-<stamp>.md`(대표 지시). `~` 확장은 단일 resolveHome.

import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { resolveHome } from '../context.js';
import { timestampSlug } from '../artifact/paths.js';
import { resolveTargetKind } from '../self-implement/target-kind.js';
import {
  historyFromSession,
  resolveSessionId,
  getActiveSessionId,
  sessionRoot,
  type SessionMeta,
} from './index.js';

export type ExportTranscriptRole = 'user' | 'assistant' | 'system';
export interface ExportTranscriptMessage {
  role: ExportTranscriptRole;
  content: string;
}

export interface ExportTranscriptOpts {
  /** 세션 id 또는 고유 prefix. 없으면 활성 세션. history 를 직접 주면 무시. */
  sessionId?: string;
  /** 라이브 전사(TUI chat.history 평탄화분) — 있으면 디스크 조회 대신 이걸 렌더. */
  history?: ExportTranscriptMessage[];
  /** history 직접 주입 시 헤더용 메타(선택). */
  meta?: Partial<SessionMeta>;
  /** 대상 경로(파일 또는 디렉토리 · `~` 확장). 없으면 기본 경로. */
  to?: string;
  /** 출력 포맷 — 현재 md 만. */
  format?: 'md';
  /** 기준 시각(ms) — 테스트 주입. 기본 Date.now(). */
  nowMs?: number;
  /** 홈 경계 — 테스트 주입. 기본 homedir(). */
  home?: string;
  /** 세션 스토어 root — 테스트 주입. */
  root?: string;
}

export interface ExportTranscriptResult {
  path: string;
  /** 파일 총 줄 수. */
  lines: number;
  /** 렌더된 대화 메시지 수(tool row·빈 줄 제외). */
  messages: number;
  title: string;
}

/** `ROLE` 표시명 — 헤딩용. */
function roleLabel(role: ExportTranscriptRole): string {
  return role === 'user' ? 'User' : role === 'assistant' ? 'Assistant' : 'System';
}

/** 전사 → 마크다운. `# title` + 메타 불릿 + `---` + 메시지별 `## Role` 블록.
 *  (research-bridge/store.ts 조립 전례를 따름 · ANSI 없음.) */
function renderMarkdown(
  title: string,
  meta: Partial<SessionMeta> | undefined,
  history: ExportTranscriptMessage[],
  atMs: number,
): string {
  const lines: string[] = [];
  lines.push(`# ${title || '(untitled session)'}`);
  lines.push('');
  const bullets: string[] = [];
  if (meta?.id) bullets.push(`- **session:** ${meta.id}`);
  if (meta?.source) bullets.push(`- **source:** ${meta.source}${meta.origin ? ` (${meta.origin})` : ''}`);
  if (meta?.model) bullets.push(`- **model:** ${meta.provider ? `${meta.provider}/` : ''}${meta.model}`);
  if (meta?.createdAt) bullets.push(`- **created:** ${meta.createdAt}`);
  if (meta?.updatedAt) bullets.push(`- **updated:** ${meta.updatedAt}`);
  bullets.push(`- **messages:** ${history.length}`);
  bullets.push(`- **exported:** ${new Date(atMs).toISOString()}`);
  lines.push(...bullets);
  lines.push('');
  lines.push('---');
  lines.push('');
  for (const m of history) {
    lines.push(`## ${roleLabel(m.role)}`);
    lines.push('');
    lines.push(m.content.trimEnd());
    lines.push('');
  }
  return lines.join('\n');
}

/** 대상 파일 경로 결정. 디렉토리를 주면 기본 파일명을 그 안에 만든다. */
function resolveTargetPath(to: string | undefined, atMs: number, home: string): string {
  const stamp = timestampSlug(atMs);
  const defaultName = `monad-transcript-${stamp}.md`;
  if (!to || !to.trim()) {
    return join(home, 'temp', defaultName);
  }
  const expanded = resolveHome(to.trim());
  // 기존 디렉토리를 주면 그 안에 기본 파일명.
  if (existsSync(expanded) && statSync(expanded).isDirectory()) {
    return join(expanded, defaultName);
  }
  // 확장자 없는 신규 경로도 디렉토리 취급하지 않는다(사용자가 파일명 의도).
  return expanded;
}

/** 대화 전사를 마크다운 파일로 내보낸다. history(라이브) 우선, 없으면 세션 디스크. */
export function exportSessionTranscript(opts: ExportTranscriptOpts = {}): ExportTranscriptResult {
  const atMs = opts.nowMs ?? Date.now();
  const home = opts.home ?? homedir();
  const root = opts.root ?? sessionRoot();

  // ── 전사 소스 해소 (라이브 history 1순위 → 디스크 세션) ──
  let title = '';
  let meta: Partial<SessionMeta> | undefined = opts.meta;
  let history: ExportTranscriptMessage[];
  const liveHistory = (opts.history ?? []).filter(m => m.content && m.content.trim());
  if (liveHistory.length > 0) {
    history = liveHistory;
    title = meta?.title ?? 'session transcript';
  } else {
    let id: string | null;
    if (opts.sessionId) {
      try { id = resolveSessionId(opts.sessionId, root); }
      catch (e) { throw new Error(e instanceof Error ? e.message : String(e)); }
    } else {
      id = getActiveSessionId();
    }
    if (!id) throw new Error('no session to export (id·prefix 를 주거나 활성 세션이 필요).');
    const loaded = historyFromSession(id, root);
    if (!loaded) throw new Error(`session not found: ${opts.sessionId ?? id}`);
    meta = loaded.meta;
    title = loaded.meta.title || 'session transcript';
    history = loaded.history;
  }

  // ── 대상 경로 + 안전 게이트 ──
  const target = resolveTargetPath(opts.to, atMs, home);
  if (resolveTargetKind(target, home) === 'outside-home') {
    throw new Error(`refusing to write outside home: ${target}`);
  }

  const md = renderMarkdown(title, meta, history, atMs);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, md.endsWith('\n') ? md : md + '\n', 'utf8');
  return {
    path: target,
    lines: md.split('\n').length,
    messages: history.length,
    title,
  };
}
