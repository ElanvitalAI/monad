// H6 P2 Bundle 2 B · Model install automation.
//
// `LlmRequestInstall({nodeId, runtime, modelName})` workflow:
//   1. Resolve the node (must exist in fleet · reachable).
//   2. Run a disk precheck (`df -k /Users/$USER` local or via ssh)
//      · when an estimated size is provided, reject upfront if free
//        bytes < size × 1.5.
//   3. HITL gate via `requestConfirmation` — user sees "install
//      <model> via <runtime> on <node> · free=<G>GB · est size=<G>GB"
//      and approves/rejects on any wired channel (Telegram / Discord /
//      Pushcut / terminal race · H6 P7 infra).
//   4. Spawn the runtime-specific download command (`lms get <model>`
//      for lmstudio · `ollama pull <model>` for ollama) with a long
//      timeout (default 30 min).
//   5. On success, invalidate the manager cache so the next
//      `/llm models` call reprobes and reflects the new model.
//
// Design rails (PLAN §5 D24, D26):
//   - D24  `LlmRequestInstall` single T2 tool · boot/shutdown removed
//          (chat/run auto-load + PTY dispose cover the lifecycle)
//   - D26  `df -k` precheck · estimatedSizeBytes × 1.5 threshold ·
//          skip when caller omits size (warn-only)

import { spawn } from 'node:child_process';
import { debug } from '../../debug/log.js';
import { requestConfirmation, type ConfirmChannel } from '../../hitl/confirm.js';
import { findNode } from './node-registry.js';
import { _resetManagerForTesting, refreshInventory } from './manager.js';
import type { LlmRuntime } from './types.js';

export interface InstallRequest {
  readonly nodeId: string;
  readonly runtime: LlmRuntime;
  readonly modelName: string;
  /** Optional · when provided, triggers the disk precheck. */
  readonly estimatedSizeBytes?: number;
  /** Override the confirmation prompt timeout · default 120_000 (2 min). */
  readonly confirmTimeoutMs?: number;
  /** Override the download command timeout · default 30 min. */
  readonly installTimeoutMs?: number;
}

export type InstallResult =
  | {
      readonly ok: true;
      readonly nodeId: string;
      readonly runtime: LlmRuntime;
      readonly modelName: string;
      readonly elapsedMs: number;
      readonly diskFreeBytesBefore: number | undefined;
      readonly stdout: string;
    }
  | {
      readonly ok: false;
      readonly nodeId: string;
      readonly runtime: LlmRuntime;
      readonly modelName: string;
      readonly reason:
        | 'unknown-node'
        | 'unreachable'
        | 'unsupported-runtime'
        | 'disk-low'
        | 'user-denied'
        | 'user-timeout'
        | 'install-failed';
      readonly message: string;
      readonly elapsedMs: number;
    };

/** DI shape mirrors ManagerDeps · tests inject fake runLocal/runRemote
 *  to avoid spawning real `df`/`lms`/`ollama`. ConfirmChannels are also
 *  injectable so tests stage approve/reject without touching the global
 *  default channels. */
export interface InstallerDeps {
  readonly runLocal?: (
    argv: readonly string[],
    opts: { timeoutMs: number },
  ) => Promise<{ stdout: string; stderr: string }>;
  readonly runRemote?: (
    host: string,
    argv: readonly string[],
    opts: { timeoutMs: number; user?: string },
  ) => Promise<{ stdout: string; stderr: string }>;
  readonly confirmChannels?: readonly ConfirmChannel[];
  readonly now?: () => number;
  /** Called after a successful install to refresh the manager cache ·
   *  defaults to `refreshInventory`. Tests inject a no-op. */
  readonly onAfterInstall?: () => Promise<void>;
}

const DEFAULT_CONFIRM_TIMEOUT_MS = 120_000;
const DEFAULT_INSTALL_TIMEOUT_MS = 30 * 60_000; // 30 min

