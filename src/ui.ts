import chalk from 'chalk';
import type { SyncMode, SyncStatus, RemoteInspection, SyncEntry, DiffResult, EnvDelta } from './types.js';

// ── Icons via explicit codepoints (avoids encoding loss) ──
const ICONS = {
  folder:    '\u{F024B}',
  file:      '\u{F0214}',
  sync:      '\u{F04E6}',
  check:     '\u{F00C0}',
  cross:     '\u{F00C1}',
  warning:   '\u{F0026}',
  clock:     '\u{F0150}',
  arrow:     '\u{F0054}',
  arrowR:    '\u{F0054}',
  server:    '\u{F048B}',
  service:   '\u{F0868}',
  skill:     '\u{F0C7E}',
  changed:   '\u{F03EB}',
  unchanged: '\u{F012C}',
  delta:     '\u{F0195}',
  lock:      '\u{F033E}',
  unlock:    '\u{F033F}',
  brain:     '\u{F09D1}',
  db:        '\u{F01BC}',
  hash:      '\u{F0565}',
  tree:      '\u{F0645}',
  diff:      '\u{F0410}',
  env:       '\u{F0F5E}',
  separator: '│',
  dot:       '\u25CF',
  pipe:      '─',
  corner:    '╭',
  cornerEnd: '╰',
  tee:       '├',
  lastTee:   '└',
  hLine:     '─',
  vLine:     '│',
} as const;

// ── Color palette — Catppuccin Mocha (matching Yazi theme) ──
const C = {
  accent:    chalk.hex('#89b4fa'),    // Blue
  success:   chalk.hex('#a6e3a1'),    // Green
  warning:   chalk.hex('#f9e2af'),    // Yellow
  error:     chalk.hex('#f38ba8'),    // Red
  info:      chalk.hex('#94e2d5'),    // Teal
  muted:     chalk.hex('#7f849c'),    // Overlay1
  dim:       chalk.hex('#585b70'),    // Surface2
  text:      chalk.hex('#cdd6f4'),    // Text
  bold:      chalk.bold.hex('#cdd6f4'),
  highlight: chalk.hex('#f5c2e7'),    // Pink
};

// ── Box drawing ──
function box(title: string, lines: string[], width = 60): string {
  const top = `${C.dim('╭')}${C.dim('─'.repeat(2))} ${C.bold(title)} ${C.dim('─'.repeat(Math.max(0, width - title.length - 5)))}${C.dim('╮')}`;
  const bot = `${C.dim('╰')}${C.dim('─'.repeat(width))}${C.dim('╯')}`;
  const body = lines.map(l => `${C.dim('│')} ${l}`).join('\n');
  return `${top}\n${body}\n${bot}`;
}

// ── Public API ──

export function header(text: string): void {
  const line = C.dim('━'.repeat(60));
  console.log(`\n${line}`);
  console.log(`  ${ICONS.sync} ${C.bold(text)}`);
  console.log(line);
}

export function subheader(text: string): void {
  console.log(`\n  ${C.accent('▸')} ${C.text(text)}`);
}

export function separator(): void {
  console.log(C.dim('  ' + '─'.repeat(56)));
}

export function serverLabel(name: string): string {
  return `${ICONS.server} ${C.accent(name)}`;
}

export function serviceLabel(name: string): string {
  return `${ICONS.service} ${C.highlight(name)}`;
}

export function skillLabel(name: string): string {
  return `${ICONS.skill} ${C.info(name)}`;
}

export function showSyncTarget(server: string, service: string, path: string): void {
  console.log(`  ${ICONS.tee} ${serverLabel(server)}  ${C.muted('→')}  ${serviceLabel(service)}`);
  console.log(`  ${ICONS.lastTee} ${C.muted(path)}`);
}

export function showSyncMode(mode: SyncMode): void {
  const labels: Record<SyncMode, string> = {
    clean: `${C.error('CLEAN')} ${C.muted('— delete overlapping, fresh copy')}`,
    merge: `${C.success('MERGE')} ${C.muted('— keep remote, update older files')}`,
    smart: `${C.highlight('SMART')} ${C.muted('— diff analysis, preserve env deltas')}`,
  };
  console.log(`  ${ICONS.arrow} Mode: ${labels[mode]}`);
}

