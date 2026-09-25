import { $ } from 'bun';
import { join } from 'path';
import { mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import { LOCAL_SKILLS_DIR, SERVICES, RSYNC_EXCLUDES, isLocalSyncServer } from './config.js';
import { hashSkill } from './hasher.js';
import { createSession, completeSession, insertEntry, getSnapshot, upsertSnapshot } from './db.js';
import { smartSync, analyzeAndRememberPatterns } from './smart.js';
import * as ui from './ui.js';
import type { SyncMode, SyncEntry, DiffResult } from './types.js';

export function getLocalSkills(): string[] {
  try {
    return readdirSync(LOCAL_SKILLS_DIR)
      .filter(name => {
        if (name.startsWith('.')) return false;
        // Check exact matches (strip trailing slash) and glob patterns
        for (const excl of RSYNC_EXCLUDES) {
          const clean = excl.replace(/\/+$/, '');
          if (clean.includes('*')) {
            const re = new RegExp('^' + clean.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
            if (re.test(name)) return false;
          } else if (name === clean) {
            return false;
          }
        }
        const fullPath = join(LOCAL_SKILLS_DIR, name);
        try { return statSync(fullPath).isDirectory(); } catch { return false; }
      })
      .sort();
  } catch {
    return [];
  }
}

export function buildRsyncArgs(mode: SyncMode, extraExcludes: string[] = []): string[] {
  const args = ['-avzL', '--progress'];
  if (mode === 'merge') args.push('--update');

  for (const excl of RSYNC_EXCLUDES) {
    args.push(`--exclude=${excl}`);
  }
  for (const excl of extraExcludes) {
    args.push(`--exclude=${excl}`);
  }

  return args;
}

export function resolveRsyncDestination(server: string, targetPath: string): string {
  return isLocalSyncServer(server) ? targetPath : `${server}:${targetPath}`;
}

async function doRsync(
  srcDir: string,
  server: string,
  targetPath: string,
  mode: SyncMode,
  extraExcludes: string[] = [],
): Promise<{ success: boolean; output: string }> {
  const args = buildRsyncArgs(mode, extraExcludes);

  // Ensure trailing slash on src for rsync
  const src = srcDir.endsWith('/') ? srcDir : srcDir + '/';
  const dest = resolveRsyncDestination(server, targetPath);

  try {
    if (isLocalSyncServer(server)) {
      mkdirSync(targetPath, { recursive: true });
    } else {
      // Ensure remote directory exists
      await $`ssh ${server} mkdir -p '${targetPath}'`.quiet();
    }

    const result = await $`rsync ${args} ${src} ${dest}`.quiet();
    return { success: true, output: result.text() };
  } catch (err: any) {
    return { success: false, output: err.stderr?.toString() || String(err) };
  }
}

async function cleanRemoteSkill(server: string, remotePath: string, skillName: string): Promise<void> {
  const fullPath = `${remotePath}${skillName}`;
  try {
    if (isLocalSyncServer(server)) {
      rmSync(fullPath, { recursive: true, force: true });
      return;
    }
    await $`ssh ${server} ${`[ -d '${fullPath}' ] && rm -rf '${fullPath}' && echo 'deleted: ${skillName}'`}`.quiet();
  } catch {
    // directory might not exist, that's fine
  }
}

export interface SyncOptions {
  servers: string[];
  services: string[];
  skills: string[];
  mode: SyncMode;
}

export async function executeSync(opts: SyncOptions): Promise<SyncEntry[]> {
  const { servers, services, skills, mode } = opts;

  // Create session
  const sessionId = createSession({
    startedAt: new Date().toISOString(),
    mode,
    servers,
    services,
    skills,
  });

  ui.header(`Sync Session #${sessionId}`);
  ui.showSyncMode(mode);
  ui.info(`${skills.length} skill(s) → ${servers.length} server(s) × ${services.length} service(s)`);
  ui.separator();

  const entries: SyncEntry[] = [];
  const allDiffs = new Map<string, DiffResult[]>(); // key: server:service

  for (const server of servers) {
    for (const service of services) {
      const remotePath = SERVICES[service];
      const targetKey = `${server}:${service}`;
      allDiffs.set(targetKey, []);

      ui.subheader(`${server} → ${service}`);

      for (const skillName of skills) {
        const startTime = Date.now();
        const localDir = join(LOCAL_SKILLS_DIR, skillName);
        const skillInfo = hashSkill(localDir);

        // Check previous snapshot
        const snapshot = getSnapshot(skillName, server, service);
        const prevHash = snapshot?.hash;
        const changed = !prevHash || prevHash !== skillInfo.hash;

        ui.showSkillStatus(skillName, changed, skillInfo.hash, prevHash);

        // In smart mode with no changes, skip
        if (mode === 'smart' && !changed) {
          ui.showSyncProgress(skillName, server, service, 'skip');
          entries.push(createEntry(sessionId, skillName, server, service, skillInfo.hash, prevHash, 'unchanged', false, skillInfo, 0));
          continue;
        }

        let extraExcludes: string[] = [];
        let diffSummary: string | undefined;

        // Smart mode: compute diff and detect env deltas
        if (mode === 'smart') {
          try {
            const smartResult = await smartSync(skillName, server, service, localDir);
            extraExcludes = smartResult.excludeFiles;
            allDiffs.get(targetKey)!.push(smartResult.diff);

            if (smartResult.diff.envDeltas.length > 0) {
              diffSummary = `${smartResult.diff.envDeltas.length} env delta(s), ${extraExcludes.length} file(s) preserved`;
            }
          } catch (err) {
            ui.warn(`Smart analysis failed for ${skillName}: ${err}`);
          }
        }

        // Execute sync
        ui.showSyncProgress(skillName, server, service, 'start');

        if (mode === 'clean') {
          await cleanRemoteSkill(server, remotePath, skillName);
        }

        const { success, output } = await doRsync(
          localDir,
          server,
          `${remotePath}${skillName}/`,
          mode,
          extraExcludes,
        );

        const durationMs = Date.now() - startTime;

        if (success) {
          ui.showSyncProgress(skillName, server, service, 'done', durationMs);

          // Update snapshot
          upsertSnapshot({
            skillName,
            server,
            service,
            hash: skillInfo.hash,
            fileTree: JSON.stringify(skillInfo.fileTree),
            syncedAt: new Date().toISOString(),
          });
        } else {
          ui.showSyncProgress(skillName, server, service, 'error');
          ui.error(output);
        }

        entries.push(createEntry(
          sessionId, skillName, server, service,
          skillInfo.hash, prevHash,
          success ? 'synced' : 'failed',
          changed, skillInfo, durationMs, diffSummary,
        ));
      }
    }
  }

  // Smart mode: analyze cross-skill patterns per target
  if (mode === 'smart') {
    for (const [targetKey, diffs] of allDiffs) {
      const [server, service] = targetKey.split(':');
      await analyzeAndRememberPatterns(server, service, diffs);
    }
  }

  // Complete session
  completeSession(sessionId);

  // Show summary
  ui.showSessionSummary(entries);

  return entries;
}

function createEntry(
  sessionId: number, skillName: string, server: string, service: string,
  localHash: string, prevHash: string | undefined,
  status: SyncEntry['status'], changed: boolean,
  skillInfo: { fileCount: number; totalBytes: number },
  durationMs: number, diffSummary?: string,
): SyncEntry {
  const entry: SyncEntry = {
    sessionId,
    skillName,
    server,
    service,
    localHash,
    prevHash,
    status,
    changed,
    fileCount: skillInfo.fileCount,
    totalBytes: skillInfo.totalBytes,
    durationMs,
    diffSummary,
    syncedAt: new Date().toISOString(),
  };

  insertEntry(entry);
  return entry;
}
