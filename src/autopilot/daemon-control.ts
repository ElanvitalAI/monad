// ── 데몬+PWA 컨트롤 헬퍼 (시스템 셀프힐링 컴포넌트 4 · 2026-07-13 · 대표 지시) ──────
//
// 시스템 수리 미션이 merge 된 뒤, 새 코드를 활성화하려면 데몬(nexus)을 재시작해야 한다. 이 헬퍼는
// 환경(운영/테스트)에 맞는 재시작 계획을 만들고, **명시 실행(execute) + system-repair 권한 + 교차오염
// 가드**를 통과할 때만 실제 재시작한다. reboot-adjacent 라 기본은 dry-run(계획만)이며, 실제 실행은
// 사람 승인(HITL) 경로다(자율 실행 아님·config 오염 사건 교훈).
//
//   운영(launchd): launchctl kickstart -k gui/<uid>/com.elanous.nexus  (loaded 서비스 kill+restart)
//   테스트:        nexus run --test  (same-tree auto-restart · state=<repo>/.elanous-test/nexus/)
//
// 교차오염 금지(MANUAL-pwa-start-vs-test §8): config dir 은 항상 공유(~/.elanous/)라, 위험은 "잘못된
// 환경의 명령 실행"이다. 두 명령은 구조가 완전히 달라 arg 혼입은 없고, 요청 env != 감지 env 면 실행
// 거부(forceEnvMismatch 없이는). resolveLaunchdEnvironment(canonical) 로 serviceTarget 재사용.

import { resolveLaunchdEnvironment, type LaunchdOpts } from '../nexus/install/launchd.js';
import { runCli as defaultRunCli, type RunCli } from '../nexus/config/secrets/cli-helper.js';

export type DaemonEnvironment = 'production' | 'test';

export interface RestartPlan {
  env: DaemonEnvironment;
  /** spawn argv(첫 요소=실행 파일). production=launchctl…, test=<bun> <elanous> nexus run --test. */
  command: string[];
  /** 사람용 설명. */
  description: string;
  /** 안전 안내(교차오염·HITL). */
  note: string;
}

/** 환경별 재시작 계획(순수 — 실제 spawn 안 함). production=launchctl kickstart -k <serviceTarget>,
 *  test=nexus run --test(same-tree auto-restart). serviceTarget 은 resolveLaunchdEnvironment 재사용. */
export function buildRestartPlan(env: DaemonEnvironment, opts: { launchd?: LaunchdOpts } = {}): RestartPlan {
  if (env === 'production') {
    const lenv = resolveLaunchdEnvironment(opts.launchd ?? {});
    return {
      env,
      command: ['launchctl', 'kickstart', '-k', lenv.serviceTarget],
      description: `운영 데몬(launchd ${lenv.label}) kill+restart — 새 코드 활성화`,
      note: '운영 서비스 재시작(reboot-adjacent). config dir 공유(~/.elanous/)라 교차오염 없음. HITL 실행.',
    };
  }
  // 테스트 — nexus run --test 는 same-tree auto-restart(포트 fallback 31415→31420+·state 격리).
  const script = process.argv[1];
  const base = process.execPath && script ? [process.execPath, script] : ['elanous'];
  return {
    env,
    command: [...base, 'nexus', 'run', '--test'],
    description: '테스트 데몬(nexus run --test) 재시작 — state=<repo>/.elanous-test/nexus/(격리)',
    note: '테스트 격리 재시작. config dir 는 공유되므로 운영 config 를 건드리지 않도록 --test 만(오염 사건 교훈).',
  };
}

/** 현재 데몬 환경 best-effort 감지(교차오염 가드용 cross-check). opts.env 명시가 최우선. argv 에
 *  `--test` 마커가 있으면 test, 아니면 production(보수적 기본 — 운영이 상시 서비스). 순수(argv 만). */
