// Live session tail — `elanous session watch`. Renders a session's
// messages as they are appended, in real time, from a SEPARATE process
// than the daemon/agent doing the writing. That cross-process constraint
// is why we watch the on-disk jsonl (fs.watch + a poll backstop) rather
// than the in-process `onMessageAppended` listener (which only fires for
// same-process appends — see src/session/index.ts).
//
// Each append is one jsonl line (SerializedMessage). We track a byte
// offset into the file and parse only the newly-appended tail on each
// change, so a hot session doesn't re-parse O(n) history per event.
//
// `--debug` includes `role:'tool'` rows (⚙️ toolName · args · result),
// which runTurn's tool loop appends live per tool result — so tool calls
// stream in as they execute (for CLI/autopilot sessions that go through
// runTurn; telegram/dashboard-mirrored sessions persist only text).

import { watch, statSync, existsSync, openSync, readSync, closeSync, type FSWatcher } from 'node:fs';
import chalk from 'chalk';
import * as ui from '../ui.js';
import { loadSession, sessionFile, sessionRoot, type SerializedMessage } from './index.js';

const asStr = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));

function truncate(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > n ? oneLine.slice(0, n) + `… (+${oneLine.length - n})` : oneLine;
}

function roleTag(role: SerializedMessage['role']): string {
  switch (role) {
    case 'user': return chalk.cyan.bold('user');
    case 'assistant': return chalk.green.bold('assistant');
    case 'tool': return chalk.yellow('tool');
    case 'system': return chalk.magenta('system');
    default: return role;
  }
}

/** Shorten an ISO ts to `MM-DD HH:MM:SS` for a compact header. */
function shortTs(ts: string): string {
  return (ts || '').replace('T', ' ').replace(/\.\d+Z?$/, '').replace('Z', '').slice(5, 19);
}

type Sink = (line: string) => void;

/** Render one message. Tool rows are shown only when `debug`. `sink`
 *  defaults to console.log; injectable for tests. Returns true if it
 *  emitted anything (false = filtered out). */
export function renderMessage(m: SerializedMessage, debug: boolean, sink: Sink = console.log): boolean {
  if (m.role === 'tool' && !debug) return false;
  sink(`${chalk.dim('──')} ${roleTag(m.role)} ${chalk.dim('@ ' + shortTs(m.ts))} ${chalk.dim('──')}`);
  if (m.role === 'tool') {
    sink(`  ⚙️  ${chalk.yellow(m.toolName ?? '(tool)')}`);
    if (m.toolArgs !== undefined) sink(chalk.dim(`     args:   ${truncate(asStr(m.toolArgs), 300)}`));
    if (m.toolResult !== undefined) sink(chalk.dim(`     result: ${truncate(asStr(m.toolResult), 500)}`));
  } else {
    sink(m.content);
  }
  sink('');
  return true;
}

/** Split a byte-chunk into COMPLETE jsonl lines + the trailing partial
 *  line (which a later chunk completes). Pure — the core of incremental
 *  tailing where a read can land mid-line. */
export function takeCompleteLines(buf: string): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let rest = buf;
  let nl: number;
  while ((nl = rest.indexOf('\n')) >= 0) {
    const line = rest.slice(0, nl);
    rest = rest.slice(nl + 1);
    if (line.trim()) lines.push(line);
  }
  return { lines, rest };
}

export interface WatchSessionOpts {
  debug?: boolean;
  fromStart?: boolean;
  /** How many trailing messages to print for context before following. */
  tail?: number;
}

/** Live-tail `id` until SIGINT. Resolves when the user interrupts. */
export async function watchSession(id: string, opts: WatchSessionOpts = {}): Promise<void> {
  const debug = opts.debug ?? false;
  const tailN = opts.tail ?? 5;
  const file = sessionFile(id);
  const loaded = loadSession(id);

  ui.header(`👁  watch  ${loaded?.meta.title ?? '(session)'}  (${id.slice(0, 8)})`);
  console.log(chalk.dim(
    `live tail — 새 메시지가 도착하면 아래에 흐릅니다`
    + (debug ? ' · ' + chalk.yellow('--debug') + chalk.dim(': 툴콜 포함') : '')
    + '. Ctrl-C 로 종료.',
  ));
  console.log('');

  // Existing context: a short tail by default, full transcript with
  // --from-start. Tool rows are still filtered here unless --debug.
  const msgs = loaded?.messages ?? [];
  const start = opts.fromStart ? 0 : Math.max(0, msgs.length - tailN);
  if (start > 0) console.log(chalk.dim(`  … 이전 ${start}개 메시지 생략 (--from-start 로 전체) …\n`));
  for (const m of msgs.slice(start)) renderMessage(m, debug);
  console.log(chalk.dim('  ⏳ 대기 중 — 라이브 메시지를 기다립니다…\n'));

  // Byte offset into the jsonl; we only parse bytes appended past it.
  let offset = existsSync(file) ? statSync(file).size : 0;
  let buf = '';

  const drain = (): void => {
    if (!existsSync(file)) return;
    let size: number;
    try { size = statSync(file).size; } catch { return; }
    if (size < offset) { offset = 0; buf = ''; } // rotated/truncated — restart
    if (size <= offset) return;
    const len = size - offset;
    const b = Buffer.alloc(len);
    let fd: number;
    try { fd = openSync(file, 'r'); } catch { return; }
    try { readSync(fd, b, 0, len, offset); } finally { closeSync(fd); }
    offset = size;
    buf += b.toString('utf8');
    const { lines, rest } = takeCompleteLines(buf);
    buf = rest;
    for (const line of lines) {
      try { renderMessage(JSON.parse(line) as SerializedMessage, debug); } catch { /* malformed — skip */ }
    }
  };

  return new Promise<void>((resolve) => {
    // Watch the session DIRECTORY (not the file) so a 0-message session
    // whose jsonl doesn't exist yet is still picked up on first append.
    const fname = `${id}.jsonl`;
    let watcher: FSWatcher | null = null;
    try {
      watcher = watch(sessionRoot(), (_event, filename) => {
        if (!filename || filename === fname) drain();
      });
    } catch { /* fs.watch unsupported — the poll backstop below covers it */ }

    // Poll backstop — fs.watch can coalesce/miss events on some
    // filesystems; drain() is offset-idempotent so an extra call is free.
    const poll = setInterval(drain, 1000);

    const stop = (): void => {
      clearInterval(poll);
      try { watcher?.close(); } catch { /* noop */ }
      process.off('SIGINT', stop);
      console.log(chalk.dim('\n⏹  watch 종료.'));
      resolve();
    };
    process.on('SIGINT', stop);
  });
}
