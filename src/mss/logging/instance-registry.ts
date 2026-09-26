// ── 로그 인스턴스 레지스트리 (LF7-b · 2026-07-13) ────────────────────────────
//
// 멀티 엘라누스(prod 1 + 폴더별 test N) 운영에서 "어떤 인스턴스들이 어디에
// 있나"를 발견(discovery)하는 단일 창구. 데몬이 부팅 시 자기 정보를 등록하고,
// `elanous logs --instance/--all` 과 PWA 연합 뷰(LF7-d)가 읽는다.
//
// 원칙 (docs/plans PLAN-unified-log-fabric §LF7):
//   • 레지스트리는 **메타데이터 only** — 로그 레코드의 교차 쓰기 벡터가
//     아니다. 위치는 항상 prod 홈(`~/.elanous/logs/instances.json`) — test
//     데몬도 여기 등록해야 발견이 성립한다(state dir 격리 대상 아님).
//   • 항목은 종료 시 지우지 않는다 — 죽은 인스턴스의 logs.db 도 조회
//     가치가 있다(생존 여부는 pid liveness 로 읽기 시점 판정).
//   • 로컬 state dir 폴더가 사라진 항목만 read 시점에 정리(prune).
//     원격 경로의 로컬 부재는 삭제 근거가 아니다.
//   • upsert 키 = stateDir (물리 identity). name 은 표시/조회용.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { isPidAlive } from '../../process/pid-liveness.js';
import { resolveHostId } from '../../platform/host-id.js';

/** 인스턴스 종류 — 격리 test 인스턴스는 데이터 연합(ops/recall/session/logs --all)에서
 *  기본 제외해야 오염이 안 된다(Instance Identity 수렴 · Phase A). 병렬 비-test 인스턴스
 *  (axon 등)는 'prod' 로 남아 정상 연합된다. */
export type InstanceKind = 'prod' | 'test';

export interface LogInstanceEntry {
  /** 표시/조회 이름 — resolveLogInstanceName() 산출(prod · test:<repo> …). */
  name: string;
  /** 물리 identity — 이 인스턴스의 state root (logs/logs.db 의 부모). */
  stateDir: string;
  /** 소속 레포 루트(있으면) — test 인스턴스의 사람용 힌트. */
  repoPath?: string;
  /** 인스턴스 종류(등록시점 스탬프). 미기록 구항목은 read 시점에 name/stateDir 로 유추. */
  kind?: InstanceKind;
  /** config-dir(getElanousConfigDir · tasks.db/nexus 스코프). 미기록 구항목은 stateDir 로 폴백
   *  (config-dir==state-dir 관례). 기록하면 연합이 tasks 경로를 정확히 도출(Class 3 해소). */
  configDir?: string;
  hostId?: string;
  hostname?: string;
  pid: number;
  httpPort?: number;
  startedAt: string;
}

export interface LogInstanceView extends LogInstanceEntry {
  /** 같은 표시 이름에 등록된 서로 다른 stateDir 수. */
  stateDirCount: number;
  /** 같은 이름이 둘 이상의 물리 stateDir에 걸렸는지. */
  ambiguous: boolean;
  /** 유효 종류 — entry.kind ?? (name/stateDir 유추). 연합 필터의 기준. */
  kind: InstanceKind;
  /** 유효 config-dir — entry.configDir ?? stateDir. tasks/nexus 경로 도출 기준. */
  configDir: string;
  /** 로컬 pid 판정 또는 다른 기계의 미확인 상태. */
  liveness: 'alive' | 'dead' | 'remote';
  /** 로컬 pid 생존 여부. 원격은 false (죽음 판정 아님). */
  alive: boolean;
  /** `<stateDir>/logs/logs.db` 존재 여부. */
  dbExists: boolean;
  dbPath: string;
}

/** 유효 종류 판정 — 명시 kind 우선, 없으면 격리 test 관례(`.elanous-test` 폴더 / `test:` 이름
 *  prefix)로 유추. 이 관례를 안 타는 병렬 인스턴스(axon 등)는 'prod'. */
export function resolveInstanceKind(entry: { kind?: InstanceKind; name?: string; stateDir?: string }): InstanceKind {
  if (entry.kind) return entry.kind;
  const base = entry.stateDir ? entry.stateDir.replace(/\/+$/, '').split('/').pop() : '';
  if (base === '.elanous-test' || (entry.name?.startsWith('test:') ?? false)) return 'test';
  return 'prod';
}

/** 격리 test 인스턴스 여부 — 데이터 연합 기본 제외 술어. */
export function isTestInstance(entry: { kind?: InstanceKind; name?: string; stateDir?: string }): boolean {
  return resolveInstanceKind(entry) === 'test';
}

export function logInstanceRegistryPath(): string {
  return join(homedir(), '.elanous', 'logs', 'instances.json');
}

function validEntry(entry: unknown): entry is LogInstanceEntry {
  return !!entry && typeof entry === 'object'
    && typeof (entry as LogInstanceEntry).name === 'string'
    && typeof (entry as LogInstanceEntry).stateDir === 'string'
    && typeof (entry as LogInstanceEntry).pid === 'number'
    && typeof (entry as LogInstanceEntry).startedAt === 'string';
}

function readRaw(path: string): LogInstanceEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { instances?: unknown };
    if (!Array.isArray(parsed.instances)) return [];
    return parsed.instances.filter(validEntry);
  } catch {
    return []; // 없음/파손 — 빈 레지스트리로 취급(등록이 재생성)
  }
}

