// nexus-dist.ts — `elanous nexus dist publish|link` CLI handlers.
//
// `publish <ipa>` ingests an ad-hoc IPA into ~/.elanous/dist and writes
// ~/.elanous/dist/dist.json so the daemon's /v1/dist/* endpoints can
// serve it over Tailscale (manifest.plist + IPA stream). `link` prints
// the itms-services:// install URL for the currently-published artifact
// so the user can paste it into iPad Safari from anywhere on the tailnet.

import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { DIST_DIR, DIST_META_FILE, IPA_PATH_PREFIX, MANIFEST_PATH, readDistMeta } from '../nexus/api/dist.js';

interface PublishOpts {
  ipa: string;
  title?: string;
  version?: string;
  build?: string;
  displayImageUrl?: string;
  fullSizeImageUrl?: string;
}

interface PublishResult {
  exitCode: number;
}

/** Extract `Payload/<app>.app/Info.plist` from the IPA into tmp,
 *  convert to JSON with `plutil`, and return parsed plist values. */
async function extractIpaInfoPlist(ipaPath: string): Promise<Record<string, unknown> | null> {
  const tmpDir = join(homedir(), '.elanous', 'dist', '.tmp-extract');
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });
  try {
    // Only the Info.plist files (top-level + embedded plugins) — keeps the
    // extract small; the .ipa itself stays the canonical artifact on disk.
    const listProc = spawnSync('unzip', ['-Z1', ipaPath, 'Payload/*.app/Info.plist'], { encoding: 'utf8' });
    if (listProc.status !== 0) return null;
    const candidates = listProc.stdout.split('\n').filter((p) => p.endsWith('/Info.plist') && p.split('/').length === 3);
    if (candidates.length === 0) return null;
    const target = candidates[0]!;
    const extractProc = spawnSync('unzip', ['-o', '-q', ipaPath, target, '-d', tmpDir]);
    if (extractProc.status !== 0) return null;
    const plistOnDisk = join(tmpDir, target);
    const jsonProc = spawnSync('plutil', ['-convert', 'json', '-o', '-', plistOnDisk], { encoding: 'utf8' });
    if (jsonProc.status !== 0) return null;
    return JSON.parse(jsonProc.stdout) as Record<string, unknown>;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export async function runDistPublish(opts: PublishOpts): Promise<PublishResult> {
  const ipaAbs = opts.ipa.startsWith('/') ? opts.ipa : join(process.cwd(), opts.ipa);
  try {
    const stat = await readFile(ipaAbs);
    if (stat.byteLength === 0) {
      console.error(`elanous nexus dist publish: empty file: ${ipaAbs}`);
      return { exitCode: 1 };
    }
  } catch (err) {
    console.error(`elanous nexus dist publish: cannot read ${ipaAbs}: ${(err as Error).message}`);
    return { exitCode: 1 };
  }

  const info = await extractIpaInfoPlist(ipaAbs);
  const bundleId = opts.title /* never-fallback to title */ && false
    ? ''
    : (info?.CFBundleIdentifier as string | undefined);
  const version =
    opts.version ?? (info?.CFBundleShortVersionString as string | undefined) ?? (info?.CFBundleVersion as string | undefined);
  const build = opts.build ?? (info?.CFBundleVersion as string | undefined);
  const title =
    opts.title ??
    (info?.CFBundleDisplayName as string | undefined) ??
    (info?.CFBundleName as string | undefined) ??
    basename(ipaAbs, '.ipa');

  if (!bundleId) {
    console.error('elanous nexus dist publish: failed to read CFBundleIdentifier from IPA Info.plist.');
    console.error('  Verify the IPA is a valid iOS Ad Hoc / Development archive.');
    return { exitCode: 1 };
  }
  if (!version) {
    console.error('elanous nexus dist publish: failed to read CFBundleShortVersionString from IPA Info.plist.');
    return { exitCode: 1 };
  }

  await mkdir(DIST_DIR, { recursive: true });
  const file = basename(ipaAbs);
  const dest = join(DIST_DIR, file);
  await copyFile(ipaAbs, dest);

  const meta = {
    file,
    bundleId,
    version,
    ...(build ? { build } : {}),
    title,
    ...(opts.displayImageUrl ? { displayImageUrl: opts.displayImageUrl } : {}),
    ...(opts.fullSizeImageUrl ? { fullSizeImageUrl: opts.fullSizeImageUrl } : {}),
    publishedAt: new Date().toISOString(),
  };
  await writeFile(join(DIST_DIR, DIST_META_FILE), JSON.stringify(meta, null, 2) + '\n');

  // Prune stray .ipa siblings so the dist directory only ever holds the
  // current artifact (avoids leaking older versions through enumeration).
  const siblings = await readdir(DIST_DIR);
  for (const name of siblings) {
    if (name.endsWith('.ipa') && name !== file) {
      await rm(join(DIST_DIR, name), { force: true });
    }
  }

  console.log(`✓ published ${file} (${bundleId} v${version}${build ? ` build ${build}` : ''})`);
  console.log(`  dist dir: ${DIST_DIR}`);
  console.log('');
  await printInstallLinks();
  return { exitCode: 0 };
}

interface LinkResult {
  exitCode: number;
}

async function printInstallLinks(): Promise<void> {
  const meta = await readDistMeta();
  if (!meta) {
    console.error('  (no dist.json yet — publish first)');
    return;
  }
  const tailnetHost = await resolveTailnetHost();
  const loopback = 'http://127.0.0.1:31415';
  const lines: string[] = [];
  if (tailnetHost) {
    const origin = `https://${tailnetHost}:31415`;
    const manifestUrl = `${origin}${MANIFEST_PATH}`;
    const installUrl = `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`;
    lines.push(`  Safari install link (iPad):`);
    lines.push(`    ${installUrl}`);
    lines.push('');
    lines.push(`  Or open the install page directly in Safari:`);
    lines.push(`    ${origin}/v1/dist/install`);
    lines.push('');
    lines.push(`  Manifest:        ${manifestUrl}`);
    lines.push(`  IPA stream:      ${origin}${IPA_PATH_PREFIX}${encodeURIComponent(meta.file)}`);
  } else {
    lines.push('  ⚠ Tailscale share not detected — run: elanous nexus pwa share enable');
    lines.push(`  Local manifest:  ${loopback}${MANIFEST_PATH}`);
  }
  for (const line of lines) console.log(line);
}

export async function runDistLink(): Promise<LinkResult> {
  const meta = await readDistMeta();
  if (!meta) {
    console.error('elanous nexus dist link: no IPA published yet. Run: elanous nexus dist publish <path>');
    return { exitCode: 1 };
  }
  console.log(`Published: ${meta.title} ${meta.version}${meta.build ? ` (build ${meta.build})` : ''} · ${meta.bundleId}`);
  console.log(`Updated:   ${meta.publishedAt}`);
  console.log('');
  await printInstallLinks();
  return { exitCode: 0 };
}

/** Best-effort tailnet host probe — reads `tailscale status --json`
 *  and returns this node's MagicDNSName (without trailing dot). Returns
 *  null when tailscale isn't installed / running / shared. */
async function resolveTailnetHost(): Promise<string | null> {
  const proc = spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8' });
  if (proc.status !== 0) return null;
  try {
    const data = JSON.parse(proc.stdout) as { Self?: { DNSName?: string } };
    const dns = data.Self?.DNSName;
    if (!dns) return null;
    return dns.endsWith('.') ? dns.slice(0, -1) : dns;
  } catch {
    return null;
  }
}

/** Optional: locate the most recent IPA in DerivedData (xcodebuild
 *  archive output). Lets the user run `elanous nexus dist publish`
 *  without an explicit path. */
export async function findLatestIpa(searchRoot: string): Promise<string | null> {
  try {
    const entries = await readdir(searchRoot, { withFileTypes: true, recursive: true });
    let bestPath: string | null = null;
    let bestMtime = 0;
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.ipa')) continue;
      const path = join(e.parentPath ?? dirname(searchRoot), e.name);
      try {
        const proc = spawnSync('stat', ['-f', '%m', path], { encoding: 'utf8' });
        const mtime = Number.parseInt(proc.stdout.trim(), 10);
        if (Number.isFinite(mtime) && mtime > bestMtime) {
          bestMtime = mtime;
          bestPath = path;
        }
      } catch {
        // ignore
      }
    }
    return bestPath;
  } catch {
    return null;
  }
}
