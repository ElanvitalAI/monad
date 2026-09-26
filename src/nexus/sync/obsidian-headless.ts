// PLAN-ipad-notes-obsidian-typora §9 Phase O.S (2026-05-17) —
// daemon-side wrapper for the official `obsidian-headless` CLI
// (https://github.com/obsidianmd/obsidian-headless · open beta).
//
// The CLI ships with the same E2E-encryption stack as the Obsidian
// desktop app and uses the user's existing Obsidian Sync subscription.
// elanous daemon shells out for one-shot pushes (after a notes-save) and
// status polls (Notes header pill). Continuous background sync
// (`ob sync --continuous`) is a follow-up that needs a process
// supervisor — this cut keeps things simple with on-demand spawns.
//
// Graceful fail: `ob` is open beta, so most users won't have the binary
// installed yet. `getStatus()` reports `cli-not-installed` instead of
// throwing so the iPad status pill can render an actionable setup
// hint. `which ob` is cached per daemon-process so we don't re-probe
// every poll.

import { spawn } from 'node:child_process';

export interface SyncStatus {
  /** High-level state machine for the iPad status pill. */
  state:
    | 'cli-not-installed'   // no `ob` binary in PATH
    | 'logged-out'          // CLI present but no auth (ob login needed)
    | 'idle'                // last sync OK · ready for next trigger
    | 'syncing'             // in-flight sync (one-shot or continuous)
    | 'error';              // last sync failed · detail in `errorMessage`
  /** Optional vault path the wrapper is currently configured against. */
  vaultPath?: string;
  /** ISO timestamp of the last successful sync, when known. */
  lastSyncAt?: string;
  /** Free-form error detail for the iPad detail sheet. */
  errorMessage?: string;
  /** Path to the `ob` binary discovered in PATH (debug aid). */
  cliPath?: string;
}

export interface ObsidianHeadlessOpts {
  /** Test seam — override the `ob` binary path. nil = which-resolved. */
  obBin?: string;
  /** Test seam — override `which` lookup. */
  whichBin?: string;
  /** Wall-clock seam for tests (lastSyncAt timestamp). */
  now?: () => number;
}

export class ObsidianHeadlessRunner {
  private status: SyncStatus = { state: 'cli-not-installed' };
  private resolvedCliPath: string | null = null;
  private cliProbed = false;
  private inFlightSync: Promise<SyncStatus> | null = null;
  private readonly opts: Required<Pick<ObsidianHeadlessOpts, 'whichBin' | 'now'>> & ObsidianHeadlessOpts;

  constructor(opts: ObsidianHeadlessOpts = {}) {
    this.opts = {
      obBin: opts.obBin,
      whichBin: opts.whichBin ?? 'which',
      now: opts.now ?? (() => Date.now()),
    };
  }

  /** Cached `ob` binary lookup. Returns null when not installed. */
  async resolveCli(): Promise<string | null> {
    if (this.cliProbed) return this.resolvedCliPath;
    this.cliProbed = true;
    if (this.opts.obBin) {
      this.resolvedCliPath = this.opts.obBin;
      return this.resolvedCliPath;
    }
    const path = await this.probeWhich('ob');
    this.resolvedCliPath = path;
    return path;
  }

  /** Configure the vault path the next sync runs against. */
  configure(vaultPath: string): void {
    this.status = { ...this.status, vaultPath };
  }

  /** Latest status snapshot. CLI absence collapses to
   *  `cli-not-installed`; everything else mirrors the most recent
   *  sync attempt. */
  async getStatus(): Promise<SyncStatus> {
    const cli = await this.resolveCli();
    if (!cli) {
      return {
        state: 'cli-not-installed',
        vaultPath: this.status.vaultPath,
        errorMessage: this.status.errorMessage,
      };
    }
    return { ...this.status, cliPath: cli };
  }

  /** One-shot sync. Returns the resulting status. Concurrent calls
   *  share the in-flight Promise so a notes-save burst doesn't spawn
   *  multiple `ob sync` processes against the same vault. */
  async syncOnce(vaultPath?: string): Promise<SyncStatus> {
    const target = vaultPath ?? this.status.vaultPath;
    if (!target) {
      this.status = {
        state: 'error',
        errorMessage: 'vault-path-required',
        vaultPath: undefined,
      };
      return this.status;
    }
    if (this.inFlightSync) {
      return this.inFlightSync;
    }
    this.inFlightSync = this.runSync(target).finally(() => {
      this.inFlightSync = null;
    });
    return this.inFlightSync;
  }

  private async runSync(vaultPath: string): Promise<SyncStatus> {
    const cli = await this.resolveCli();
    if (!cli) {
      this.status = {
        state: 'cli-not-installed',
        vaultPath,
      };
      return this.status;
    }
    this.status = { state: 'syncing', vaultPath, cliPath: cli };
    return await new Promise<SyncStatus>((resolve) => {
      const proc = spawn(cli, ['sync', '--vault', vaultPath]);
      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      proc.on('error', (err: Error) => {
        this.status = {
          state: 'error',
          vaultPath,
          errorMessage: `spawn: ${err.message}`,
          cliPath: cli,
        };
        resolve(this.status);
      });
      proc.on('close', (code: number | null) => {
        if (code === 0) {
          const ts = new Date(this.opts.now()).toISOString();
          this.status = {
            state: 'idle',
            vaultPath,
            lastSyncAt: ts,
            cliPath: cli,
          };
        } else if (this.looksLikeLoggedOut(stderr)) {
          this.status = {
            state: 'logged-out',
            vaultPath,
            errorMessage: stderr.slice(0, 200) || `ob sync exit ${code}`,
            cliPath: cli,
          };
        } else {
          this.status = {
            state: 'error',
            vaultPath,
            errorMessage: stderr.slice(0, 200) || `ob sync exit ${code}`,
            cliPath: cli,
          };
        }
        resolve(this.status);
      });
    });
  }

  private looksLikeLoggedOut(stderr: string): boolean {
    const lower = stderr.toLowerCase();
    return lower.includes('not logged in')
      || lower.includes('login required')
      || lower.includes('unauthorized')
      || lower.includes('please run `ob login`');
  }

  private probeWhich(binary: string): Promise<string | null> {
    return new Promise((resolve) => {
      const proc = spawn(this.opts.whichBin, [binary]);
      let stdout = '';
      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.on('error', () => resolve(null));
      proc.on('close', (code: number | null) => {
        if (code === 0) {
          const found = stdout.split('\n')[0]?.trim();
          resolve(found && found.length > 0 ? found : null);
        } else {
          resolve(null);
        }
      });
    });
  }
}

/** Singleton-per-daemon — server.ts holds one instance for the lifetime
 *  of the process. configure() / syncOnce() / getStatus() are the public
 *  surface; tests construct their own instance with the test seams. */
let sharedRunner: ObsidianHeadlessRunner | null = null;

export function getSharedObsidianHeadless(): ObsidianHeadlessRunner {
  if (!sharedRunner) sharedRunner = new ObsidianHeadlessRunner();
  return sharedRunner;
}

export function _resetSharedObsidianHeadlessForTests(): void {
  sharedRunner = null;
}
