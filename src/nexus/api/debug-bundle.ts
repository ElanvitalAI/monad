// debug-bundle.ts — POST /v1/debug-bundle
//
// iOS (or any client) posts a symptom + recent in-memory debug log; the
// daemon stitches it together with its own ~/.elanous/log/debug-*.log tail
// and uploads the bundle to S3 under the `debug-bundle/` feature prefix.
// The response carries the public HTTPS URL plus a paste-ready prompt
// so the user can drop it into any external LLM (Claude / GPT / Grok
// / Gemini) without retyping context. The iPad's `UIPasteboard.general`
// + Apple's Universal Clipboard sends the prompt straight to the user's
// Mac too.

import { existsSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { elanousStateRoot } from '../../autopilot/state-paths.js';
import { join } from 'node:path';
import { isS3Available, s3ElanousKey, s3PublicUrl, s3Uri, uploadFile } from '../../storage/s3.js';

export interface DebugBundleRequest {
  symptom: string;
  surface?: string;
  appLog?: string;
  context?: Record<string, unknown>;
  /** 2026-05-19 — base64-encoded PNG of the user's active screen at the
   *  moment Bundle & Share was tapped. Optional · daemon uploads it as a
   *  sibling object (`<stamp>.png`) and embeds the public URL into the
   *  markdown via an image link. Lets external LLMs see the same UI the
   *  user saw without needing AirDrop / scp. */
  screenshotPngBase64?: string;
}

export interface DebugBundleResponse {
  url: string;
  key: string;
  prompt: string;
  /** 2026-05-19 — public URL of the uploaded screenshot, present when the
   *  request included `screenshotPngBase64`. iOS can show "Share image"
   *  alongside "Share prompt"/"Share URL" for direct hand-off to Telegram
   *  / Notes / Mail without re-rendering on device. */
  screenshotUrl?: string;
}

const DAEMON_LOG_TAIL_BYTES = 64 * 1024; // 64 KB ≈ ~500 lines · enough for recent context without exploding the bundle

/** Resolve the most recent daemon debug log file, if any.
 *
 *  LF0 수리(2026-07-13): 종전엔 `~/.elanous/log/` 만 스캔했는데 실제 debug.log
 *  파일 트레일은 `<cwd>/log/debug-*.log`(프로젝트-로컬)라 cwd 가 `~/.elanous`
 *  가 아닌 데몬에서 번들에 데몬 로그가 통째로 누락됐다. 1순위 = 살아있는
 *  트레이서 자신의 활성 파일(`debug.path()`), 폴백 = 구 경로 스캔. */
async function findLatestDaemonLog(): Promise<string | null> {
  try {
    const { debug } = await import('../../debug/log.js');
    const live = debug.path();
    if (live && existsSync(live)) return live;
  } catch { /* fallthrough */ }
  const dir = join(elanousStateRoot(), 'log');
  try {
    const entries = readdirSync(dir).filter((n) => n.startsWith('debug-') && n.endsWith('.log'));
    if (entries.length === 0) return null;
    entries.sort();
    return join(dir, entries[entries.length - 1]!);
  } catch {
    return null;
  }
}

/** Read the trailing slice of a file. Returns empty string on miss. */
async function readTail(path: string, maxBytes: number): Promise<string> {
  try {
    const size = statSync(path).size;
    const offset = Math.max(0, size - maxBytes);
    const handle = await readFile(path);
    return handle.subarray(offset).toString('utf8');
  } catch {
    return '';
  }
}

/** Compose the markdown bundle. Sections are stable so external LLMs
 *  can prompt against predictable headings ("## Symptom" etc.). 2026-05-19
 *  — screenshot section optional; only emitted when the iOS client also
 *  uploaded a PNG so the bundle stays valid for legacy clients. */
function composeMarkdown(
  req: DebugBundleRequest,
  daemonLog: string,
  generatedAt: Date,
  screenshotUrl: string | null,
): string {
  const symptom = (req.symptom || '').trim() || '(no symptom provided)';
  const surface = (req.surface || '').trim() || 'unspecified';
  const contextJson = req.context ? JSON.stringify(req.context, null, 2) : '(none)';
  const appLog = (req.appLog || '').trim() || '(no app log captured)';
  const daemonSection = daemonLog.trim() || '(no daemon log available)';
  const screenshotBlock = screenshotUrl
    ? ['## Screenshot', `![Screenshot](${screenshotUrl})`, screenshotUrl, '']
    : [];
  return [
    `# Debug Bundle · ${generatedAt.toISOString()}`,
    '',
    '## Symptom',
    symptom,
    '',
    '## Surface',
    surface,
    '',
    ...screenshotBlock,
    '## Context',
    '```json',
    contextJson,
    '```',
    '',
    '## iOS App Log',
    '```',
    appLog,
    '```',
    '',
    '## Daemon Log (tail)',
    '```',
    daemonSection,
    '```',
    '',
  ].join('\n');
}

/** Compose the paste-ready prompt template. Short on purpose — the
 *  user (or the receiving LLM) can expand from the bundle URL. 2026-05-19
 *  — screenshotUrl 도 같이 받아 prompt 본문에 명시 포함. 외부 LLM 이
 *  prompt 만 paste 해도 markdown + PNG 두 source 모두 한 번에 fetch —
 *  텍스트 로그와 화면 동시에 보고 풍부한 디버깅. */
export function composePrompt(
  req: DebugBundleRequest,
  url: string,
  screenshotUrl: string | null = null,
): string {
  const symptom = (req.symptom || '').trim() || '(no symptom provided)';
  const surface = (req.surface || '').trim() || 'unspecified';
  const screenshotBlock = screenshotUrl
    ? ['## Screenshot (PNG · 사용자가 본 화면)', screenshotUrl, '']
    : [];
  return [
    '다음은 monad-agent (iPad + macOS · ACP/MCP/REST fabric) 의 debug bundle 입니다.',
    '',
    '## 증상',
    symptom,
    '',
    '## Surface',
    surface,
    '',
    '## Bundle (full markdown · iOS app log + daemon log tail 포함)',
    url,
    '',
    ...screenshotBlock,
    '이 증상의 root cause + suggested fix 를 분석해 주세요:',
    '1. surface (chat / terminal / iPad) 별 동작 불일치 의심 영역',
    '2. 최근 코드 변경 중 의심 영역 (git log · recent PR 등)',
    '3. 재현 step + 추가 진단 필요 시 명령',
  ].join('\n');
}

/** Build the S3 key for the bundle. Per-second granularity is enough —
 *  the user is unlikely to hit the same second twice during dogfood. */
function bundleKey(now: Date): string {
  return s3ElanousKey('debugBundle', `${bundleStamp(now)}.md`);
}

/** 2026-05-19 — screenshot key paired to the bundle. Same stamp + `.png`
 *  suffix so the markdown link is trivially derivable. */
function screenshotKey(now: Date): string {
  return s3ElanousKey('debugBundle', `${bundleStamp(now)}.png`);
}

function bundleStamp(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}-${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}`;
}

/** Core upload pipeline · pure (no Request/Response) for unit tests. */
export async function buildAndUploadBundle(
  req: DebugBundleRequest,
  now: Date = new Date(),
  deps: {
    findLatestLog?: () => string | null | Promise<string | null>;
    tailReader?: (path: string, maxBytes: number) => Promise<string>;
    uploader?: (localPath: string, key: string) => void;
    available?: () => boolean;
  } = {},
): Promise<DebugBundleResponse> {
  const findLatest = deps.findLatestLog ?? findLatestDaemonLog;
  const tailReader = deps.tailReader ?? readTail;
  const upload = deps.uploader ?? uploadFile;
  const available = deps.available ?? isS3Available;
  if (!available()) {
    throw new Error('s3-not-configured');
  }
  const daemonLogPath = await findLatest();
  const daemonLog = daemonLogPath ? await tailReader(daemonLogPath, DAEMON_LOG_TAIL_BYTES) : '';

  // Stage the markdown (and optional screenshot) to a tempdir first —
  // `aws s3 cp` works on local paths and the temp lifetime is bounded by
  // this scope. Screenshot uploads first so the bundle markdown can
  // embed its public URL.
  const tmpDir = mkdtempSync(join(tmpdir(), 'elanous-debug-bundle-'));
  const key = bundleKey(now);
  let screenshotUrl: string | null = null;
  try {
    if (req.screenshotPngBase64 && req.screenshotPngBase64.length > 0) {
      try {
        const pngBuf = Buffer.from(req.screenshotPngBase64, 'base64');
        if (pngBuf.length > 0) {
          const tmpPng = join(tmpDir, 'screenshot.png');
          writeFileSync(tmpPng, pngBuf);
          const pngKey = screenshotKey(now);
          upload(tmpPng, pngKey);
          screenshotUrl = s3PublicUrl(pngKey);
        }
      } catch {
        // Screenshot upload is best-effort — never fail the markdown
        // bundle just because the PNG was malformed or S3 rejected it.
        screenshotUrl = null;
      }
    }
    const markdown = composeMarkdown(req, daemonLog, now, screenshotUrl);
    const tmpFile = join(tmpDir, 'bundle.md');
    writeFileSync(tmpFile, markdown, 'utf8');
    upload(tmpFile, key);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  const url = s3PublicUrl(key);
  return {
    url,
    key,
    prompt: composePrompt(req, url, screenshotUrl),
    ...(screenshotUrl ? { screenshotUrl } : {}),
  };
}

/** HTTP handler. POST /v1/debug-bundle. */
export async function handleDebugBundlePost(req: Request): Promise<Response> {
  let payload: DebugBundleRequest;
  try {
    payload = (await req.json()) as DebugBundleRequest;
  } catch {
    return jsonError(400, 'invalid-json');
  }
  if (!payload || typeof payload.symptom !== 'string' || payload.symptom.trim().length === 0) {
    return jsonError(400, 'symptom-required');
  }
  // Hard cap on inbound size to keep the bundle from ballooning when a
  // misbehaving client posts an unbounded log buffer. The daemon-side
  // tail is bounded separately by DAEMON_LOG_TAIL_BYTES.
  if ((payload.appLog?.length ?? 0) > 512 * 1024) {
    payload.appLog = (payload.appLog || '').slice(-512 * 1024);
  }
  // 2026-05-19 — screenshot base64 hard cap (~8 MB encoded · ~6 MB PNG).
  // iPad screenshots at native resolution + retina end up around 2-4 MB
  // PNG which encodes to ~3-5 MB base64; the 8 MB cap leaves headroom
  // without letting a runaway client OOM the daemon.
  if ((payload.screenshotPngBase64?.length ?? 0) > 8 * 1024 * 1024) {
    payload.screenshotPngBase64 = undefined;
  }
  try {
    const result = await buildAndUploadBundle(payload);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 's3-not-configured') {
      return jsonError(503, 's3-not-configured', 'AWS CLI not on PATH or credentials missing. Run `aws sts get-caller-identity`.');
    }
    return jsonError(500, 'upload-failed', msg);
  }
}

function jsonError(status: number, error: string, detail?: string): Response {
  const body: Record<string, unknown> = { error };
  if (detail) body.detail = detail;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

// Re-exports for tests + nexus wire surface.
export { s3Uri };
