// monad fleet — 멀티 인스턴스 통합 뷰 (§10 Control Plane/Fleet · 2026-07-24).
//
// `monad logs instances` 가 로그 스토어만 보여주던 것을 **전 스토어**로 일반화.
// "쓰기는 물리 격리(state-dir)·읽기는 연합(home 레지스트리)" 불변식(logs --all 선례).
// K8s `kubectl get nodes` 등가 — 등록 인스턴스(name·alive·repo·state-dir·보유 스토어)를
// 한 화면에. 스토어 보유 매트릭스에 frame(pty-manifest) 포함 — `fleet screen [--all]` 이 크로스-인스턴스
// pty 화면 프레임을 read-only union 으로 조회(listPtyManifestAt·logs --all 선례).

import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { isTestInstance, readLogInstances, resolveInstanceKind, type InstanceKind, type LogInstanceView } from '../mss/logging/instance-registry.js';

export interface FleetStoreSet { logs: boolean; sessions: boolean; tasks: boolean; memory: boolean; opsEvents: boolean; schedules: boolean; mandate: boolean; frame: boolean }

export interface FleetInstance {
  name: string;
  stateDir: string;
  /** config-dir(tasks/nexus 스코프) — entry.configDir ?? stateDir. Class 3(연합 tasks 경로오도) 해소. */
  configDir: string;
  repoPath?: string;
  /** 인스턴스 종류 — 데이터 연합(ops/recall)은 'test' 를 기본 제외한다(Phase A). */
  kind: InstanceKind;
  hostId?: string;
  hostname?: string;
  liveness: 'alive' | 'dead' | 'remote';
  alive: boolean;
  pid: number;
  startedAt: string;
  stores: FleetStoreSet;
}

export interface FleetViewOpts {
  /** 테스트 주입 — 미지정 시 readLogInstances(). */
  instances?: Array<{ name: string; stateDir: string; configDir?: string; repoPath?: string; hostId?: string; hostname?: string; liveness?: LogInstanceView['liveness']; alive: boolean; pid: number; startedAt: string }>;
  /** 존재 판정 seam(테스트) — 미지정 시 existsSync. */
  exists?: (p: string) => boolean;
}

/** 인스턴스 stateDir → 각 스토어 정본 경로. sessions/tasks 는 state-dir 기반(config-dir==
 *  state-dir 관례 · 격리 프로토콜), surface_events 는 scoped=`<stateDir>/surface_events.db`
 *  이나 prod(~/.monad)만 `memory/` 서브(memoryDbPath 비대칭). fleet 연합 조회(ops/recall)가
 *  이 한 곳을 재사용해 경로 도출을 단일화한다.
 *  opsEvents/schedules/mandate 는 monadStateRoot() 평면(state-dir 직속·서브폴더 없음) —
 *  ops 전체 종합(loops/스케줄/오케스트레이션) 연합을 위해 opsSnapshot 에 주입할 경로. */
export function instanceStorePaths(stateDir: string, configDir: string = stateDir): { logs: string; sessions: string; tasks: string; memory: string; opsEvents: string; schedules: string; mandate: string; frame: string; events: string } {
  const isProd = stateDir === join(homedir(), '.monad');
  return {
    logs: join(stateDir, 'logs', 'logs.db'),
    sessions: join(stateDir, 'sessions', 'index.json'),
    // tasks.db 는 config-dir 스코프(getMonadConfigDir) — state-dir 아님(Class 3). configDir
    // 미기록 구항목은 stateDir 폴백(config-dir==state-dir 관례). prod 는 둘이 일치.
    tasks: join(configDir, 'tasks', 'tasks.db'),
    memory: isProd ? join(homedir(), '.monad', 'memory', 'surface_events.db') : join(stateDir, 'surface_events.db'),
    // ops_events(loops·orchestration)·schedules·mandate 는 state-dir 평면(monadStateRoot()).
    opsEvents: join(stateDir, 'ops_events.db'),
    schedules: join(stateDir, 'schedules.db'),
    mandate: join(stateDir, 'finance-trade-mandate.json'),
    frame: join(stateDir, 'pty', 'manifest.db'),
    events: join(stateDir, 'pty', 'events.db'),
  };
}

/** 등록 인스턴스 + 보유 스토어 매트릭스. prod(~/.monad) 는 레지스트리 미등록이어도 항상 포함.
 *  stateDir(물리 identity)로 dedup. */
