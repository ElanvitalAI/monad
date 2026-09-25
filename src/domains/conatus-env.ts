// ── CONATUS 소스 경로/자격 공용 유틸 (2026-07-06) ────────────────
// finance-tools·트레이드 어댑터·크론 스크립트가 Conatus 파이썬(screener·토스 시세 등)을 실행할 때 공유.
// ★ CONATUS_DIR 단일 출처(2026-07-22 근본수정) — dated 폴더명(asset-attractiveness-results-20260527)이
//   monad(3곳 각자 하드코딩)·스킬 전반에 박혀 폴더 rename/정리 시 mass 파손 landmine 이었다. 이제
//   monad 는 이 한 곳으로 수렴하고, 해석 순서 = env `CONATUS_DIR` → stable 심링크 `~/source/conatus`
//   → dated 폴백(하위호환). 폴더명이 바뀌어도 심링크만 re-point 하면 monad 무영향. [[feedback_config_over_env]]

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** dated-name landmine 을 피해 Conatus 루트를 resilient 하게 해석. */
function resolveConatusDir(): string {
  const envDir = process.env.CONATUS_DIR;
  if (envDir && existsSync(envDir)) return envDir;                 // 1) 명시 override
  const stable = join(homedir(), 'source', 'conatus');            // 2) 안정 canonical(심링크 권장)
  if (existsSync(stable)) return stable;
  return join(homedir(), 'source', 'asset-attractiveness-results-20260527'); // 3) dated 폴백
}

/** CONATUS 소스 루트(투자 데이터·screener 스크립트·.env) — monad 단일 출처. */
export const CONATUS_DIR = resolveConatusDir();

/** creds .env 경로 해석 — monad 소유 우선(Conatus 소스 dir 의존 종식·2026-07-22).
 *  순서 = env `CONATUS_ENV` override → `~/.monad/conatus/.env`(monad 소유·데몬/크론 무관 읽힘)
 *  → `CONATUS_DIR/.env`(하위호환 폴백). creds 를 monad 소유 위치에 두면 Conatus 소스 dir 을
 *  옮기거나 archive 해도 monad 자격 로드 무영향. */
function conatusEnvPath(): string | null {
  const candidates = [
    process.env.CONATUS_ENV || '',
    join(homedir(), '.monad', 'conatus', '.env'),
    join(CONATUS_DIR, '.env'),
  ].filter(Boolean);
  return candidates.find(p => existsSync(p)) ?? null;
}

/** CONATUS creds(.env·토스 자격 등)를 env 객체로 로드. monad 소유 `~/.monad/conatus/.env`
 *  우선(conatusEnvPath). Fail-soft: 파일 없으면 빈 객체. */
export function conatusEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const path = conatusEnvPath();
  if (!path) return env;
  try {
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq > 0) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
  } catch { /* fail-soft */ }
  return env;
}
