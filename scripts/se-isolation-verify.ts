#!/usr/bin/env bun
// ── Self-Evolution SE3 · 격리 무오염 라이브 검증 하니스 (2026-07-10) ────────
//
// SE3 완료조건: "격리 데몬이 별 포트에서 뜨고 정식(:31415·~/.monad) 무오염 검증(SHA 격리)."
// 코드(isolated-instance·nocturnal-runner launch args)는 완결·단위테스트됐으나 실제로 격리
// 인스턴스를 만들고 정식 무오염을 증명한 라이브 배선이 없었다. 이 하니스가 그 증명이다.
//
// 절차(reference_test_isolation_sha_protocol 동형): 정식 ~/.monad SHA 캡처 → 격리 인스턴스
// 생성(worktree+disarmed config) → 구조 불변 검증 → (--boot) 격리 데몬 별 포트 기동+health
// → 정식 ~/.monad SHA 무변 검증 → dispose(worktree+브랜치 정리). try/finally 로 항상 정리.
//
// 사용: bun scripts/se-isolation-verify.ts [--boot] [--keep]

import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  createIsolatedInstance, disposeIsolatedInstance, assertIsolationSafe,
  PRODUCTION_PORT, type IsolatedPlan,
} from '../src/autopilot/build/isolated-instance.js';
import { buildIsolatedLaunchArgs } from '../src/autopilot/build/nocturnal-runner.js';

const repoRoot = join(import.meta.dir, '..');
const doBoot = process.argv.includes('--boot');
const keep = process.argv.includes('--keep');
const slug = `verify-${Date.now().toString(36)}`;

const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = ''): void {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** 정식 ~/.monad 무오염 지표 — config.json SHA(격리 실패 시 clobber 될 핵심 파일). */
function prodConfigSha(): string {
  const p = join(homedir(), '.monad/config.json');
  return existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : 'ABSENT';
}

async function reachable(port: number, tries = 40): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok || r.status < 500) return true;
    } catch { /* not up yet */ }
    await new Promise(res => setTimeout(res, 500));
  }
  return false;
}

console.log(`\n=== SE3 격리 무오염 라이브 검증 (slug=${slug}${doBoot ? ' · --boot' : ''}) ===\n`);

const shaBefore = prodConfigSha();
console.log(`정식 ~/.monad/config.json SHA(before): ${shaBefore.slice(0, 16)}…\n`);

let plan: IsolatedPlan | null = null;
let daemon: ReturnType<typeof spawn> | null = null;
try {
  // 1. 격리 인스턴스 생성(worktree+node_modules 심링크+disarmed config).
  plan = createIsolatedInstance(repoRoot, slug, 'HEAD');
  check('격리 인스턴스 생성(worktree)', existsSync(plan.worktreePath), plan.worktreePath.replace(homedir(), '~'));

  // 2. 구조 불변 검증.
  let safeThrew = false;
  try { assertIsolationSafe(plan); } catch { safeThrew = true; }
  check('assertIsolationSafe 통과', !safeThrew);
  check('격리 포트 != 정식(31415)', plan.port !== PRODUCTION_PORT, `port=${plan.port}`);
  check('config-dir 이 worktree 하위(홈 ~/.monad 아님)',
    plan.configDir.includes(plan.worktreePath) && !plan.configDir.includes(`${homedir()}/.monad/`),
    plan.configDir.replace(homedir(), '~'));

  // 3. 격리 config 내용 = disarmed(정식과 완전 분리).
  const cfgPath = join(plan.configDir, 'config.json');
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf-8')) : {};
  check('격리 config disarmed(dispatch/finance/autopilot off)',
    cfg.__self_evolution_isolated === true && cfg.dispatch?.enabled === false &&
    cfg.finance?.dispatch?.enabled === false && cfg.autopilot?.merge?.armed === false);

  // 4. (--boot) 격리 데몬 별 포트 기동 + health.
  if (doBoot) {
    const args = buildIsolatedLaunchArgs(plan);
    console.log(`\n  [boot] bun bin/monad.mjs ${args.join(' ')}  (cwd=worktree)\n`);
    daemon = spawn('bun', ['bin/monad.mjs', ...args], {
      cwd: plan.worktreePath, stdio: 'ignore', detached: true,
    });
    const up = await reachable(plan.port);
    check('격리 데몬 별 포트에서 기동+health 응답', up, `http://127.0.0.1:${plan.port}/v1/health`);
  }

  // 5. 정식 무오염 SHA 검증(핵심).
  const shaAfter = prodConfigSha();
  check('정식 ~/.monad/config.json SHA 무변(무오염)', shaAfter === shaBefore,
    `after=${shaAfter.slice(0, 16)}…`);
} finally {
  // 항상 정리 — 데몬 kill + worktree/브랜치 prune.
  if (daemon?.pid) { try { process.kill(-daemon.pid, 'SIGTERM'); } catch { try { daemon.kill('SIGTERM'); } catch { /* */ } } }
  if (plan && !keep) {
    try { disposeIsolatedInstance(repoRoot, plan); } catch (e) { console.error('  [cleanup] worktree dispose 실패:', e instanceof Error ? e.message : e); }
    try { execFileSync('git', ['-C', repoRoot, 'branch', '-D', plan.branch], { stdio: 'ignore' }); } catch { /* 브랜치 이미 없음 */ }
    console.log(`\n  [cleanup] worktree+브랜치(${plan.branch}) 정리됨.`);
  } else if (keep && plan) {
    console.log(`\n  [--keep] 격리 인스턴스 유지: ${plan.worktreePath.replace(homedir(), '~')} (port ${plan.port})`);
  }
}

const passed = checks.every(c => c.ok);
console.log(`\n=== ${passed ? 'PASS' : 'FAIL'} — ${checks.filter(c => c.ok).length}/${checks.length} 검증 통과 ===\n`);
process.exit(passed ? 0 : 1);