export function buildFleetView(opts: FleetViewOpts = {}): FleetInstance[] {
  const exists = opts.exists ?? existsSync;
  const raw = opts.instances
    ?? readLogInstances().map((v) => ({ name: v.name, stateDir: v.stateDir, configDir: v.configDir, repoPath: v.repoPath, hostId: v.hostId, hostname: v.hostname, liveness: v.liveness, alive: v.alive, pid: v.pid, startedAt: v.startedAt }));
  const byDir = new Map<string, typeof raw[number]>();
  // prod 항상(레지스트리에 있으면 그 엔트리가 우선).
  const prodDir = join(homedir(), '.monad');
  if (!raw.some((r) => r.stateDir === prodDir)) {
    byDir.set(prodDir, { name: 'prod', stateDir: prodDir, configDir: prodDir, alive: false, pid: 0, startedAt: '' });
  }
  for (const r of raw) if (!byDir.has(r.stateDir)) byDir.set(r.stateDir, r);
  return [...byDir.values()].map((i) => {
    const configDir = i.configDir ?? i.stateDir;
    const p = instanceStorePaths(i.stateDir, configDir);
    return {
      name: i.name, stateDir: i.stateDir, configDir, repoPath: i.repoPath, kind: resolveInstanceKind(i),
      hostId: i.hostId, hostname: i.hostname, liveness: i.liveness ?? (i.alive ? 'alive' : 'dead'),
      alive: i.alive, pid: i.pid, startedAt: i.startedAt,
      stores: {
        logs: exists(p.logs), sessions: exists(p.sessions), tasks: exists(p.tasks), memory: exists(p.memory),
        opsEvents: exists(p.opsEvents), schedules: exists(p.schedules), mandate: exists(p.mandate), frame: exists(p.frame),
      },
    };
  }).sort((a, b) => (a.alive === b.alive ? a.name.localeCompare(b.name) : a.alive ? -1 : 1));
}

/** PTY 매니페스트(=`frame`) 연합 조회 대상 하나. */
export interface PtyManifestTarget { readonly name: string; readonly dbPath: string }

export interface PtyManifestTargetDeps {
  readonly instances?: readonly { name: string; stateDir: string; configDir?: string; kind?: unknown }[];
  readonly exists?: (path: string) => boolean;
  readonly realpath?: (path: string) => string;
  readonly isTest?: (entry: { name: string; stateDir: string; configDir?: string; kind?: unknown }) => boolean;
}

/** ⭐⭐ **연합 조회 대상의 SSOT** (2026-07-30 · 리뷰 must-fix).
 *  `fleet screen --all` 과 `pty list --all` 이 **각자 조립**하면 두 창구가 조용히 갈린다 —
 *  실제로 그렇게 만들었다가 리뷰가 잡았다. ⇒ 열거는 여기 한 곳이다.
 *  ⛔ 격리 test 는 기본 제외 · prod(`~/.monad`)는 레지스트리 미등록이어도 포함 · **물리 경로로 dedup**. */
export function ptyManifestTargets(opts: { includeTest?: boolean } = {}, deps: PtyManifestTargetDeps = {}): PtyManifestTarget[] {
  const exists = deps.exists ?? existsSync;
  const realpath = deps.realpath ?? ((p: string) => { try { return realpathSync(p); } catch { return p; } });
  const isTest = deps.isTest ?? ((entry) => isTestInstance(entry as Parameters<typeof isTestInstance>[0]));
  const entries = deps.instances ?? readLogInstances();
  const targets: PtyManifestTarget[] = [];
  const seen = new Set<string>();
  const push = (name: string, dbPath: string) => {
    if (!exists(dbPath)) return;
    const normalized = realpath(dbPath);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    targets.push({ name, dbPath: normalized });
  };
  push('prod', instanceStorePaths(join(homedir(), '.monad')).frame);
  for (const entry of entries) {
    if (isTest(entry) && opts.includeTest !== true) continue;
    push(entry.name, instanceStorePaths(entry.stateDir, entry.configDir).frame);
  }
  return targets;
}

/** PTY lifecycle ledger union targets. Unlike the manifest listing, missing ledgers remain targets so callers can report missing separately from unreadable. */
export function ptyEventLogTargets(opts: { includeTest?: boolean } = {}, deps: PtyManifestTargetDeps = {}): PtyManifestTarget[] {
  const realpath = deps.realpath ?? ((p: string) => { try { return realpathSync(p); } catch { return p; } });
  const isTest = deps.isTest ?? ((entry) => isTestInstance(entry as Parameters<typeof isTestInstance>[0]));
  const entries = deps.instances ?? readLogInstances();
  const targets: PtyManifestTarget[] = [];
  const seen = new Set<string>();
  const push = (name: string, dbPath: string) => {
    const normalized = realpath(dbPath);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    targets.push({ name, dbPath: normalized });
  };
  push('prod', instanceStorePaths(join(homedir(), '.monad')).events);
  for (const entry of entries) {
    if (isTest(entry) && opts.includeTest !== true) continue;
    push(entry.name, instanceStorePaths(entry.stateDir, entry.configDir).events);
  }
  return targets;
}