export function detectDaemonEnvironment(opts: { env?: DaemonEnvironment } = {}): DaemonEnvironment {
  if (opts.env) return opts.env;
  if (process.argv.includes('--test')) return 'test';
  return 'production';
}

export interface RestartDaemonOpts {
  /** 대상 환경(명시 권장). 없으면 detectDaemonEnvironment. */
  env?: DaemonEnvironment;
  /** true 라야 실제 재시작(기본 false=dry-run·계획만). */
  execute?: boolean;
  /** system-repair 권한(reboot-adjacent 라 true 라야 실행 허용). */
  authorized?: boolean;
  /** 교차오염 가드 우회(요청 env != 감지 env 를 강제). 명시적일 때만. */
  forceEnvMismatch?: boolean;
  /** cli seam(테스트). */
  runCli?: RunCli;
  /** launchd 환경 override(테스트·uid/label). */
  launchd?: LaunchdOpts;
}

export interface RestartResult {
  ok: boolean;
  /** 실제로 재시작 명령을 실행했는가(dry-run/거부면 false). */
  executed: boolean;
  plan: RestartPlan;
  detectedEnv: DaemonEnvironment;
  /** 실행 안 함/실패 사유(dry-run·unauthorized·env-mismatch·exit). */
  reason?: string;
}

/** 환경별 데몬 재시작 — 기본 dry-run(계획만 반환). 실제 실행은 (1) execute=true (2) authorized=true
 *  (system-repair·reboot-adjacent) (3) 교차오염 가드 통과(요청 env == 감지 env·또는 forceEnvMismatch)
 *  3중 게이트. 자율 실행 아님 — 셀프힐 merge 후 사람 승인(HITL) 경로. fail-soft(exitCode 반영). */
export async function restartDaemon(opts: RestartDaemonOpts = {}): Promise<RestartResult> {
  // ★ 실제 현재 환경을 요청 env 와 독립적으로 감지(교차오염 가드의 핵심) — opts.env 를 넘기면
  //   detect 가 그대로 되돌려줘 가드가 무력화된다. 요청 env(opts.env)와 감지 env 를 별개로 둔다.
  const detectedEnv = detectDaemonEnvironment({});
  const env = opts.env ?? detectedEnv;
  const plan = buildRestartPlan(env, opts.launchd ? { launchd: opts.launchd } : {});

  // 게이트 1 — dry-run 기본(계획만). 자율 경로는 여기서 멈춘다(계획을 HITL 로 넘김).
  if (!opts.execute) {
    return { ok: true, executed: false, plan, detectedEnv, reason: 'dry-run(계획만) — 실제 재시작은 execute+authorized 필요(HITL·reboot-adjacent).' };
  }
  // 게이트 2 — system-repair 권한(reboot-adjacent). 무권한이면 실행 거부.
  if (!opts.authorized) {
    return { ok: false, executed: false, plan, detectedEnv, reason: 'system-repair 권한 필요(reboot-adjacent·HITL). authorized=false 라 실행 거부.' };
  }
  // 게이트 3 — 교차오염 가드. 요청 env 와 감지 env 불일치면 거부(운영↔테스트 오실행 방지).
  if (env !== detectedEnv && !opts.forceEnvMismatch) {
    return { ok: false, executed: false, plan, detectedEnv, reason: `교차오염 가드 — 요청 env(${env}) != 감지 env(${detectedEnv}). 의도면 forceEnvMismatch 명시.` };
  }

  const cli = opts.runCli ?? defaultRunCli;
  try {
    const r = await cli(plan.command);
    return r.exitCode === 0
      ? { ok: true, executed: true, plan, detectedEnv }
      : { ok: false, executed: true, plan, detectedEnv, reason: `재시작 실패(exit ${r.exitCode}): ${(r.stderr || r.stdout || '').slice(0, 200)}` };
  } catch (e) {
    return { ok: false, executed: true, plan, detectedEnv, reason: e instanceof Error ? e.message.slice(0, 200) : String(e) };
  }
}