export function showRemoteInspection(inspection: RemoteInspection): void {
  const { server, service, remotePath, status, folders } = inspection;
  console.log(`  ${serverLabel(server)} ${C.muted(':')} ${serviceLabel(service)}`);

  if (status === 'unreachable') {
    console.log(`    ${ICONS.cross} ${C.error('unreachable')} ${C.muted(inspection.error || '')}`);
    return;
  }
  if (status === 'none') {
    console.log(`    ${ICONS.check} ${C.success('empty — no directory')}`);
    return;
  }
  if (status === 'empty') {
    console.log(`    ${ICONS.check} ${C.success('empty — no skill folders')}`);
    return;
  }

  const overlap = folders.filter(f => f.isOverlap).length;
  const remoteOnly = folders.filter(f => !f.isOverlap).length;
  console.log(`    ${C.muted(`${folders.length} folder(s):`)} ${C.info(`${overlap} overlap`)} ${C.muted('/')} ${C.warning(`${remoteOnly} remote-only`)}`);

  for (const f of folders) {
    const icon = f.isOverlap ? ICONS.changed : ICONS.unchanged;
    const color = f.isOverlap ? C.info : C.warning;
    console.log(`      ${icon} ${color(f.name)}`);
  }
}

export function showSyncProgress(skill: string, server: string, service: string, status: 'start' | 'done' | 'error' | 'skip', durationMs?: number): void {
  const ts = C.muted(new Date().toLocaleTimeString());
  switch (status) {
    case 'start':
      process.stdout.write(`  ${ts} ${ICONS.sync} ${skillLabel(skill)} ${C.muted('→')} ${serverLabel(server)}:${serviceLabel(service)} `);
      break;
    case 'done':
      console.log(`${C.success('✓')} ${C.muted(durationMs ? `${durationMs}ms` : '')}`);
      break;
    case 'error':
      console.log(`${C.error('✗ failed')}`);
      break;
    case 'skip':
      console.log(`${C.muted('○ skipped (unchanged)')}`);
      break;
  }
}

export function showSkillStatus(name: string, changed: boolean, hash: string, prevHash?: string): void {
  if (changed) {
    console.log(`    ${ICONS.changed} ${C.warning(name)} ${C.muted(ICONS.hash)} ${C.dim(hash.slice(0, 8))} ${C.muted('←')} ${C.dim(prevHash?.slice(0, 8) || 'new')}`);
  } else {
    console.log(`    ${ICONS.unchanged} ${C.success(name)} ${C.muted(ICONS.hash)} ${C.dim(hash.slice(0, 8))}`);
  }
}

export function showDiffResult(diff: DiffResult): void {
  console.log(`\n  ${ICONS.diff} ${skillLabel(diff.skillName)} ${C.muted('diff on')} ${serverLabel(diff.server)}:${serviceLabel(diff.service)}`);

  if (diff.localOnly.length) {
    console.log(`    ${C.success(`+ ${diff.localOnly.length} local-only`)}`);
    for (const f of diff.localOnly.slice(0, 5)) {
      console.log(`      ${C.success('+')} ${f}`);
    }
    if (diff.localOnly.length > 5) console.log(`      ${C.muted(`... +${diff.localOnly.length - 5} more`)}`);
  }

  if (diff.remoteOnly.length) {
    console.log(`    ${C.error(`- ${diff.remoteOnly.length} remote-only`)}`);
    for (const f of diff.remoteOnly.slice(0, 5)) {
      console.log(`      ${C.error('-')} ${f}`);
    }
    if (diff.remoteOnly.length > 5) console.log(`      ${C.muted(`... +${diff.remoteOnly.length - 5} more`)}`);
  }

  if (diff.modified.length) {
    console.log(`    ${C.warning(`~ ${diff.modified.length} modified`)}`);
    for (const f of diff.modified.slice(0, 5)) {
      console.log(`      ${C.warning('~')} ${f.path}`);
    }
    if (diff.modified.length > 5) console.log(`      ${C.muted(`... +${diff.modified.length - 5} more`)}`);
  }

  if (diff.envDeltas.length) {
    console.log(`    ${ICONS.env} ${C.highlight(`${diff.envDeltas.length} env delta(s) detected`)}`);
    for (const d of diff.envDeltas) {
      console.log(`      ${ICONS.lock} ${C.highlight(d.key)} in ${C.muted(d.file)} ${C.muted(`[${d.type}]`)}`);
    }
  }
}

