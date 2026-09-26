import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, extname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createCdpClient, createCdpClientFromEndpoint, discoverChromeBinary,
} from '../browser-cdp/client.js';
import { buildExtractionExpression, parseExtraction } from '../webclone/computed-tokens.js';
import { renderDesignMd } from '../webclone/design-md.js';
import { isAsset } from './asset-kinds.js';
import { judgeArchiveBucket, type BucketVerdict } from './archive-bucket-verdict.js';
import { checkAssets, formatIntegrity, type IntegrityReport } from './asset-integrity.js';
import { classifyRenderLocation, visibleTextLength, type RenderLocation } from './clone-fidelity.js';
import { cloneSlug, decompose } from '../webclone/webclone-decompose.js';
import {
  contentHash, insertAsset, openWebCloneDb, replaceTokens, specHash, upsertClone,
} from '../webclone/webclone-db.js';
import {
  DEFAULT_STORE, isFullyBlockedFromPublic, isPublicReadPolicy, readAwsProfile, uploadAsset,
  type S3Credentials,
} from '../webclone/webclone-store.js';
import { debug } from '../debug/log.js';

export interface ArchiveOptions {
  readonly url: string;
  readonly outRoot: string;
  readonly dbPath?: string;
  readonly archiveBucket?: string;
  readonly upload?: boolean;
  readonly profile?: string;
  readonly port?: number;
  readonly spawnSync?: typeof spawnSync;
  readonly archiveBucketVerdict?: (bucket: string) => BucketVerdict;
  readonly uploadArchiveFile?: (bucket: string, region: string, key: string, body: Uint8Array, creds: S3Credentials | null) => Promise<{ ok: boolean; detail: string }>;
  readonly skipBrowserCapture?: boolean;
  readonly discoverChromeBinary?: typeof discoverChromeBinary;
  readonly createCdpClient?: typeof createCdpClient;
  readonly createCdpClientFromEndpoint?: typeof createCdpClientFromEndpoint;
  readonly renderSettlingWait?: (ms: number) => Promise<unknown>;
  readonly renderSettlingConfig?: {
    readonly intervalMs?: number;
    readonly stableObservations?: number;
    readonly maxWaitMs?: number;
  };
}

export type MirrorCompletion = 'completed' | 'partial-server-error' | 'failed' | 'timed-out' | 'index-missing';
export type MirrorCollapse = 'intact' | 'collapsed' | 'partial-live-content' | 'unmeasured';
export type MirrorEntryLinkDiagnosis = 'self-contained' | 'non-self-contained' | 'unmeasured';
export type RenderSettlingStatus = 'settled' | 'capped' | 'never-grew';

export const LOW_LIVE_TEXT_RATIO = 0.5;
export const REMOTE_DOMINANCE_LINK_RATIO = 0.6;

export interface LinkCounts {
  readonly externalLinks: number;
  readonly localAssetLinks: number;
}

