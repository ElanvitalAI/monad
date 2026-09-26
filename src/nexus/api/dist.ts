// dist.ts — ad-hoc IPA + manifest.plist OTA distribution endpoints
// (Stage B remote install · 2026-05-18).
//
// iOS Safari can install an enterprise/ad-hoc IPA by tapping a link of
// the form:
//
//   itms-services://?action=download-manifest&url=https://<host>/v1/dist/manifest.plist
//
// The manifest is a small XML document that points at the IPA and
// declares bundle-id / version / title. Both files have to be served
// over HTTPS; the Tailscale Serve TLS terminator we already run
// (`pwa share enable` → `https://mbp.tailnet-example.ts.net:31415/...`)
// satisfies that requirement at zero additional cost.
//
// Files live under `~/.elanous/dist/`:
//
//   ~/.elanous/dist/
//     ├─ ElanousiOS.ipa     ← the artifact published via `elanous nexus dist publish`
//     └─ dist.json        ← bundle metadata (bundleId · version · title · file)
//
// The endpoints intentionally bypass bearer-token auth — iOS Safari
// can't attach an Authorization header to the manifest fetch initiated
// by `itms-services://`. The Tailscale tailnet boundary is the only
// access control we get; this matches what `pwa share enable` already
// exposes for the PWA itself.

import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DIST_DIR = join(homedir(), '.elanous', 'dist');
export const DIST_META_FILE = 'dist.json';
// ⛔ 값은 «잎»이 갖는다 — 이유는 `rest-route-paths.ts` 머리말.
import { IPA_PATH_PREFIX, MANIFEST_PATH } from './rest-route-paths.js';
export { IPA_PATH_PREFIX, MANIFEST_PATH };

/** dist.json on disk · written by `elanous nexus dist publish`. */
export interface DistMeta {
  /** File name (no path) under ~/.elanous/dist · e.g. "ElanousiOS.ipa". */
  file: string;
  bundleId: string;
  /** CFBundleShortVersionString — human-readable (e.g. "1.0"). */
  version: string;
  /** CFBundleVersion — build number (e.g. "1"). */
  build?: string;
  /** Title shown in Safari install confirmation (e.g. "Elanous"). */
  title: string;
  /** Optional 512x512 PNG URL · iOS Safari uses it during install. */
  displayImageUrl?: string;
  /** Optional 1024x1024 PNG URL · iOS Safari uses post-install. */
  fullSizeImageUrl?: string;
  /** ISO timestamp of last publish. */
  publishedAt: string;
}

/** Read dist.json. Returns null when nothing has been published yet. */
export async function readDistMeta(): Promise<DistMeta | null> {
  try {
    const raw = await readFile(join(DIST_DIR, DIST_META_FILE), 'utf8');
    const parsed = JSON.parse(raw) as DistMeta;
    if (!parsed.file || !parsed.bundleId || !parsed.version || !parsed.title) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Resolve the externally-reachable origin Safari should hit. We trust the
 *  request's `Host` header — Tailscale Serve forwards it verbatim, and
 *  loopback callers pass `127.0.0.1:31415` which also works (it just won't
 *  let iOS install since Safari rejects loopback for itms-services).
 *  Always emits `https://` because iOS Safari refuses plain-http manifest. */
export function originForManifest(req: Request): string {
  const host = req.headers.get('host') ?? new URL(req.url).host;
  return `https://${host}`;
}

/** Build the manifest.plist XML body. iOS reads only this small subset
 *  of OmniGroup's enterprise plist schema; richer fields (assets list
 *  for icon URLs etc.) are optional. */
export function buildManifestXml(meta: DistMeta, ipaUrl: string): string {
  const escape = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const assets: Array<{ kind: string; url: string }> = [
    { kind: 'software-package', url: ipaUrl },
  ];
  if (meta.displayImageUrl) assets.push({ kind: 'display-image', url: meta.displayImageUrl });
  if (meta.fullSizeImageUrl) assets.push({ kind: 'full-size-image', url: meta.fullSizeImageUrl });
  const assetsXml = assets
    .map((a) => `      <dict>\n        <key>kind</key><string>${escape(a.kind)}</string>\n        <key>url</key><string>${escape(a.url)}</string>\n      </dict>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
${assetsXml}
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key><string>${escape(meta.bundleId)}</string>
        <key>bundle-version</key><string>${escape(meta.version)}</string>
        <key>kind</key><string>software</string>
        <key>title</key><string>${escape(meta.title)}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`;
}

/** GET /v1/dist/manifest.plist → application/x-plist body. */
export async function handleDistManifest(req: Request): Promise<Response> {
  const meta = await readDistMeta();
  if (!meta) {
    return new Response(
      'No IPA published yet. Run: elanous nexus dist publish <path/to/Elanous.ipa>\n',
      { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }
  const origin = originForManifest(req);
  const ipaUrl = `${origin}${IPA_PATH_PREFIX}${encodeURIComponent(meta.file)}`;
  const body = buildManifestXml(meta, ipaUrl);
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/x-plist; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/** GET /v1/dist/<file>.ipa → application/octet-stream stream. The file
 *  name in the URL must match dist.json's `file` field (we don't allow
 *  arbitrary access to ~/.elanous/dist contents). */
export async function handleDistIpa(_req: Request, filename: string): Promise<Response> {
  if (filename.includes('/') || filename.includes('..')) {
    return new Response('bad filename', { status: 400 });
  }
  const meta = await readDistMeta();
  if (!meta) {
    return new Response('not-published', { status: 404 });
  }
  if (filename !== meta.file) {
    return new Response('unknown-artifact', { status: 404 });
  }
  const path = join(DIST_DIR, filename);
  let size = 0;
  try {
    const s = await stat(path);
    size = s.size;
  } catch {
    return new Response('artifact-missing-on-disk', { status: 500 });
  }
  const file = Bun.file(path);
  return new Response(file.stream(), {
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(size),
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}

/** GET /v1/dist/install → tiny HTML page with the itms-services://
 *  install link. Convenient when a user lands on the daemon via the
 *  PWA share URL on a fresh iPad and wants to install in one tap. */
export async function handleDistInstallPage(req: Request): Promise<Response> {
  const meta = await readDistMeta();
  if (!meta) {
    return new Response(
      '<!doctype html><meta charset=utf-8><body style="font-family:-apple-system,system-ui;padding:24px"><h2>Elanous dist</h2><p>No IPA published yet.</p><pre>elanous nexus dist publish &lt;path/to/Elanous.ipa&gt;</pre></body>',
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  }
  const origin = originForManifest(req);
  const manifestUrl = `${origin}${MANIFEST_PATH}`;
  const installLink = `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`;
  const html = `<!doctype html>
<meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Install ${meta.title}</title>
<body style="font-family:-apple-system,system-ui;padding:24px;max-width:640px;margin:auto;line-height:1.5">
  <h2>${meta.title}</h2>
  <p>Version <code>${meta.version}</code>${meta.build ? ` (build ${meta.build})` : ''} · published <code>${meta.publishedAt}</code></p>
  <p><a style="display:inline-block;padding:14px 24px;background:#007AFF;color:#fff;border-radius:12px;text-decoration:none;font-weight:600" href="${installLink}">Install on this iPad</a></p>
  <p style="color:#888;font-size:13px">Bundle <code>${meta.bundleId}</code> · file <code>${meta.file}</code></p>
</body>`;
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
