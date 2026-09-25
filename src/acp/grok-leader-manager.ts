// Grok leader process manager — Showroom multi-lane cold start 최적화.
//
// Grok 의 Rust binary 가 startup cost 무거움 (~500ms binary load · ~500ms
// model warm-up · 합 ~1s). Showroom 의 4 grok lane spawn 시 4 instance
// 각각 cold start = ~4s 의 perceived latency. Grok CLI 가 `grok agent
// leader` subcommand 를 제공 — leader process 하나만 시작 · 추가 client
// 들이 `grok agent stdio --leader` 로 attach (~100ms thin client 만).
//
// 본 manager 는 daemon 안 lifecycle 자산:
//   1. ensureLeader() — leader process 가 살아있지 않으면 spawn
//   2. spawnClient(args) — thin client (`--leader` flag 추가) 의 spawn
//      args 반환 (AcpAgent 가 이걸로 자체 spawn)
//   3. shutdownLeader() — daemon hibernate / shutdown hook 시 호출
//
// **현재 상태**: infra-only. AcpAgent 의 default spawn 은 본 manager
// 사용 안 함 — Showroom multi-lane (ROADMAP A1+C1) 의 dogfood 결과 본
// 후 wire 진입. 즉 본 PR 은 *호출 site 없음* · 별 PR 에서 활용.
//
// **opt-in design**: 추후 wire 시 env var `MONAD_GROK_USE_LEADER=1` 또는
// AcpBackendSpec 의 별 option 으로 활성화 결정. 단일 lane 일 때는
// overhead 만 추가 (leader spawn + 통신 hop) — multi-lane 일 때만 가치.
//
// 참고:
//   `grok agent --help` 의 subcommand:
//     leader      Run as the shared leader process for other clients
//     stdio       Run the agent over stdio
//   flag:
//     --leader    Connect to a shared leader process instead of new
//     --no-leader Start new agent even when config enables leader mode

import { spawn, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Grok binary 의 표준 install path (xAI install.sh) — PATH 못 찾을 때
 *  fallback. backend-registry 의 grok entry 의 `extraBinCandidates` 와
 *  같은 정책. */
function resolveGrokBin(): string {
  const homePath = join(homedir(), '.grok', 'bin', 'grok');
  if (existsSync(homePath)) return homePath;
  return 'grok'; // PATH fallback
}

export interface GrokLeaderState {
  /** leader process 의 PID — null = 미시작 또는 exited. */
  pid: number | null;
  /** 마지막 spawn 시각 (ms · epoch). null = 미시작. */
  startedAt: number | null;
  /** 종료 코드 (정상 exit 시 0 · signal kill 시 negative). null = running. */
  exitCode: number | null;
}

export class GrokLeaderManager {
  private leader: ChildProcess | null = null;
  private startedAt: number | null = null;
  private exitCode: number | null = null;
  private readonly log: (msg: string) => void;

  constructor(opts: { log?: (msg: string) => void } = {}) {
    this.log = opts.log ?? (() => {});
  }

  /** Leader process 가 살아있으면 noop · 미시작 또는 exited 시 spawn.
   *  Idempotent — 동시 호출 시 race 방지 위해 caller 가 직렬화 보장.
   *
   *  Spawn args: `grok agent leader`. stdio 는 'pipe' 로 받아서 stderr
   *  log forward (사용자가 'grok login' 안 했을 때 등 surface). */
  ensureLeader(): GrokLeaderState {
    if (this.leader && this.leader.exitCode === null) {
      return this.state();
    }
    const bin = resolveGrokBin();
    this.log(`spawning grok leader: ${bin} agent leader`);
    const child = spawn(bin, ['agent', 'leader'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.leader = child;
    this.startedAt = Date.now();
    this.exitCode = null;
    child.stderr?.setEncoding('utf-8');
    child.stderr?.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (line.trim()) this.log(`grok leader stderr: ${line}`);
      }
    });
    child.on('exit', (code, signal) => {
      this.log(`grok leader exited (code=${code}, signal=${signal})`);
      this.exitCode = code ?? -1;
      this.leader = null;
    });
    return this.state();
  }

  /** Client spawn args 반환 — caller (AcpAgent) 가 이걸로 자체 spawn.
   *  `--leader` flag 추가해서 existing leader 에 attach.
   *  ensureLeader() 가 먼저 호출돼야 함 — race 시 grok binary 가 leader
   *  미발견 시 자체 fallback (새 instance) 로 동작. */
  spawnClient(extraArgs: string[] = []): { command: string; args: string[] } {
    return {
      command: resolveGrokBin(),
      args: ['agent', 'stdio', '--leader', ...extraArgs],
    };
  }

  /** Leader 종료 — daemon hibernate / shutdown hook 시. graceful SIGTERM
   *  먼저 · 2s timeout 후 SIGKILL. */
  async shutdownLeader(): Promise<void> {
    const proc = this.leader;
    if (!proc || proc.exitCode !== null) {
      this.leader = null;
      return;
    }
    this.log(`shutting down grok leader (pid=${proc.pid})`);
    return new Promise<void>((resolve) => {
      const onExit = () => {
        this.leader = null;
        resolve();
      };
      proc.once('exit', onExit);
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (proc.exitCode === null) {
          this.log('grok leader did not exit within 2s, sending SIGKILL');
          proc.kill('SIGKILL');
        }
      }, 2000);
    });
  }

  /** Snapshot state — observability / telemetry / health check. */
  state(): GrokLeaderState {
    return {
      pid: this.leader?.pid ?? null,
      startedAt: this.startedAt,
      exitCode: this.exitCode,
    };
  }

  /** Test / introspection only — leader process 핸들 직접 노출. 일반
   *  caller 는 ensureLeader/spawnClient/shutdownLeader 만 사용. */
  _leaderProcess(): ChildProcess | null {
    return this.leader;
  }
}

/** Daemon-wide singleton — daemon 의 lifecycle 안에서 한 instance.
 *  Lazy 생성 · 첫 호출 시 instantiate. shutdown 은 daemon hibernate hook
 *  에서 명시 호출. */
let _instance: GrokLeaderManager | null = null;

export function getGrokLeaderManager(): GrokLeaderManager {
  if (!_instance) _instance = new GrokLeaderManager();
  return _instance;
}

/** Test 용 — instance reset (각 테스트가 clean state 로 시작). */
export function _resetGrokLeaderManager(): void {
  _instance = null;
}