export function classifyDocumentLinks(html: string): LinkCounts {
  const links = [...html.matchAll(/(?:href|src)="([^"]+)"/gi)].map((m) => m[1]);
  return {
    externalLinks: links.filter((href) => /^https?:\/\//i.test(href)).length,
    localAssetLinks: links.filter((href) => href.startsWith('/') || (!/^[a-z]+:/i.test(href) && !href.startsWith('#'))).length,
  };
}

export function rewriteRenderedAssetUrls(
  html: string, sourceUrl: string, downloadedFiles: readonly string[],
): { html: string; replacedAssetUrls: number } {
  if (downloadedFiles.length === 0) return { html, replacedAssetUrls: 0 };
  let source: URL;
  try { source = new URL(sourceUrl); } catch { return { html, replacedAssetUrls: 0 }; }
  const files = new Set(downloadedFiles);
  const baseHref = /<base\b[^>]*\shref\s*=\s*(["'])(.*?)\1/i.exec(html);
  let documentBase = source;
  try { if (baseHref) documentBase = new URL(baseHref[2].replace(/&amp;/g, '&'), source); } catch { /* invalid base */ }
  let replacedAssetUrls = 0;
  const rewriteUrl = (value: string): string => {
    if (!value) return value;
    let url: URL;
    try { url = new URL(value.replace(/&amp;/g, '&'), documentBase); } catch { return value; }
    const path = url.pathname.slice(1) + (url.search ? `@${url.search.slice(1)}` : '');
    if (/^https?:$/.test(url.protocol) && url.origin === source.origin && !url.username && !url.password && files.has(path)) {
      const local = './' + path.split('/').map(encodeURIComponent).join('/') + url.hash;
      if (local !== value) replacedAssetUrls += 1;
      return local;
    }
    return baseHref && !/^[a-z][a-z\d+.-]*:/i.test(value) ? url.href.replace(/&/g, '&amp;') : value;
  };
  const rewriteSrcset = (value: string): string => value.replace(
    /(^|[\s,]+)([^\s,][^\s]*)([\s]+[^,]*)?/g,
    (_candidate, leading: string, token: string, descriptor = '') => {
      const trailing = /,+$/.exec(token)?.[0] ?? '';
      return leading + rewriteUrl(token.slice(0, token.length - trailing.length)) + trailing + descriptor;
    },
  );
  const rewritten = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<[^>]+>/gi, (tag) => {
    if (tag.startsWith('<!--')) return tag;
    const end = tag.indexOf('>');
    const opening = tag.slice(0, end).replace(/(\s(href|src|srcset)\s*=\s*)(["'])(.*?)\3/gi,
      (attribute, prefix: string, name: string, quote: string, value: string) => {
        if (/^<base\b/i.test(tag) && name.toLowerCase() === 'href') return '';
        const changed = name.toLowerCase() === 'srcset' ? rewriteSrcset(value) : rewriteUrl(value);
        return changed === value ? attribute : `${prefix}${quote}${changed}${quote}`;
      });
    return opening + tag.slice(end);
  });
  return replacedAssetUrls ? { html: rewritten, replacedAssetUrls } : { html, replacedAssetUrls: 0 };
}

/**
 * ⛔⭐⭐ ***사본의 「들머리 파일」 후보를 «URL 에서» 만든다.***
 *
 * 🩸 왜 있나(2026-09-12 🅕 실측): 사본 탐색이 ***`index.html` «만»*** 찾고 있었다.
 *    그래서 `http://host/js-painted.html` 처럼 ***「색인이 아닌」 URL*** 은 wget 이
 *    `js-painted.html` 로 저장했는데 ***아무도 그 이름을 찾지 않아*** `mirrorFetched=false` 가 됐다.
 *    ⇒ ***픽셀·근접공백이 전부 「못 쟀음」으로 샜고***, 사람이 그것을 ***「배선이 안 산다」로 «읽었다»***
 *      (대조 장 README 가 그 오독을 «석 달» 품고 있었다).
 *
 * ⛔ 「못 쟀음」을 「깨끗」으로 만들지 «않는다» — 이 함수는 ***찾을 자리를 넓힐 뿐***이고,
 *    없으면 여전히 `null` 이다. 부르는 쪽이 ***「무엇이 있었나」를 같이 내야*** 한다.
 *
 * ⭐ 순서가 «뜻»을 갖는다 — ***색인이 먼저***다(디렉토리 URL 이 정상 경로).
 *    `-E`(`--adjust-extension`)가 확장자를 붙이므로 `<이름>.html` 도 본다.
 */
export function mirrorEntryCandidates(url: string): string[] {
  const out = ['index.html', 'index.html.1'];
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return out;   // ⛔ 못 읽으면 «넓히지 않는다» — 지어내지 않는다
  }
  const base = path.split('/').filter((p) => p !== '').pop();
  if (base === undefined) return out;
  if (!out.includes(base)) out.push(base);
  // ⭐ wget `-E` 는 확장자가 없거나 다르면 `.html` 을 «덧붙인다»
  if (!base.endsWith('.html')) {
    const withExt = `${base}.html`;
    if (!out.includes(withExt)) out.push(withExt);
  }
  return out;
}

export function diagnoseMirrorEntryLinks(counts: LinkCounts | null): MirrorEntryLinkDiagnosis {
  if (counts === null) return 'unmeasured';
  const total = counts.localAssetLinks + counts.externalLinks;
  return counts.localAssetLinks === 0 || (total > 0 && counts.externalLinks / total >= REMOTE_DOMINANCE_LINK_RATIO)
    ? 'non-self-contained'
    : 'self-contained';
}

const RENDER_READY_EXPRESSION = `(() => new Promise((resolve) => {
  const complete = () => Promise.resolve(document.fonts?.ready).catch(() => undefined).then(
    () => requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  if (document.readyState === 'complete') complete();
  else window.addEventListener('load', complete, { once: true });
}))()`;

export function classifyMirrorCollapse(mirrored: number | null, mirrorRendered: number | null): MirrorCollapse {
  if (mirrored === null || mirrorRendered === null) return 'unmeasured';
  return mirrorRendered >= mirrored / 2 ? 'intact' : 'collapsed';
}

const MIRROR_PROBE_EXPRESSION = "({ href: location.href, html: document.documentElement?.outerHTML ?? '' })";
const MIRROR_LOAD_TIMEOUT_MS = 10_000;

export async function measureRenderedMirror(
  client: Awaited<ReturnType<typeof createCdpClientFromEndpoint>>,
  entryPath: string,
): Promise<number | null> {
  const targetUrl = pathToFileURL(entryPath).href;
  const loadEvents: Array<{ frameId?: unknown; loaderId?: unknown; name?: unknown }> = [];
  const isOurs = { match: (_e: { frameId?: unknown; loaderId?: unknown; name?: unknown }) => false };
  let resolveLoad: (() => void) | null = null;
  const loaded = new Promise<void>((resolve) => { resolveLoad = resolve; });
  const unsubscribe = client.on?.('Page.lifecycleEvent', (event) => {
    const params = event.params;
    loadEvents.push(params);
    if (params.name === 'load' && isOurs.match(params)) resolveLoad?.();
  });
  if (!unsubscribe) throw new Error('mirror navigation requires CDP lifecycle events');

  try {
    const navigation = await client.navigate(targetUrl);
    if (navigation.errorText) throw new Error(`mirror navigate: ${navigation.errorText}`);
    if (!navigation.loaderId) throw new Error('mirror navigate did not return a loaderId');
    isOurs.match = (event) => event.frameId === navigation.frameId && event.loaderId === navigation.loaderId;
    const matchesNavigation = () => loadEvents.some((event) => event.name === 'load' && isOurs.match(event));
    if (!matchesNavigation()) {
      await Promise.race([
        loaded,
        Bun.sleep(MIRROR_LOAD_TIMEOUT_MS).then(() => { throw new Error('mirror navigation load timed out'); }),
      ]);
    }
    if (!matchesNavigation()) {
      const names = loadEvents.map((e) => `${String(e.name)}[f=${String(e.frameId).slice(0, 8)},l=${String(e.loaderId).slice(0, 8)}]`).join(' ') || '(없음)';
      throw new Error(`mirror navigation load did not match its loader — 받은 lifecycle=${names}`
        + ` · 기대 frameId=${String(navigation.frameId)} loaderId=${String(navigation.loaderId)}`);
    }
    await client.evaluate(RENDER_READY_EXPRESSION);
    const probe = await client.evaluate(MIRROR_PROBE_EXPRESSION);
    if (!probe || typeof probe !== 'object') return null;
    const { href, html } = probe as { href?: unknown; html?: unknown };
    return href === targetUrl && typeof html === 'string' ? visibleTextLength(html) : null;
  } finally {
    unsubscribe();
  }
}

export interface RenderSettling {
  readonly status: RenderSettlingStatus;
  readonly finalBody: string;
  readonly finalLength: number;
  readonly observations: number;
  readonly waitedMs: number;
}

export const RENDER_SETTLING_INTERVAL_MS = 500;
export const RENDER_SETTLING_STABLE_OBSERVATIONS = 2;
export const RENDER_SETTLING_MAX_WAIT_MS = 10_000;

export async function waitForRenderSettling(
  measureBody: () => Promise<string>,
  wait: (ms: number) => Promise<unknown> = Bun.sleep,
  intervalMs = RENDER_SETTLING_INTERVAL_MS,
  stableObservations = RENDER_SETTLING_STABLE_OBSERVATIONS,
  maxWaitMs = RENDER_SETTLING_MAX_WAIT_MS,
): Promise<RenderSettling> {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('render settling intervalMs must be positive');
  if (!Number.isInteger(stableObservations) || stableObservations < 1) throw new Error('render settling stableObservations must be at least 1');
  if (!Number.isFinite(maxWaitMs) || maxWaitMs <= 0) throw new Error('render settling maxWaitMs must be positive');

  let finalBody = '';
  let finalLength = 0;
  let observations = 0;
  let waitedMs = 0;
  let sawGrowth = false;
  let consecutiveNoGrowth = 0;
  let sawMeasurementError = false;
  let lastMeasurementError: unknown;

  while (true) {
    try {
      const body = await measureBody();
      const length = visibleTextLength(body);
      if (observations > 0) {
        if (length > finalLength) {
          sawGrowth = true;
          consecutiveNoGrowth = 0;
        } else {
          consecutiveNoGrowth += 1;
        }
      }
      finalBody = body;
      finalLength = length;
      observations += 1;
      if (sawGrowth && consecutiveNoGrowth >= stableObservations) {
        return { status: 'settled', finalBody, finalLength, observations, waitedMs };
      }
    } catch (error) {
      sawMeasurementError = true;
      lastMeasurementError = error;
    }
    if (waitedMs >= maxWaitMs) break;
    const delay = Math.min(intervalMs, maxWaitMs - waitedMs);
    await wait(delay);
    waitedMs += delay;
  }

  if (observations === 0 && sawMeasurementError) throw lastMeasurementError;
  return {
    status: sawGrowth ? 'capped' : 'never-grew',
    finalBody,
    finalLength,
    observations,
    waitedMs,
  };
}

export const DEFAULT_MIRROR_DEPTH = 1;

const PUBLIC_SUFFIXES = new Set([
  'ac.uk', 'co.uk', 'gov.uk', 'ltd.uk', 'me.uk', 'net.uk', 'nhs.uk', 'org.uk', 'plc.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'com.br', 'net.br', 'org.br', 'com.cn', 'net.cn', 'org.cn', 'com.mx', 'com.sg', 'com.tr',
]);

function isPublicSuffix(host: string): boolean {
  return PUBLIC_SUFFIXES.has(host) || /^[a-z]{2}$/.test(host);
}

export function deriveSiblingHostAllowlist(url: string): string[] {
  try {
    const host = new URL(url).hostname;
    if (!host) return [];
    const sibling = host.startsWith('www.') ? host.slice('www.'.length) : `www.${host}`;
    return isPublicSuffix(sibling) ? [host] : [...new Set([host, sibling])];
  } catch {
    return [];
  }
}

export function exactHostAcceptRegex(hosts: readonly string[]): string | null {
  if (hosts.length === 0) return null;
  const escaped = hosts.map((host) => host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return `^https?://(${escaped})(:[0-9]+)?/`;
}

export interface DisabledMirrorCopy {
  readonly path: string;
  readonly frozenScripts: number;
}

export function disableMirrorDocumentScripts(html: string): { html: string; frozenScripts: number } {
  const frozenScripts = (html.match(/<script\b/gi) ?? []).length;
  return {
    html: html.replace(/<script\b([^>]*)>/gi,
      (_match, attrs: string) => `<script type="application/x-archived"${attrs.replace(/\s+type\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')}>`),
    frozenScripts,
  };
}

function disabledMirrorCopyPath(entryPath: string): string {
  const extension = extname(entryPath) || '.html';
  return join(dirname(entryPath), `${basename(entryPath, extension)}.scripts-disabled${extension}`);
}

export function createDisabledMirrorCopy(entryPath: string, out: string): DisabledMirrorCopy {
  const disabled = disableMirrorDocumentScripts(readFileSync(entryPath, 'utf8'));
  const absolutePath = disabledMirrorCopyPath(entryPath);
  writeFileSync(absolutePath, disabled.html);
  return { path: relative(out, absolutePath), frozenScripts: disabled.frozenScripts };
}

export interface ArchiveRecord {
  readonly slug: string; readonly url: string; readonly out: string; readonly dbPath: string;
  readonly capturedAt: string; readonly title: string | null;
  readonly originFiles: number; readonly mirrorOk: boolean;
  readonly mirrorCompletion: MirrorCompletion;
  readonly mirrorExitCode: number | null;
  readonly mirrorDepth: number;
  readonly mirrorAllowedHosts?: readonly string[];
  readonly fullPageScreenshot: { bytes: number; dimensions: string };
  readonly tokens: number | null;
  readonly derived: readonly string[];
  readonly uploaded: readonly string[];
  readonly notes: readonly string[];
  readonly archiveNote: string;
  readonly archivedCount: number;
  readonly archivePartial?: boolean;
  readonly renderLocation: RenderLocation;
  readonly entryPath: string | null;
  readonly mirrorEntryLinks?: LinkCounts | null;
  readonly mirrorEntryLinkDiagnosis?: MirrorEntryLinkDiagnosis;
  readonly visibleText: { mirrored: number | null; rendered: number | null; mirrorRendered: number | null };
  readonly mirrorLiveTextRatio?: number | null;
  readonly mirrorCollapse: MirrorCollapse;
  readonly renderSettling?: Omit<RenderSettling, 'finalBody'> | null;
  readonly renderedSnapshot: {
    path: string; bytes: number; visible: number; gain: number | null;
    trigger: 'render-location' | 'mirror-collapse' | 'both';
    externalLinks: number;
    localAssetLinks: number;
    frozenScripts: number;
    replacedAssetUrls?: number;
  } | null;
  readonly disabledMirrorCopy?: DisabledMirrorCopy | null;
  readonly canvasCount: number | null;
  readonly integrity: IntegrityReport;
}

const MIRROR_JUNK = /(?:^|\/)(?:\.listing|robots\.txt\.tmp)$|\.tmp$/i;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (!MIRROR_JUNK.test(p)) out.push(p);
  }
  return out;
}

function isEntryFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function pathEntryCandidates(out: string, url: string): string[] {
  const origin = join(out, 'origin');
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/^\/+|\/+$/g, '');
    if (!pathname) return [];
    const directoryEntry = join(origin, pathname, 'index.html');
    return parsed.pathname.endsWith('/')
      ? [directoryEntry, join(origin, pathname), join(origin, `${pathname}.html`)]
      : [join(origin, pathname), join(origin, `${pathname}.html`), directoryEntry];
  } catch {
    return [];
  }
}