/** Core install workflow. */
export async function requestInstall(
  req: InstallRequest,
  deps: InstallerDeps = {},
): Promise<InstallResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();

  // 1. Node must exist AND be reachable.
  const node = findNode(req.nodeId);
  if (!node) {
    return fail(req, 'unknown-node', `unknown node '${req.nodeId}' · run /llm nodes to list the fleet`, now() - startedAt);
  }
  if (node.reachable !== true) {
    return fail(
      req,
      'unreachable',
      `node '${req.nodeId}' unreachable · check /llm nodes warnings and run /llm refresh`,
      now() - startedAt,
    );
  }

  // 2. Runtime command map.
  const cmd = installCmd(req.runtime, req.modelName);
  if (!cmd) {
    return fail(
      req,
      'unsupported-runtime',
      `runtime '${req.runtime}' not supported for install · only 'lmstudio' and 'ollama' (Bundle 2 B)`,
      now() - startedAt,
    );
  }

  // 3. Disk precheck (D26) · only when caller provides an estimate.
  let diskFreeBytesBefore: number | undefined = undefined;
  if (typeof req.estimatedSizeBytes === 'number' && req.estimatedSizeBytes > 0) {
    const free = await probeDiskFree(node, deps).catch(() => undefined);
    diskFreeBytesBefore = free;
    if (typeof free === 'number') {
      const required = Math.ceil(req.estimatedSizeBytes * 1.5);
      if (free < required) {
        return fail(
          req,
          'disk-low',
          `disk low on '${req.nodeId}' · need ~${formatGb(required)} GB (est size × 1.5), have ${formatGb(free)} GB`,
          now() - startedAt,
        );
      }
    }
  }

  // 4. HITL gate.
  const prompt = buildConfirmPrompt(req, diskFreeBytesBefore);
  const confirmOpts: Parameters<typeof requestConfirmation>[0] = {
    prompt: prompt.title,
    detail: prompt.detail,
    yesLabel: 'Install',
    noLabel: 'Cancel',
    timeoutMs: req.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS,
    onTimeout: () => false,
    requestId: `llm-install-${req.runtime}-${req.nodeId}-${req.modelName}`,
  };
  if (deps.confirmChannels) {
    (confirmOpts as { channels?: readonly ConfirmChannel[] }).channels = deps.confirmChannels;
  }
  const confirm = await requestConfirmation(confirmOpts);
  if (!confirm.answer) {
    const isTimeout = confirm.channel === 'timeout' || confirm.channel === 'all-failed';
    return fail(
      req,
      isTimeout ? 'user-timeout' : 'user-denied',
      isTimeout
        ? `install confirmation timed out after ${confirmOpts.timeoutMs}ms`
        : `user denied install via ${confirm.channel}`,
      now() - startedAt,
    );
  }

  // 5. Download execution.
  const installTimeoutMs = req.installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS;
  try {
    const r = await runCommand(node, cmd, deps, installTimeoutMs);
    // 6. Invalidate + refresh manager cache so next inventory query sees the new model.
    if (deps.onAfterInstall) {
      await deps.onAfterInstall();
    } else {
      // Reset + fresh probe so the newly installed model surfaces.
      _resetManagerForTesting();
      await refreshInventory().catch(() => { /* swallow · next /llm refresh will retry */ });
    }
    if (debug.enabled) {
      debug.log('llm.installer.ok', req.nodeId, {
        runtime: req.runtime,
        model: req.modelName,
        elapsedMs: now() - startedAt,
      });
    }
    return {
      ok: true,
      nodeId: req.nodeId,
      runtime: req.runtime,
      modelName: req.modelName,
      elapsedMs: now() - startedAt,
      diskFreeBytesBefore,
      stdout: r.stdout.slice(-4000), // keep last 4KB for logs
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (debug.enabled) {
      debug.log('llm.installer.failed', req.nodeId, {
        runtime: req.runtime,
        model: req.modelName,
        message: msg,
      }, { level: 'error' });
    }
    return fail(req, 'install-failed', msg, now() - startedAt);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function installCmd(runtime: LlmRuntime, modelName: string): readonly string[] | null {
  switch (runtime) {
    case 'lmstudio':
      // `lms get <model>` downloads to the user's LM Studio models dir. ★ 2026-07-15 — HF repo id
      // (`org/model`)는 **전체 HF URL 로 변환**해 넘긴다: `lms get org/model` 형식은 LM Studio 카탈로그/
      // staff-picks 경유(대소문자 소문자화 → "artifact 없음"·node-b 실증)라 임의 mlx-community 레포를 못
      // 받는다. help 명시대로 전체 URL 이면 HF 직접 다운로드. `-y`로 비대화(스크립트·SSH 무프롬프트).
      return ['lms', 'get', toLmsGetArg(modelName), '-y'];
    case 'ollama':
      // `ollama pull <model>` downloads to ~/.ollama/models.
      return ['ollama', 'pull', modelName];
    default:
      // mlx / llamacpp / docker not supported in Bundle 2 B.
      return null;
  }
}

/** lms get 인자 정규화 — 이미 URL 이면 그대로, `org/model` HF repo id 면 전체 HF URL, 그 외(카탈로그 검색어)
 *  는 그대로. 순수·테스트 가능. */
export function toLmsGetArg(modelName: string): string {
  if (/^https?:\/\//.test(modelName)) return modelName;
  // `org/model`(슬래시 1개·공백·@ 없음) = HF repo id → 전체 URL. `@quant`(lms 네이티브)·검색어는 그대로.
  if (/^[^\s/@]+\/[^\s/@]+$/.test(modelName)) return `https://huggingface.co/${modelName}`;
  return modelName;
}

async function probeDiskFree(
  node: { isLocal: boolean; sshHost?: string; sshUser?: string },
  deps: InstallerDeps,
): Promise<number | undefined> {
  const argv = ['df', '-k', process.env.HOME ?? '/'];
  try {
    let stdout: string;
    if (node.isLocal) {
      const runner = deps.runLocal ?? runLocalDefault;
      const r = await runner(argv, { timeoutMs: 10_000 });
      stdout = r.stdout;
    } else {
      if (!node.sshHost) return undefined;
      const runner = deps.runRemote ?? runRemoteDefault;
      const r = await runner(node.sshHost, argv, {
        timeoutMs: 10_000,
        ...(node.sshUser ? { user: node.sshUser } : {}),
      });
      stdout = r.stdout;
    }
    return parseDfAvailableBytes(stdout);
  } catch {
    return undefined;
  }
}

/** Parse `df -k` stdout · returns available bytes on the target
 *  filesystem. `df -k` reports 1024-byte blocks so we multiply by
 *  1024. Permissive — returns undefined when the shape doesn't match. */
export function parseDfAvailableBytes(stdout: string): number | undefined {
  // Typical shape:
  //   Filesystem    1024-blocks      Used Available Capacity iused ifree %iused  Mounted on
  //   /dev/disk3s1s1 ...           ...  ...        ...      ...   ...   ...     /
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return undefined;
  const cols = lines[1]!.trim().split(/\s+/);
  // Column 3 (0-indexed) is Available 1024-blocks. Some systems pack
  // the filesystem name onto the next line; try column 2 as fallback.
  const kbytesRaw = cols[3] ?? cols[2];
  const kbytes = Number.parseInt(kbytesRaw ?? '', 10);
  if (!Number.isFinite(kbytes) || kbytes < 0) return undefined;
  return kbytes * 1024;
}

async function runCommand(
  node: { isLocal: boolean; sshHost?: string; sshUser?: string },
  argv: readonly string[],
  deps: InstallerDeps,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  if (node.isLocal) {
    const runner = deps.runLocal ?? runLocalDefault;
    return runner(argv, { timeoutMs });
  }
  if (!node.sshHost) throw new Error(`node missing sshHost`);
  const runner = deps.runRemote ?? runRemoteDefault;
  return runner(node.sshHost, argv, {
    timeoutMs,
    ...(node.sshUser ? { user: node.sshUser } : {}),
  });
}

function buildConfirmPrompt(
  req: InstallRequest,
  diskFreeBytes: number | undefined,
): { title: string; detail: string } {
  const title = `Install ${req.modelName} via ${req.runtime} on ${req.nodeId}?`;
  const parts: string[] = [];
  if (typeof req.estimatedSizeBytes === 'number') {
    parts.push(`est size: ${formatGb(req.estimatedSizeBytes)} GB`);
  }
  if (typeof diskFreeBytes === 'number') {
    parts.push(`free: ${formatGb(diskFreeBytes)} GB`);
  }
  parts.push(`cmd: ${installCmd(req.runtime, req.modelName)?.join(' ') ?? '—'}`);
  return { title, detail: parts.join(' · ') };
}

function formatGb(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(1);
}

function fail(
  req: InstallRequest,
  reason: Extract<InstallResult, { ok: false }>['reason'],
  message: string,
  elapsedMs: number,
): Extract<InstallResult, { ok: false }> {
  return {
    ok: false,
    nodeId: req.nodeId,
    runtime: req.runtime,
    modelName: req.modelName,
    reason,
    message,
    elapsedMs,
  };
}

// ─── Default runners (prod) ─────────────────────────────────────────

async function runLocalDefault(
  argv: readonly string[],
  opts: { timeoutMs: number },
): Promise<{ stdout: string; stderr: string }> {
  return runSpawn(argv[0]!, argv.slice(1), opts.timeoutMs);
}

/** 단일 인용 셸 이스케이프(로그인 셸 래핑용). */
function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

async function runRemoteDefault(
  host: string,
  argv: readonly string[],
  opts: { timeoutMs: number; user?: string },
): Promise<{ stdout: string; stderr: string }> {
  const target = opts.user ? `${opts.user}@${host}` : host;
  // ⚠️ 비로그인 SSH PATH 에는 `lms`(~/.lmstudio/bin) · `ollama`(~/.local/bin 등)가 없다(node-b 실측
  //   2026-07-15). 로그인 셸(`bash -lc`)로 감싸고 런타임 CLI 디렉터리를 PATH 앞에 붙여 full-path 없이도
  //   해석되게 한다. 원격 명령은 단일 인용으로 이스케이프해 원문 그대로 전달.
  const remoteCmd = argv.map(shSingleQuote).join(' ');
  const wrapped = `export PATH="$HOME/.lmstudio/bin:$HOME/.local/bin:$PATH"; ${remoteCmd}`;
  const sshArgs = [
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${Math.max(1, Math.floor(opts.timeoutMs / 1000 / 2))}`,
    '-o', 'StrictHostKeyChecking=accept-new',
    target,
    'bash', '-lc', wrapped,
  ];
  return runSpawn('ssh', sshArgs, opts.timeoutMs);
}

function runSpawn(
  bin: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGKILL');
      reject(new Error(`install timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.stdout?.on('data', (d) => { stdout += d.toString('utf8'); });
    proc.stderr?.on('data', (d) => { stderr += d.toString('utf8'); });
    proc.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    proc.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(
          `${bin} exited ${code} · stderr=${stderr.trim().slice(0, 200)}`,
        ));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}
