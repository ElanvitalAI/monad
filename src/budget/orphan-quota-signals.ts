import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⛔⭐⭐⭐ **파생 우주에 남은 «고아» 쿼터 신호를 세는 자리** (`OBS-T110` 후속 · 2026-08-19).
 *
 * 🚨 왜 있나 — 신호 뿌리를 자격 뿌리로 통일하자, ***옛 파생 우주(`<tree>/.monad-test/budget`)의
 *   파일들이 그대로 남았다***. 아무도 안 읽으므로 무해해 «보이지만», 나중에 누가
 *   그 디렉터리를 열어 보면 ***「9% · 95%」 같은 낡은 수를 «현재 상태»로 읽는다*** —
 *   그것이 정확히 이 사건이 난 방식이다(🅢 가 19시간 낡은 값을 보고 진단했다).
 * ⇒ 🔑 그래서 ***절차를 추가하지 않고 「도구가 말하게」*** 한다: 상태 화면이 스스로 알린다.
 * ⛔ **지우지 않는다** — 지우는 것은 사람의 결정이다. 이 함수는 «세기만» 한다.
 */
export interface OrphanQuotaSignals {
  /** 고아 파일이 사는 디렉터리. 파생 격리가 없으면 `null`. */
  readonly dir: string | null;
  readonly count: number;
  /** 가장 «새» 파일의 나이(분). 파일이 없으면 `null`. ⭐ 「얼마나 늙었나」가 진단의 본체다. */
  readonly newestAgeMinutes: number | null;
}

export function findOrphanQuotaSignals(
  derivedRoot: string,
  credentialRoot: string,
  nowMs: number,
): OrphanQuotaSignals {
  // ⛔ 두 뿌리가 «같으면» 고아가 원리상 없다 — 「0건」과 「해당 없음」을 다른 값으로 낸다.
  if (!derivedRoot.trim() || derivedRoot === credentialRoot) return { dir: null, count: 0, newestAgeMinutes: null };
  const dir = join(derivedRoot, 'budget');
  if (!existsSync(dir)) return { dir: null, count: 0, newestAgeMinutes: null };
  try {
    const files = readdirSync(dir).filter((f) => f.startsWith('codex-quota-signal-') && f.endsWith('.json'));
    if (files.length === 0) return { dir: null, count: 0, newestAgeMinutes: null };
    let newest = 0;
    for (const f of files) {
      try {
        const m = statSync(join(dir, f)).mtimeMs;
        if (m > newest) newest = m;
      } catch { /* 한 파일을 못 읽어도 «셈»을 막지 않는다 */ }
    }
    // ⛔ 미래 시각은 손상으로 본다 — 그대로 내면 나이가 «음수»가 되어 화면이 비문을 말한다.
    const age = newest > 0 && newest <= nowMs ? Math.floor((nowMs - newest) / 60_000) : null;
    return { dir, count: files.length, newestAgeMinutes: age };
  } catch {
    return { dir: null, count: 0, newestAgeMinutes: null };
  }
}
