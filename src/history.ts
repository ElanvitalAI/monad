import { getRecentSessions, getEntriesForSession, getSkillHistory, getTargetHistory, getAllSnapshots, getAllDeltas } from './db.js';
import { hashSkill } from './hasher.js';
import { LOCAL_SKILLS_DIR } from './config.js';
import { join } from 'path';
import * as ui from './ui.js';

export function showRecentHistory(limit = 10): void {
  const sessions = getRecentSessions(limit);

  if (!sessions.length) {
    ui.info('No sync history found.');
    return;
  }

  ui.header('Recent Sync Sessions');

  for (const session of sessions) {
    const duration = session.completedAt
      ? `${((new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime()) / 1000).toFixed(1)}s`
      : 'incomplete';

    console.log(`\n  ${ui.C.muted('#' + session.id)} ${ui.C.text(session.startedAt)} ${ui.C.accent(session.mode)} ${ui.C.muted(duration)}`);
    console.log(`    ${ui.ICONS.server} ${session.servers.join(', ')}  ${ui.ICONS.service} ${session.services.join(', ')}  ${ui.ICONS.skill} ${session.skills.length} skill(s)`);

    const entries = getEntriesForSession(session.id!);
    const synced = entries.filter(e => e.status === 'synced').length;
    const failed = entries.filter(e => e.status === 'failed').length;
    const unchanged = entries.filter(e => e.status === 'unchanged').length;
    console.log(`    ${ui.C.success(`${synced} synced`)} ${ui.C.muted(`${unchanged} unchanged`)} ${failed ? ui.C.error(`${failed} failed`) : ''}`);
  }
}

export function showSessionDetail(sessionId: number): void {
  const entries = getEntriesForSession(sessionId);
  if (!entries.length) {
    ui.error(`No entries found for session #${sessionId}`);
    return;
  }

  ui.header(`Session #${sessionId} Detail`);

  for (const entry of entries) {
    ui.showHistoryEntry(entry);
    if (entry.diffSummary) {
      console.log(`    ${ui.C.muted(entry.diffSummary)}`);
    }
  }
}

export function showSkillDetail(skillName: string, server?: string, service?: string): void {
  const history = getSkillHistory(skillName, server, service);

  if (!history.length) {
    ui.info(`No history found for skill: ${skillName}`);
    return;
  }

  ui.header(`History: ${skillName}`);

  for (const entry of history) {
    ui.showHistoryEntry(entry);
  }
}

export function showTargetDetail(server: string, service: string): void {
  const history = getTargetHistory(server, service);

  if (!history.length) {
    ui.info(`No history found for ${server}:${service}`);
    return;
  }

  ui.header(`History: ${server} → ${service}`);

  for (const entry of history) {
    ui.showHistoryEntry(entry);
  }
}

export function showStatus(): void {
  const snapshots = getAllSnapshots();
  const deltas = getAllDeltas();

  if (!snapshots.length) {
    ui.info('No snapshots found. Run a sync first.');
    return;
  }

  ui.header('Current Status');

  // Group by server:service
  const groups = new Map<string, typeof snapshots>();
  for (const snap of snapshots) {
    const key = `${snap.server}:${snap.service}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(snap);
  }

  // Cache hashes per skill to avoid O(n²) rehashing
  const hashCache = new Map<string, string>();

  for (const [key, snaps] of groups) {
    const [server, service] = key.split(':');
    console.log(`\n  ${ui.serverLabel(server)} → ${ui.serviceLabel(service)} (${snaps.length} skills)`);

    for (const snap of snaps) {
      // Compute current hash with cache
      let currentHash = hashCache.get(snap.skillName);
      if (currentHash === undefined) {
        const skillDir = join(LOCAL_SKILLS_DIR, snap.skillName);
        try {
          currentHash = hashSkill(skillDir).hash;
        } catch {
          currentHash = 'unavailable';
        }
        hashCache.set(snap.skillName, currentHash);
      }

      const changed = currentHash !== snap.hash;
      const age = timeSince(new Date(snap.syncedAt));

      if (changed) {
        console.log(`    ${ui.ICONS.changed} ${ui.C.warning(snap.skillName)} ${ui.C.muted('changed since')} ${ui.C.muted(age + ' ago')}`);
        console.log(`      ${ui.C.dim(snap.hash.slice(0, 8))} ${ui.C.muted('→')} ${ui.C.warning(currentHash.slice(0, 8))}`);
      } else {
        console.log(`    ${ui.ICONS.unchanged} ${ui.C.success(snap.skillName)} ${ui.C.muted('synced ' + age + ' ago')}`);
      }
    }
  }

  // Show delta memory
  if (deltas.length) {
    ui.header('Delta Memory');
    const deltaGroups = new Map<string, typeof deltas>();
    for (const d of deltas) {
      const key = `${d.server}:${d.service}`;
      if (!deltaGroups.has(key)) deltaGroups.set(key, []);
      deltaGroups.get(key)!.push(d);
    }

    for (const [key, ds] of deltaGroups) {
      const [server, service] = key.split(':');
      ui.showDeltaMemory(server, service, 'all', ds.map(d => ({
        deltaType: d.deltaType,
        description: d.description,
        pattern: d.pattern,
        preserve: !!d.preserve,
      })));
    }
  }
}

function timeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
