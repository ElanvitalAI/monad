#!/usr/bin/env bun
// 배포판 컨테이너 매트릭스 «정례화»(ROADMAP 프로덕션 × Docker·k8s A1 · 2026-09-25).
// `scripts/docker-verify.sh` 를 돌려 줄마다 판정하고, «회귀»면 알린다. 관측 = monad logs --category docker-verify.
//   회귀 = build FAILED · fix_rc≠0 · 로그인(gh-auth·provider-decision) 밖의 manual 이 남음.
//   ⛔ Docker 엔진이 꺼져 있으면(야간 OrbStack 미기동 등) «못 쟀다»로 남기고 알리지 않는다 — 「0 회귀」로 읽지 않는다.
//   bun scripts/docker-verify-cycle.ts [--alert] [BASE…]
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { debug } from '../src/debug/log.js';

export const LOGIN_ONLY = new Set(['gh-auth', 'provider-decision']);

export interface VerifyLine { base: string; built: boolean; fixRc: number | null; doctorRc: number | null; manual: string[] }

/** docker-verify.sh 의 결과 줄 → 구조. 모르는 줄은 버린다. */
export function parseVerifyLines(stdout: string): VerifyLine[] {
  const out: VerifyLine[] = [];
  for (const line of stdout.split('\n')) {
    const failed = line.match(/^(\S+)\s+build FAILED/);
    if (failed) { out.push({ base: failed[1]!, built: false, fixRc: null, doctorRc: null, manual: [] }); continue; }
    const ok = line.match(/^(\S+)\s+\[verify\] fix_rc=(\d+) doctor_rc=(\d+)\s+manual: (.*)$/);
    if (ok) out.push({ base: ok[1]!, built: true, fixRc: Number(ok[2]), doctorRc: Number(ok[3]), manual: ok[4]!.trim() === 'none' ? [] : ok[4]!.trim().split(/\s+/) });
  }
  return out;
}

/** 회귀인 줄과 그 이유. */
export function regressions(lines: readonly VerifyLine[]): Array<{ base: string; reason: string }> {
  return lines.flatMap((l) => {
    if (!l.built) return [{ base: l.base, reason: 'image build failed' }];
    const extra = l.manual.filter((m) => !LOGIN_ONLY.has(m));
    const reasons = [l.fixRc !== 0 ? `fix_rc=${l.fixRc}` : '', extra.length ? `manual: ${extra.join(' ')}` : ''].filter(Boolean);
    return reasons.length ? [{ base: l.base, reason: reasons.join(' · ') }] : [];
  });
}

if (import.meta.main) {
  // 단독 스크립트의 debug.log 는 싱크를 등록해야 logs.db 에 닿는다(안 하면 `monad logs --category docker-verify` 가 0 — 09-25 실측).
  try { const { registerStandaloneLogSink } = await import('../src/domains/standalone-log-sink.js'); await registerStandaloneLogSink('docker-verify'); } catch { /* 관측 실패가 검증을 막지 않는다 */ }
  const args = process.argv.slice(2);
  const alert = args.includes('--alert');
  const bases = args.filter((a) => !a.startsWith('--'));
  const root = resolve(import.meta.dir, '..');
  // 야간엔 OrbStack 이 꺼져 있을 수 있다 — 엔진이 없고 `orb` 가 있으면 한 번 켠다(못 켜면 아래에서 «못 쟀다»).
  if (spawnSync('docker', ['info'], { encoding: 'utf8', timeout: 20_000 }).status !== 0 && spawnSync('orb', ['version'], { encoding: 'utf8' }).status === 0) {
    const started = spawnSync('orb', ['start'], { encoding: 'utf8', timeout: 180_000 });
    debug.log('docker-verify', 'engine-start', { tool: 'orb', rc: started.status });
  }
  const started = Date.now();
  const r = spawnSync('bash', [join(root, 'scripts/docker-verify.sh'), ...bases], { cwd: root, encoding: 'utf8', timeout: 3 * 3600_000 });
  const stdout = r.stdout ?? '';
  if (r.status === 127 || r.status === 1 && /docker engine is not running|docker not on PATH/.test(r.stderr ?? '')) {
    debug.log('docker-verify', 'unmeasured', { reason: (r.stderr ?? '').trim().split('\n').at(-1) ?? `rc=${r.status}` }, { level: 'warn' });
    console.log(`docker-verify-cycle: unmeasured — ${(r.stderr ?? '').trim().split('\n').at(-1)}`);
    process.exit(0);
  }
  const lines = parseVerifyLines(stdout);
  const bad = regressions(lines);
  const durationMs = Date.now() - started;
  debug.log('docker-verify', 'finished', { bases: lines.length, regressions: bad, durationMs, lines }, { level: bad.length ? 'warn' : 'info' });
  console.log(stdout.trim());
  console.log(`docker-verify-cycle: ${lines.length} bases · regressions ${bad.length} · ${Math.round(durationMs / 1000)}s`);
  if (lines.length === 0) {
    debug.log('docker-verify', 'unmeasured', { reason: 'no result lines', rc: r.status }, { level: 'warn' });
    process.exit(0);
  }
  if (bad.length && alert) {
    const { sendOutbound } = await import('../src/domains/outbound-alert.js');
    await sendOutbound(`🐳 배포판 매트릭스 회귀 ${bad.length}: ${bad.map((b) => `${b.base} (${b.reason})`).join(' · ')} — 로그: monad logs --category docker-verify`, 'alert');
  }
  process.exit(bad.length ? 1 : 0);
}