function findEntryPath(out: string, url: string): string | null {
  const origin = join(out, 'origin');
  const root = ['index.html', 'index.html.1'].map((name) => join(origin, name));
  return root.find(isEntryFile) ?? pathEntryCandidates(out, url).find(isEntryFile) ?? null;
}

function archiveBucketVerdict(bucket: string): BucketVerdict {
  const pol = spawnSync('aws', ['s3api', 'get-bucket-policy', '--bucket', bucket, '--query', 'Policy', '--output', 'text'],
    { encoding: 'utf8', timeout: 30_000 });
  const blk = spawnSync('aws', ['s3api', 'get-public-access-block', '--bucket', bucket],
    { encoding: 'utf8', timeout: 30_000 });
  return judgeArchiveBucket(bucket, {
    policy: { ok: pol.status === 0, text: `${pol.stdout ?? ''}${pol.stderr ?? ''}` },
    block: { ok: blk.status === 0, text: `${blk.stdout ?? ''}${blk.stderr ?? ''}` },
  }, isPublicReadPolicy, isFullyBlockedFromPublic);
}

function cdpFailureDetail(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    try {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message.trim();
    } catch { /* fallback */ }
  }
  let fallback: string;
  try { fallback = String(error); } catch { fallback = '(오류를 직렬화할 수 없음)'; }
  const truncation = '…(절단됨)';
  return fallback.length > 200
    ? `${fallback.slice(0, 200 - truncation.length)}${truncation}`
    : fallback;
}

