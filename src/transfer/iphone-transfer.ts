// iPhone transfer backend — T5-J4.
//
// Two transports with auto-preference:
//
//   1. Tailscale TailDrop — `tailscale file cp <file> <host>:`
//      Zero-config once the iPhone is on the tailnet. iOS shows a
//      notification; user taps and saves to Files/Photos. Works
//      for any file type including images.
//
//   2. Pushcut HTTP fallback — spin up a short-lived Bun.serve on
//      127.0.0.1:<port> with a random URL token, send a Pushcut
//      notification with the URL, iOS Shortcut downloads via GET.
//      Works when tailscale isn't available but Pushcut is.
//
// Preference is auto-decided per transfer:
//   • target.tailscaleHost set AND `tailscale version` probe passes
//     → tailscale
//   • else if target.pushcutName → pushcut-serve fallback
//   • else → return no-transport error
//
// The HTTP server binds to 127.0.0.1 by default (same as T1-P3's
// HITL server) so it only works when the user's iOS Shortcut hits
// localhost — which won't happen over tailscale. For a real
// cross-device fallback the server must bind to the tailscale
// interface address. That's deferred to follow-up since it needs
// `tailscale ip -4` probing + firewall awareness; for now the
// fallback is local-only (Wi-Fi hotspot + shortcut on same box).

import { spawn } from 'node:child_process';
import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { TransferTarget } from './transfer-targets.js';
import { getPushcutClient } from '../pushcut/client.js';

export type IphoneTransport = 'tailscale' | 'pushcut';

export interface IphoneTransferOpts {
  target: Extract<TransferTarget, { kind: 'iphone' }>;
  files: Array<{ localPath: string; size?: number }>;
  /** Override for tailscale probe + pushcut client (tests). */
  deps?: IphoneTransferDeps;
  /** URL token length for the Pushcut fallback. Default 32 hex
   *  chars = 128 bits of entropy. */
  tokenBytes?: number;
  /** Server bind host for the Pushcut fallback. Default 127.0.0.1.
   *  Set to the tailscale address for real cross-device flows. */
  bindHost?: string;
  /** Server port for the Pushcut fallback. 0 = OS-assigned. */
  bindPort?: number;
  /** Default 5 minutes of validity for the URL token. */
  serveTimeoutMs?: number;
}

export interface IphoneTransferDeps {
  spawnImpl?: typeof spawn;
  /** When set, skips the actual `tailscale version` probe and
   *  returns this value. Tests inject; production calls the real
   *  CLI. */
  tailscaleAvailable?: () => Promise<boolean> | boolean;
  /** Override the Pushcut singleton (tests). */
  pushcutClient?: ReturnType<typeof getPushcutClient>;
  /** Override server creation (tests). */
  httpServerFactory?: (handler: (req: IncomingMessage, res: ServerResponse) => void) => Server;
}

export type IphoneTransferResult =
  | {
      ok: true;
      transport: IphoneTransport;
      uploaded: string[];
      /** Populated only for pushcut fallback — URL the iOS
       *  Shortcut hits. Expires after serveTimeoutMs. */
      pushcutUrls?: string[];
    }
  | {
      ok: false;
      reason: 'no-transport' | 'tailscale-failed' | 'pushcut-failed' | 'config-missing';
      message: string;
    };

async function probeTailscale(deps: IphoneTransferDeps): Promise<boolean> {
  if (deps.tailscaleAvailable) return !!(await deps.tailscaleAvailable());
  const spawner = deps.spawnImpl ?? spawn;
  return new Promise<boolean>((resolve) => {
    const child = spawner('tailscale', ['version'], { stdio: ['ignore', 'ignore', 'ignore'] });
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } resolve(false); }, 1500);
    if (typeof (t as { unref?: () => void }).unref === 'function') (t as unknown as { unref: () => void }).unref();
    child.on('error', () => { clearTimeout(t); resolve(false); });
    child.on('close', (code) => { clearTimeout(t); resolve(code === 0); });
  });
}

function runTailscaleCp(
  tailscaleHost: string,
  localPath: string,
  deps: IphoneTransferDeps,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const spawner = deps.spawnImpl ?? spawn;
  return new Promise((resolve) => {
    const child = spawner('tailscale', ['file', 'cp', localPath, `${tailscaleHost}:`], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (b: Buffer) => { stderr += b.toString('utf-8'); });
    child.on('error', (err) => resolve({ ok: false, message: err.message }));
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, message: stderr.trim() || `tailscale exit ${code}` });
    });
  });
}

interface PushcutServedFile {
  token: string;
  localPath: string;
  expiresAt: number;
}

function buildPushcutUrl(host: string, port: number, token: string, fname: string): string {
  const safeName = encodeURIComponent(fname);
  return `http://${host}:${port}/xfer/${token}/${safeName}`;
}

function httpHandler(registry: Map<string, PushcutServedFile>): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const url = req.url ?? '';
    const m = url.match(/^\/xfer\/([a-f0-9]+)\/(.+)$/);
    if (!m) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    const token = m[1]!;
    const file = registry.get(token);
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('unknown token');
      return;
    }
    if (file.expiresAt < Date.now()) {
      res.writeHead(410, { 'content-type': 'text/plain' });
      res.end('expired');
      return;
    }
    try {
      const stat = statSync(file.localPath);
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(stat.size),
        'content-disposition': `attachment; filename="${basename(file.localPath)}"`,
      });
      const stream = createReadStream(file.localPath);
      stream.pipe(res);
      stream.on('error', () => { try { res.end(); } catch { /* ignore */ } });
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(err instanceof Error ? err.message : 'read error');
    }
  };
}