export function showEnvDeltaPreserved(delta: EnvDelta): void {
  console.log(`    ${ICONS.lock} ${C.highlight('preserved')} ${delta.key} in ${C.muted(delta.file)}`);
}

export function showGrokAnalysis(skill: string, analysis: string): void {
  console.log(`\n  ${ICONS.brain} ${C.highlight('Grok Analysis')} for ${skillLabel(skill)}`);
  for (const line of analysis.split('\n')) {
    console.log(`    ${C.muted('│')} ${C.text(line)}`);
  }
}

export function showSessionSummary(entries: SyncEntry[]): void {
  const synced = entries.filter(e => e.status === 'synced').length;
  const unchanged = entries.filter(e => e.status === 'unchanged').length;
  const failed = entries.filter(e => e.status === 'failed').length;
  const skipped = entries.filter(e => e.status === 'skipped').length;
  const totalMs = entries.reduce((s, e) => s + (e.durationMs || 0), 0);

  header('Sync Complete');
  console.log(`  ${C.success(`${ICONS.check} ${synced} synced`)}  ${C.muted(`${ICONS.unchanged} ${unchanged} unchanged`)}  ${failed ? C.error(`${ICONS.cross} ${failed} failed`) : ''}  ${skipped ? C.warning(`○ ${skipped} skipped`) : ''}`);
  console.log(`  ${ICONS.clock} ${C.muted(`Total: ${(totalMs / 1000).toFixed(1)}s`)}`);
}

export function showHistoryEntry(entry: SyncEntry & { sessionMode?: string }): void {
  const ts = C.muted(entry.syncedAt);
  const statusIcon = entry.status === 'synced' ? C.success(ICONS.check) :
    entry.status === 'failed' ? C.error(ICONS.cross) :
    entry.status === 'unchanged' ? C.muted(ICONS.unchanged) : C.warning('○');
  const hashInfo = entry.changed
    ? `${C.dim(entry.prevHash?.slice(0, 8) || '???')} ${C.muted('→')} ${C.info(entry.localHash.slice(0, 8))}`
    : C.dim(entry.localHash.slice(0, 8));

  console.log(`  ${ts} ${statusIcon} ${skillLabel(entry.skillName)} ${C.muted('→')} ${serverLabel(entry.server)}:${serviceLabel(entry.service)} ${hashInfo} ${C.muted(entry.durationMs ? `${entry.durationMs}ms` : '')}`);
}

export function showDeltaMemory(server: string, service: string, skill: string, deltas: Array<{ deltaType: string; description: string; pattern?: string; preserve: boolean }>): void {
  if (!deltas.length) return;
  console.log(`\n  ${ICONS.db} ${C.highlight('Delta Memory')} for ${serverLabel(server)}:${serviceLabel(service)} / ${skillLabel(skill)}`);
  for (const d of deltas) {
    const icon = d.preserve ? ICONS.lock : ICONS.unlock;
    const color = d.preserve ? C.highlight : C.muted;
    console.log(`    ${icon} ${color(d.description)} ${d.pattern ? C.dim(`[${d.pattern}]`) : ''} ${C.muted(`(${d.deltaType})`)}`);
  }
}

export function info(msg: string): void {
  console.log(`  ${ICONS.arrow} ${C.text(msg)}`);
}

export function warn(msg: string): void {
  console.log(`  ${ICONS.warning} ${C.warning(msg)}`);
}

export function error(msg: string): void {
  console.log(`  ${ICONS.cross} ${C.error(msg)}`);
}

export function success(msg: string): void {
  console.log(`  ${ICONS.check} ${C.success(msg)}`);
}

/** Dim/muted inline styling — for secondary text (list snippets, hints). */
export function dim(text: string): string { return C.dim(text); }
export function muted(text: string): string { return C.muted(text); }

export { ICONS, C };