async function uploadArchiveFile(
  bucket: string, region: string, key: string, body: Uint8Array, creds: S3Credentials | null,
  uploader?: ArchiveOptions['uploadArchiveFile'],
): Promise<{ ok: boolean; detail: string }> {
  if (/[?#]/.test(key)) {
    return { ok: false, detail: '원문 키에 ? 또는 #가 있어 S3 키가 잘려 다른 파일을 덮어쓸 위험이 있어 업로드하지 않았다' };
  }
  if (uploader) return uploader(bucket, region, key, body, creds);
  try {
    const f = Bun.s3.file(key, { bucket, region, ...(creds ?? {}) });
    await f.write(body);
    return { ok: true, detail: `s3://${bucket}/${key}` };
  } catch (e) {
    return { ok: false, detail: String(e).slice(0, 160) };
  }
}

export async function runArchive(options: ArchiveOptions): Promise<ArchiveRecord> {
  const startedAt = Date.now();
  try {
    const {
      url, outRoot,
      spawnSync: runSpawnSync = spawnSync,
      archiveBucketVerdict: getArchiveBucketVerdict = archiveBucketVerdict,
      uploadArchiveFile: uploadOriginalFile,
      discoverChromeBinary: findChrome = discoverChromeBinary,
      createCdpClient: launchCdpClient = createCdpClient,
      createCdpClientFromEndpoint: connectCdpClient = createCdpClientFromEndpoint,
      renderSettlingWait,
      renderSettlingConfig,
    } = options;
    const chrome = findChrome();
    if (!chrome) throw new Error('Chrome 을 못 찾았다');

    const slug = cloneSlug(url);
    const out = join(outRoot, slug);
    mkdirSync(join(out, 'origin'), { recursive: true });

    const mirrorDepth = DEFAULT_MIRROR_DEPTH;
    const mirrorAllowedHosts = deriveSiblingHostAllowlist(url);
    const exactHostFilter = exactHostAcceptRegex(mirrorAllowedHosts);
    const hostTraversalArgs = exactHostFilter
      ? ['--span-hosts', `--domains=${mirrorAllowedHosts.join(',')}`, `--accept-regex=${exactHostFilter}`]
      : [];
    const w = runSpawnSync('wget', ['--mirror', '-l', String(mirrorDepth), '-p', '-k', '-nH', '-q', '-e', 'robots=off',
      '--restrict-file-names=windows', '-E', '--timeout=30', '--tries=2', '--user-agent=Mozilla/5.0',
      ...hostTraversalArgs, '-P', join(out, 'origin'), url], { encoding: 'utf8', timeout: 240_000 });
    const originFiles = walk(join(out, 'origin')).map((p) => relative(out, p)).sort();
    const indexPath = findEntryPath(out, url);
    const mirrorCompletion: MirrorCompletion = (w.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT'
      ? 'timed-out'
      : w.status !== 0 && w.status !== 8
        ? 'failed'
        : indexPath === null
          ? 'index-missing'
          : w.status === 8 ? 'partial-server-error' : 'completed';

    const port = options.port ?? 9388;
    let browser: Awaited<ReturnType<typeof createCdpClient>> | null = null;
    let client: Awaited<ReturnType<typeof createCdpClientFromEndpoint>> | null = null;
    let shotBytes = 0, shotDims = '못 쟀다';
    let tokens: ReturnType<typeof parseExtraction> = null;
    let title: string | null = null;
    let cdpNote: string | null = null;
    let mirrorOpenNote: string | null = null;
    let renderedVisible: number | null = null;
    let renderedHtml: string | null = null;
    let renderSettling: ArchiveRecord['renderSettling'] = null;
    let mirrorRenderedVisible: number | null = null;
    let canvasCount: number | null = null;
    try {
      if (options.skipBrowserCapture) throw new Error('테스트 seam: CDP 캡처 생략');
      browser = await launchCdpClient({
        headless: true, port, binary: chrome, url: 'about:blank',
        extraFlags: ['--hide-scrollbars', '--force-prefers-reduced-motion', '--window-size=1280,900'],
        timeoutMs: 90_000,
      });
      client = await connectCdpClient(port);
      const nav = await client.navigate(url);
      if (nav.errorText) throw new Error(`navigate: ${nav.errorText}`);
      const settling = await waitForRenderSettling(
        async () => {
          const html = await client!.evaluate('document.documentElement?.outerHTML ?? \'\'');
          return typeof html === 'string' ? html : '';
        },
        renderSettlingWait,
        renderSettlingConfig?.intervalMs,
        renderSettlingConfig?.stableObservations,
        renderSettlingConfig?.maxWaitMs,
      );
      renderedHtml = settling.finalBody;
      renderedVisible = settling.finalLength;
      renderSettling = {
        status: settling.status,
        finalLength: settling.finalLength,
        observations: settling.observations,
        waitedMs: settling.waitedMs,
      };
      const png = await client.screenshot({ fullPage: true });
      writeFileSync(join(out, 'origin', 'fullpage.png'), png);
      shotBytes = png.length;
      const id = spawnSync('magick', ['identify', '-format', '%wx%h', join(out, 'origin', 'fullpage.png')],
        { encoding: 'utf8', timeout: 30_000 });
      if (id.status === 0) shotDims = (id.stdout ?? '').trim();

      tokens = parseExtraction(await client.evaluate(buildExtractionExpression()));
      const t = await client.evaluate('document.title');
      title = typeof t === 'string' && t ? t : null;
      const cv = await client.evaluate('document.querySelectorAll("canvas").length');
      canvasCount = typeof cv === 'number' && Number.isFinite(cv) ? cv : null;

      if (indexPath !== null) {
        try {
          mirrorRenderedVisible = await measureRenderedMirror(client, indexPath);
        } catch (e) {
          mirrorOpenNote = `미러 열기 실패: ${cdpFailureDetail(e)} — mirrorCollapse 를 「못 쟀다」로 둔다`;
        }
      }
    } catch (e) {
      if (!options.skipBrowserCapture) cdpNote = `CDP 단계 실패: ${cdpFailureDetail(e)} — 미러는 남는다`;
    } finally {
      try { await client?.close(); } catch { /* fail-soft */ }
      try { await browser?.close(); } catch { /* fail-soft */ }
    }

    const entryHtml = indexPath === null ? null : readFileSync(indexPath, 'utf8');
    const mirroredVisible = entryHtml === null ? null : visibleTextLength(entryHtml);
    const mirrorEntryLinks = entryHtml === null ? null : classifyDocumentLinks(entryHtml);
    const mirrorEntryLinkDiagnosis = diagnoseMirrorEntryLinks(mirrorEntryLinks);
    const mirrorOpenCollapse = classifyMirrorCollapse(mirroredVisible, mirrorRenderedVisible);
    const mirrorLiveTextRatio = mirrorRenderedVisible !== null && renderedVisible !== null && renderedVisible > 0
      ? mirrorRenderedVisible / renderedVisible
      : null;
    const mirrorCollapse: MirrorCollapse = mirrorOpenCollapse === 'intact'
      && mirrorLiveTextRatio !== null && mirrorLiveTextRatio < LOW_LIVE_TEXT_RATIO
      ? 'partial-live-content'
      : mirrorOpenCollapse;
    const renderLocation = classifyRenderLocation(mirroredVisible, renderedVisible);
    const renderLocationTriggersSnapshot = renderLocation === 'client' || renderLocation === 'mixed';
    const mirrorCollapseTriggersSnapshot = mirrorOpenCollapse === 'collapsed';
    const renderedSnapshotTrigger = renderLocationTriggersSnapshot && mirrorCollapseTriggersSnapshot
      ? 'both'
      : renderLocationTriggersSnapshot ? 'render-location' : 'mirror-collapse';

    let disabledMirrorCopy: ArchiveRecord['disabledMirrorCopy'] = null;
    if (mirrorCollapse === 'collapsed' && indexPath !== null) {
      disabledMirrorCopy = createDisabledMirrorCopy(indexPath, out);
      originFiles.push(disabledMirrorCopy.path);
    }

    let renderedSnapshot: ArchiveRecord['renderedSnapshot'] = null;
    if ((renderLocationTriggersSnapshot || mirrorCollapseTriggersSnapshot) && renderedHtml !== null && renderedHtml !== '') {
      const rel = join('origin', 'rendered.html');
      originFiles.push(rel);
      const frozenScripts = (renderedHtml.match(/<script\b/gi) ?? []).length;
      const frozenHtml = renderedHtml.replace(/<script\b([^>]*)>/gi,
        (_m, attrs: string) => `<script type="application/x-archived"${attrs.replace(/\btype="[^"]*"/gi, '')}>`);
      const downloadedFiles = originFiles.map((p) => relative('origin', p));
      const rewritten = rewriteRenderedAssetUrls(frozenHtml, url, downloadedFiles);
      writeFileSync(join(out, rel), rewritten.html);
      const links = classifyDocumentLinks(rewritten.html);
      renderedSnapshot = {
        path: rel, bytes: renderedHtml.length, visible: renderedVisible ?? 0,
        gain: mirroredVisible && mirroredVisible > 0 ? (renderedVisible ?? 0) / mirroredVisible : null,
        trigger: renderedSnapshotTrigger,
        externalLinks: links.externalLinks,
        localAssetLinks: links.localAssetLinks,
        frozenScripts,
        replacedAssetUrls: rewritten.replacedAssetUrls,
      };
    }

    const derived: Array<{ name: string; body: string; type: string }> = [];
    if (tokens) {
      writeFileSync(join(out, 'tokens.json'), `${JSON.stringify(tokens, null, 2)}\n`);
      // ⛔ `renderDesignMd` 는 «tokens 전체»를 읽는다(`input.tokens.customProperties` …).
      //    🩸 2026-09-10: 이 칸이 빠진 채 착지해 `design-extract`·`design-archive` 가 «런타임에 죽었다».
      //       타입 게이트는 그것을 봤지만 「변경 파일 밖 진단」이라며 «버렸다».
      // ⛔⭐ 넘기는 것은 «셋»뿐 — 나머지는 `tokens` 에서 읽는다(죽은 칸이 계약을 흔든다)
      const md = renderDesignMd({
        tokens,
        title,
        // ⛔ 🩸 여기 «두 번째» 손으로 적은 목록이 있었고, extract 쪽보다 «더 좁았다»
        //    (mp4·webm·gif·avif·ico·m4a 가 없었다) ⇒ 같은 페이지를 두 도구가 «다른 수»로 셌다.
        //    목록은 `asset-kinds.ts` 한 자리가 canonical 이다.
        assets: originFiles.filter((f) => isAsset(f)),
      });
      writeFileSync(join(out, 'DESIGN.md'), md);
      derived.push({ name: 'DESIGN.md', body: md, type: 'text/markdown' });
      derived.push({ name: 'tokens.json', body: `${JSON.stringify(tokens, null, 2)}\n`, type: 'application/json' });
    }

    const html = indexPath ? readFileSync(indexPath, 'utf8') : '';
    const cssPath = walk(join(out, 'origin')).find((p) => p.endsWith('.css')) ?? null;
    const css = cssPath ? readFileSync(cssPath, 'utf8') : '';
    const spec = decompose({ url, html, css });
    writeFileSync(join(out, 'spec.json'), `${JSON.stringify(spec, null, 2)}\n`);
    derived.push({ name: 'spec.json', body: `${JSON.stringify(spec, null, 2)}\n`, type: 'application/json' });

    const notice = `# ⛔ \`origin/\` 은 «원본 저작물»이다\n\n${url} 의 보관본이다.\n`
      + `⛔ 공개 버킷에 올리지 않는다 — 그 버킷은 정책상 «누구나 읽는다».\n`
      + `파생물은 \`DESIGN.md\` · \`tokens.json\` · \`spec.json\` 이고, 이 글도 그중 하나다.\n`;
    writeFileSync(join(out, 'NOTICE.md'), notice);
    derived.push({ name: 'NOTICE.md', body: notice, type: 'text/markdown' });

    const dbPath = options.dbPath ?? join(process.env.HOME ?? '.', '.elanous', 'webclone.db');
    const db = openWebCloneDb(dbPath);
    const capturedAt = new Date().toISOString();
    upsertClone(db, {
      slug, url, title, capturedAt,
      contentHash: contentHash([html, css]), specHash: specHash(spec),
      specJson: JSON.stringify(spec), unresolved: spec.unresolved.join(','),
    });
    if (tokens) {
      replaceTokens(db, slug, Object.entries(tokens.customProperties)
        .map(([name, value]) => ({ name, value, source: 'computed' })));
    }

    const fullPageRel = join('origin', 'fullpage.png');
    const ledgerFiles = existsSync(join(out, fullPageRel)) && !originFiles.includes(fullPageRel)
      ? [...originFiles, fullPageRel]
      : originFiles;
    for (const f of ledgerFiles) {
      insertAsset(db, {
        slug, ref: f, visibility: 'reference', bytes: statSync(join(out, f)).size,
        contentType: null, publicUrl: null,
        reason: '원본 보관본 — 공개 버킷에 올리지 않는다(정책상 누구나 읽는다)',
      });
    }

    const profile = options.profile ?? null;
    const creds: S3Credentials | null = profile ? readAwsProfile(profile, (f) => readFileSync(f, 'utf8')) : null;
    const uploaded: string[] = [];
    const notes: string[] = [];

    if (options.upload === true) {
      if (profile && !creds) notes.push(`profile-not-found — ~/.aws/credentials 에 [${profile}] 없음`);
      else {
        for (const d of derived) {
          const r = await uploadAsset({
            cfg: DEFAULT_STORE, slug, name: d.name, body: d.body,
            origin: 'derived', contentType: d.type, ...(creds ? { credentials: creds } : {}),
          });
          if (r.ok) {
            uploaded.push(r.url);
            insertAsset(db, {
              slug, ref: d.name, visibility: 'public', bytes: r.bytes,
              contentType: d.type, publicUrl: r.url, reason: '파생물 — 이 저장소가 만들었다',
            });
          } else notes.push(`${d.name}: ${r.blockedOn} — ${r.detail}`);
        }
      }
    } else {
      notes.push(`--upload 를 안 줘서 파생물 ${derived.length}개(${derived.map((d) => d.name).join(' · ')})를 «안 올렸다» — `
        + '그래서 원장 assets 에도 «행이 없다»(배포 행은 업로드가 만든다). 로컬 파일은 있다.');
    }

    const archiveBucket = options.archiveBucket ?? null;
    let archiveNote: string;
    let archivedCount = 0;
    let archivePartial = false;
    if (!archiveBucket) {
      archiveNote = '⛔ --archive-bucket 을 «안 줘서» 원문은 로컬에만 있다 (기본값을 두지 않는다)';
    } else {
      const v = getArchiveBucketVerdict(archiveBucket);
      if (!v.ok) archiveNote = `🔴 ${archiveBucket}: ${v.why}` + (v.remedy ? `\n              ↳ ${v.remedy}` : '');
      else if (options.upload !== true) archiveNote = `✅ ${archiveBucket} 비공개 확인 — ⛔ --upload 가 없어 안 올렸다`;
      else {
        const failures: string[] = [];
        for (const rel of [...originFiles, 'origin/fullpage.png']) {
          const abs = join(out, rel);
          if (!existsSync(abs)) continue;
          const key = `${DEFAULT_STORE.prefix}/${slug}/${rel}`;
          const r = await uploadArchiveFile(archiveBucket, DEFAULT_STORE.region, key,
            new Uint8Array(readFileSync(abs)), creds, uploadOriginalFile);
          if (r.ok) archivedCount += 1; else failures.push(`${rel}: ${r.detail}`);
        }
        if (mirrorCompletion !== 'completed') {
          const stateKey = `${DEFAULT_STORE.prefix}/${slug}/ARCHIVE-STATE.md`;
          const stateBody = new TextEncoder().encode([
            `원본 주소: ${url}`,
            `담은 시각: ${capturedAt}`,
            `완주 상태: ${mirrorCompletion}`,
            `받은 파일 수: ${originFiles.length}`,
            '이 보관본은 부분이라 원본과 다를 수 있다',
          ].join('\n'));
          const stateUpload = await uploadArchiveFile(archiveBucket, DEFAULT_STORE.region, stateKey,
            stateBody, creds, uploadOriginalFile);
          if (stateUpload.ok) archivePartial = true;
          else failures.push(`ARCHIVE-STATE.md: ${stateUpload.detail}`);
        }
        archiveNote = mirrorCompletion === 'completed'
          ? `✅ ${archiveBucket}(비공개) 로 ***${archivedCount}개*** 보관`
          : `⚠️ ${archiveBucket}(비공개) 부분 보관 — 완주 상태 ${mirrorCompletion}; 받은 파일 ${originFiles.length}개`;
        archiveNote += failures.length ? `  ⚠️ 실패 ${failures.length}건 — ${failures.join(' · ')}` : '';
      }
    }

    if (disabledMirrorCopy) {
      notes.push(`mirror-collapse=collapsed — 원문 HTML ${mirroredVisible}자 ↔ 브라우저로 연 미러 ${mirrorRenderedVisible}자. 원문 미러를 그냥 열면 본문이 줄어드니 ${disabledMirrorCopy.path} 을 대신 열어라.`);
    }

    if (renderLocation === 'client' || renderLocation === 'mixed') {
      notes.push(`render-location=${renderLocation} — 미러의 보이는 글자 ${mirroredVisible ?? '못 쟀다'}자 ↔ `
        + `렌더 ${renderedVisible ?? '못 쟀다'}자. ⛔ 정적 미러는 «껍데기»다(내용이 클라이언트에서 그려진다).`
        + (renderedSnapshot
          ? ` ✅ 그래서 origin/rendered.html 을 «같이» 남겼다 (글자 ${renderedSnapshot.gain?.toFixed(2) ?? '—'}배).`
            + (renderedSnapshot.localAssetLinks > 0
              ? ` ⛔ 그 파일은 «혼자 못 산다» — 같은 폴더의 미러 자산 ${renderedSnapshot.localAssetLinks}개에 기댄다(폴더째 옮겨라).`
              : ' ⭐ 같은 폴더 자산에 «안» 기댄다.')
            + (renderedSnapshot.externalLinks > 0
              ? ` ⛔ 링크 ${renderedSnapshot.externalLinks}개가 «네트워크»에서 오므로 오프라인 자립은 아니다.`
              : ' ⭐ 네트워크 링크가 «없다» — 오프라인에서도 선다.')
            + (canvasCount
              ? ` ⚠️ canvas ${canvasCount}개 — ***스냅샷에서 그 그림은 빈다***(스크립트를 얼렸으므로).`
              : '')
          : ' ⛔ 렌더 DOM 도 «못 얻었다».'));
    }

    const integrity = checkAssets(originFiles.map((rel) => {
      const abs = join(out, rel);
      let bytes = 0; let head = new Uint8Array();
      try {
        bytes = statSync(abs).size;
        const buf = readFileSync(abs);
        head = new Uint8Array(buf.subarray(0, 512));
      } catch { /* empty */ }
      return { path: rel, bytes, head };
    }));

    const result = {
      slug, url, out, dbPath, capturedAt, title, integrity,
      renderLocation, entryPath: indexPath, mirrorEntryLinks, mirrorEntryLinkDiagnosis,
      visibleText: { mirrored: mirroredVisible, rendered: renderedVisible, mirrorRendered: mirrorRenderedVisible },
      mirrorLiveTextRatio, mirrorCollapse, renderSettling, renderedSnapshot, disabledMirrorCopy, canvasCount,
      originFiles: originFiles.length,
      mirrorOk: mirrorCompletion === 'completed' || mirrorCompletion === 'partial-server-error',
      mirrorCompletion, mirrorDepth, mirrorAllowedHosts, mirrorExitCode: w.status ?? null,
      fullPageScreenshot: { bytes: shotBytes, dimensions: shotDims },
      tokens: tokens ? Object.keys(tokens.customProperties).length : null,
      derived: derived.map((d) => d.name), uploaded,
      notes: [cdpNote, mirrorOpenNote].filter((n): n is string => n !== null).concat(notes),
      archiveNote, archivedCount, archivePartial,
    };
    try {
      debug.log('webclone.archive', 'done', {
        url, slug, originCount: result.originFiles, capturedBytes: result.fullPageScreenshot.bytes,
        mirrorCompletion: result.mirrorCompletion, mirrorDepth: result.mirrorDepth,
        mirrorAllowedHosts: result.mirrorAllowedHosts, uploaded: result.uploaded,
        archiveBucket: options.archiveBucket ?? null, elapsedMs: Date.now() - startedAt,
      });
    } catch { /* observation failure */ }
    return result;
  } catch (error) {
    try {
      debug.log('webclone.archive', 'failed', { url: options.url, error: String(error) }, { level: 'error' });
    } catch { /* observation failure */ }
    throw error;
  }
}

export function formatArchiveRecord(r: ArchiveRecord): string[] {
  const mirrorStatus = {
    completed: `  미러 완료   재귀 깊이 ${r.mirrorDepth}; 링크 변환 완료`,
    'partial-server-error': `  미러 부분 완료 재귀 깊이 ${r.mirrorDepth}; 일부 자산이 서버 오류를 받았지만 내려받기와 링크 변환 완료 (wget 종료 코드 ${r.mirrorExitCode})`,
    failed: `  ⚠️ 미러 실패  재귀 깊이 ${r.mirrorDepth}; wget이 비정상 종료했다`,
    'timed-out': `  ⚠️ 시간 상한  재귀 깊이 ${r.mirrorDepth}; wget이 완료 전 중단되어 링크 변환이 실행되지 않았을 수 있어 보관본이 브라우저에서 열리지 않을 수 있다`,
    'index-missing': `  ⚠️ index 누락 재귀 깊이 ${r.mirrorDepth}; wget은 완료했지만 origin/index.html을 찾지 못했다`,
  }[r.mirrorCompletion];
  const lines = [
    `◆ design-archive — ${r.slug}`,
    `  원본        ${r.url}`,
    `  출력        ${r.out}`,
    `  원문 파일   ${r.originFiles}개  (html·css·js·에셋)`,
    `  허용 호스트 ${r.mirrorAllowedHosts === undefined ? '미기록/알 수 없음' : r.mirrorAllowedHosts.join(' · ') || '없음'}  (www. 형제만)`,
    mirrorStatus,
    ...(r.mirrorCompletion === 'completed' ? ['  파일명 정규화 브라우저에서 열리도록 쿼리를 파일명에서 제거하고 확장자를 붙였다'] : []),
    `  ${formatIntegrity(r.integrity)}`,
    `  전체 캡처   ${r.fullPageScreenshot.dimensions}  ${(r.fullPageScreenshot.bytes / 1024).toFixed(0)}KB   ⭐ CDP fullPage`,
    `  토큰        ${r.tokens ?? '못 쟀다'}`,
    `  파생물      ${r.derived.join(' · ')}`,
    `  인덱스      ${r.dbPath}`,
    `  렌더 위치   ${r.renderLocation}   (미러 ${r.visibleText.mirrored ?? '못 쟀다'}자 ↔ 렌더 ${r.visibleText.rendered ?? '못 쟀다'}자)`,
    `  미러 열기   ${r.mirrorCollapse}   (원문 ${r.visibleText.mirrored ?? '못 쟀다'}자 ↔ 브라우저 ${r.visibleText.mirrorRendered ?? '못 쟀다'}자)`,
    ...(r.mirrorEntryLinkDiagnosis === 'non-self-contained' && r.mirrorEntryLinks
      ? [`  ⚠️ 미러 진입 링크 로컬 ${r.mirrorEntryLinks.localAssetLinks}개 · 네트워크 ${r.mirrorEntryLinks.externalLinks}개 — 네트워크 없이 열면 생김새가 달라질 수 있다`]
      : []),
    ...(r.mirrorCollapse === 'partial-live-content' && r.mirrorLiveTextRatio !== null && r.mirrorLiveTextRatio !== undefined
      ? [`  라이브 대비 ${(r.mirrorLiveTextRatio * 100).toFixed(1)}% — 보관본이 라이브의 일부만 담았다`]
      : []),
    ...(r.renderSettling
      ? [`  렌더 대기   ${r.renderSettling.status} · ${r.renderSettling.waitedMs}ms · 관측 ${r.renderSettling.observations}회 · 최종 ${r.renderSettling.finalLength}자`
        + (r.renderSettling.status === 'never-grew'
          ? '  ⚠️ 본문 증가를 한 번도 보지 못했다 — 현재 renderLocation은 신뢰할 수 없다.'
          : r.renderSettling.status === 'capped'
            ? '  ⚠️ 전체 대기 상한에 닿았다 — 현재 renderLocation은 신뢰할 수 없다.'
            : '')]
      : []),
    ...(r.disabledMirrorCopy
      ? [`  미러 사본   ${r.disabledMirrorCopy.path} · 스크립트 ${r.disabledMirrorCopy.frozenScripts}개 무력화`,
        `  열기 안내   원문 미러 대신 이 사본을 열어라 — 옆 자산 주소는 그대로 보존했다`]
      : []),
    ...(r.renderedSnapshot
      ? [`  렌더 스냅샷 ${r.renderedSnapshot.path}  ${(r.renderedSnapshot.bytes / 1024).toFixed(0)}KB · 글자 ${r.renderedSnapshot.gain?.toFixed(2) ?? '—'}배 · 방아쇠 ${r.renderedSnapshot.trigger}`
        + (r.canvasCount ? `  ⚠️ canvas ${r.canvasCount}개` : ''),
        `  자립 조건   같은 폴더 자산 ${r.renderedSnapshot.localAssetLinks}개 필요 · 네트워크 링크 ${r.renderedSnapshot.externalLinks}개`
        + (r.renderedSnapshot.externalLinks > 0 ? '  ⛔ 오프라인 자립 아님' : ''),
        `  스크립트    ${r.renderedSnapshot.frozenScripts}개 무력화`
        + (r.renderedSnapshot.frozenScripts > 0
          ? '  ⭐ 안 얼리면 앱이 다시 부팅해 «다른 화면»(라우터 404 등)을 그린다'
          : '  (원래 없었다 — 이 스냅샷은 그대로도 정적이다)')]
      : []),
  ];
  for (const u of r.uploaded) lines.push(`  ☁️ 공개     ${u}`);
  lines.push(`  🔒 원문     ${r.archiveNote}`);
  for (const n of r.notes) lines.push(`  ⚠️ ${n}`);
  return lines;
}

export function archiveObtainedNothing(record: ArchiveRecord): boolean {
  return record.originFiles === 0
    && record.tokens === null
    && record.fullPageScreenshot.bytes === 0;
}