/** 레지스트리를 한 번 읽어 성공 여부와 유효 인스턴스 뷰를 함께 준다.
 * 유효 JSON의 손상 항목은 기존 읽기처럼 제외하지만, 레지스트리 자체의 조회 성공은 보존한다. */
export function readLogInstanceScope(
  registryPath: string = logInstanceRegistryPath(),
): { instances: LogInstanceView[]; queryStatus: { registeredStores: boolean } } {
  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf-8')) as { instances?: unknown };
    if (!Array.isArray(parsed.instances)) throw new Error('malformed log instance registry');
    return { instances: logInstanceViews(parsed.instances.filter(validEntry), registryPath), queryStatus: { registeredStores: true } };
  } catch {
    return { instances: [], queryStatus: { registeredStores: false } };
  }
}

function writeRaw(path: string, instances: LogInstanceEntry[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify({ instances }, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

function pidAlive(pid: number): boolean {
  // ⛔ EPERM 은 「죽음」이 아니다 — 공용 판정으로 모았다(2026-09-20 전수: 15곳 중 10곳이 접고 있었다)
    return isPidAlive(pid);
}

/** 데몬 부팅 1회 — 자기 인스턴스를 upsert(키=stateDir). 실패는 조용히
 *  (레지스트리는 발견용 부가면 — 부팅을 절대 막지 않는다). */
export function registerLogInstance(
  entry: LogInstanceEntry,
  registryPath: string = logInstanceRegistryPath(),
): void {
  try {
    const rest = readRaw(registryPath).filter((e) => e.stateDir !== entry.stateDir);
    writeRaw(registryPath, [...rest, entry]);
  } catch { /* fail-soft */ }
}

/** 모순 레코드 — **운영 루트(`~/.elanous`)인데 이름이 `test:`** 인 항목(2026-07-27).
 *
 *  이름은 env 축, 경로는 리졸버 축으로 갈려 있던 시절(#5503 이전)의 잔재다. 살아 있으면
 *  `--instance` 이름 매칭이 이 항목을 잡아 **운영 스토어를 테스트인 척** 열어준다 —
 *  실측: `test:monad-agent` 4개 중 하나가 `~/.elanous` 를 가리켜 조회가 매번 다른 우주로 샜다.
 *  #5503 가드가 신규 생성은 막으므로 여기선 **읽을 때 걸러내고 디스크에서도 지운다**.
 *  `test:` 이름에 non-test kind를 명시한 행도 같은 방식으로 정리한다. 명시 kind의
 *  우선순위는 유지하되, 잘못 스탬프된 과거 항목이 연합에 운영으로 섞이지 않게 한다. */
function isContradictoryEntry(e: LogInstanceEntry): boolean {
  const prodRoot = join(homedir(), '.elanous').replace(/\/+$/, '');
  const root = e.stateDir.replace(/\/+$/, '');
  return (root === prodRoot && (e.kind === 'test' || e.name.startsWith('test:')))
    || (e.name.startsWith('test:') && e.kind != null && e.kind !== 'test');
}

/** 등록된 인스턴스 뷰 — liveness/db 존재 주석 포함. 로컬 state dir 폴더가
 *  사라진 항목·모순 레코드는 이 자리에서 정리(디스크에도 반영·실패 무시). */
function logInstanceViews(entries: LogInstanceEntry[], registryPath: string): LogInstanceView[] {
  const localHostId = entries.some((e) => e.hostId) ? resolveHostId() : undefined;
  const isRemote = (e: LogInstanceEntry) => !!e.hostId && e.hostId !== localHostId;
  const kept = entries.filter((e) => !isContradictoryEntry(e) && (isRemote(e) || existsSync(e.stateDir)));
  if (kept.length !== entries.length) {
    try { writeRaw(registryPath, kept); } catch { /* fail-soft */ }
  }
  const stateDirsByName = new Map<string, Set<string>>();
  for (const entry of kept) {
    const stateDirs = stateDirsByName.get(entry.name) ?? new Set<string>();
    stateDirs.add(entry.stateDir);
    stateDirsByName.set(entry.name, stateDirs);
  }
  return kept.map((e) => {
    const dbPath = join(e.stateDir, 'logs', 'logs.db');
    const stateDirCount = stateDirsByName.get(e.name)!.size;
    const remote = isRemote(e);
    const alive = remote ? false : pidAlive(e.pid);
    const liveness: LogInstanceView['liveness'] = remote ? 'remote' : alive ? 'alive' : 'dead';
    return {
      ...e,
      stateDirCount,
      ambiguous: stateDirCount > 1,
      kind: resolveInstanceKind(e),
      configDir: e.configDir ?? e.stateDir,
      alive,
      liveness,
      dbExists: existsSync(dbPath),
      dbPath,
    };
  });
}

/** 등록된 인스턴스 뷰 — liveness/db 존재 주석 포함. 로컬 state dir 폴더가
 * 사라진 항목·모순 레코드는 이 자리에서 정리(디스크에도 반영·실패 무시). */
export function readLogInstances(
  registryPath: string = logInstanceRegistryPath(),
): LogInstanceView[] {
  return logInstanceViews(readRaw(registryPath), registryPath);
}

/** 데이터 연합용(ops/recall/session/logs --all) — 격리 test 를 기본 제외한 뷰.
 *  `includeTest` 로 opt-in. 인벤토리 뷰(`elanous fleet`)는 이걸 쓰지 않고 전량 표시(kind 라벨). */
export function readProdInstances(
  opts: { includeTest?: boolean; registryPath?: string } = {},
): LogInstanceView[] {
  const all = readLogInstances(opts.registryPath);
  return opts.includeTest ? all : all.filter((v) => v.kind !== 'test');
}