/** Start a short-lived HTTP server serving the given files; each
 *  gets a random token URL. Returns the URLs + a stop() that kills
 *  the server (auto-stops after serveTimeoutMs too). */
export async function servePushcutFiles(
  files: IphoneTransferOpts['files'],
  opts: { tokenBytes: number; bindHost: string; bindPort: number; serveTimeoutMs: number },
  deps: IphoneTransferDeps = {},
): Promise<{ urls: string[]; port: number; stop: () => Promise<void> } | { error: string }> {
  const registry = new Map<string, PushcutServedFile>();
  const now = Date.now();
  const urls: string[] = [];
  for (const f of files) {
    const token = randomBytes(opts.tokenBytes).toString('hex');
    registry.set(token, {
      token,
      localPath: f.localPath,
      expiresAt: now + opts.serveTimeoutMs,
    });
  }
  const factory = deps.httpServerFactory ?? createServer;
  const handler = httpHandler(registry);
  const server = factory(handler);
  try {
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(opts.bindPort, opts.bindHost, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr) resolve(addr.port);
        else reject(new Error('listen: no address'));
      });
    });
    for (const [token, f] of registry) {
      urls.push(buildPushcutUrl(opts.bindHost, port, token, basename(f.localPath)));
    }
    const stopTimer = setTimeout(() => {
      try { server.close(); } catch { /* ignore */ }
      (server as { closeAllConnections?: () => void }).closeAllConnections?.();
    }, opts.serveTimeoutMs);
    if (typeof (stopTimer as { unref?: () => void }).unref === 'function') {
      (stopTimer as unknown as { unref: () => void }).unref();
    }
    const stop = async (): Promise<void> => {
      clearTimeout(stopTimer);
      await new Promise<void>((resolve) => {
        try { server.close(() => resolve()); (server as { closeAllConnections?: () => void }).closeAllConnections?.(); }
        catch { resolve(); }
      });
    };
    return { urls, port, stop };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function iphoneTransfer(
  opts: IphoneTransferOpts,
): Promise<IphoneTransferResult> {
  const deps = opts.deps ?? {};
  const target = opts.target;

  // Prefer tailscale when configured + probe passes.
  if (target.tailscaleHost) {
    const available = await probeTailscale(deps);
    if (available) {
      const errs: string[] = [];
      const uploaded: string[] = [];
      for (const f of opts.files) {
        const r = await runTailscaleCp(target.tailscaleHost, f.localPath, deps);
        if (r.ok) uploaded.push(f.localPath);
        else errs.push(`${basename(f.localPath)}: ${r.message}`);
      }
      if (errs.length === 0) {
        return { ok: true, transport: 'tailscale', uploaded };
      }
      return {
        ok: false,
        reason: 'tailscale-failed',
        message: errs.join('; '),
      };
    }
    // Probe failed → fall through to pushcut if also configured.
  }

  if (!target.pushcutName) {
    return {
      ok: false,
      reason: 'no-transport',
      message: target.tailscaleHost
        ? 'tailscale unavailable and no pushcutName configured'
        : 'no transport configured for this target',
    };
  }

  const pushcut = deps.pushcutClient ?? getPushcutClient();
  if (!pushcut.configured) {
    return {
      ok: false,
      reason: 'config-missing',
      message: 'Pushcut is not configured (missing api key). Run `elanous setup` or configure Pushcut in your user config.',
    };
  }

  const served = await servePushcutFiles(opts.files, {
    tokenBytes: opts.tokenBytes ?? 16,
    bindHost: opts.bindHost ?? '127.0.0.1',
    bindPort: opts.bindPort ?? 0,
    serveTimeoutMs: opts.serveTimeoutMs ?? 5 * 60_000,
  }, deps);
  if ('error' in served) {
    return { ok: false, reason: 'pushcut-failed', message: `http server: ${served.error}` };
  }

  // Fire one Pushcut notification per file, with the URL + filename
  // in the body. The iOS Shortcut (elanous-file-received) picks up
  // the URL and downloads.
  for (let i = 0; i < opts.files.length; i++) {
    const f = opts.files[i]!;
    const url = served.urls[i]!;
    const r = await pushcut.notify(target.pushcutName, {
      title: `File from Elanous — ${basename(f.localPath)}`,
      text: `Size: ${f.size ?? 'unknown'} bytes`,
      input: url,
    });
    if (!r.ok) {
      await served.stop();
      return {
        ok: false,
        reason: 'pushcut-failed',
        message: `Pushcut notify failed: ${r.reason ?? 'unknown'}`,
      };
    }
  }

  return {
    ok: true,
    transport: 'pushcut',
    uploaded: opts.files.map(f => f.localPath),
    pushcutUrls: served.urls,
  };
}

export const _exportsForTesting = {
  probeTailscale,
  runTailscaleCp,
  buildPushcutUrl,
  shaHex: (s: string) => createHash('sha256').update(s).digest('hex'),
};
