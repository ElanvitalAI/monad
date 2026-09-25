import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⛔⭐⭐⭐ **조용한 인자 무시**의 «노출»을 센다 — 고치는 게 아니라 «자라지 못하게» 한다.
 *
 * 사건(2026-08-03 · `[T]` `GOAL-T27`): 골이 `scripts/measure-nl-routing-corpus.ts --out <경로>` 를
 * 시켰는데 그 러너는 `argv` 를 **아예 안 읽었다**(설정은 환경변수). ⇒ 모르는 인자를 무시하고 `exit 0`.
 * ***수는 나왔는데 원자료가 없었고***, 리뷰가 **세 라운드** *"재검증 불가"* 를 반복했다.
 *
 * ⭐ 그 뒤 `[T]` 가 물었다 — *"⑴(도구가 조용히 성공하지 않게)이 「지켜지는지」는 아무도 안 잰다"*.
 * ⛔ 그래서 **일괄 수리를 하려다 먼저 쟀다**:
 * ```
 * scripts/*.ts 진입점            125
 * argv 를 «안» 읽는 것             49
 * ⭐ 그중 «골»이 플래그와 함께 시킨 것   0     ← 방금 고친 하나가 유일했다
 * ```
 * ⇒ ***49개 일괄 수리는 벌지 못한 비용이다.*** 대신 **그 0을 셀 수 있게** 둔다.
 *   ⭐ `GOAL-S46` 교훈의 적용 — *분모와 분자를 같은 자리에 실어야 「자라는 것」이 보인다*.
 *
 * ⚠️ 이 자의 사각(적어 둔다):
 *   - `docs/goals` 트리만 본다. 채팅·이슈에서 시킨 명령은 못 본다.
 *   - 정적 검사라 동적으로 만든 명령 문자열은 못 본다.
 *   - `argv` 판별이 문면 기반이라 우회 구현(예: `Bun.argv`)은 놓칠 수 있다.
 */

const SCRIPTS_DIR = 'scripts';
const GOALS_DIR = 'docs/goals';
/** ⛔ `argv` 를 읽는다고 인정하는 문면. 새 방식이 생기면 여기 «한 자리»에 더한다. */
const READS_ARGV = /process\.argv|Bun\.argv|parseArgs|commander/i;
/**
 * 스크립트 경로 «바로 뒤 · 같은 줄»에 오는 플래그.
 * ⛔ `\s` 를 쓰면 **줄바꿈을 포함**해 «다음 줄»의 플래그를 문다(첫 판에서 오탐 6건 · 전부
 *   `ci-typecheck-changed.ts` 뒤의 무관한 다음 줄이었다). ⇒ 같은 줄로 못 박는다.
 */
const TRAILING_FLAG = /^[^\n]*?\s--[A-Za-z][\w-]*/;

function scriptEntryPoints(): string[] {
  return readdirSync(SCRIPTS_DIR).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
}

function silentArgScripts(): string[] {
  return scriptEntryPoints().filter((name) => !READS_ARGV.test(readFileSync(join(SCRIPTS_DIR, name), 'utf8')));
}

/** 골이 「조용한 스크립트」를 «플래그와 함께» 시킨 자리. 이것이 실제 노출이다. */
function goalCitationsWithFlags(): Array<{ goal: string; script: string; excerpt: string }> {
  const silent = new Set(silentArgScripts().map((name) => `${SCRIPTS_DIR}/${name}`));
  const found: Array<{ goal: string; script: string; excerpt: string }> = [];
  for (const goal of readdirSync(GOALS_DIR)) {
    if (!goal.endsWith('.txt')) continue;
    const text = readFileSync(join(GOALS_DIR, goal), 'utf8');
    for (const script of silent) {
      let index = text.indexOf(script);
      while (index >= 0) {
        const tail = text.slice(index + script.length, index + script.length + 80);
        if (TRAILING_FLAG.test(tail)) found.push({ goal, script, excerpt: tail.split('\n')[0]!.trim().slice(0, 60) });
        index = text.indexOf(script, index + 1);
      }
    }
  }
  return found;
}

describe('조용한 인자 무시 노출', () => {
  test.skipIf(!existsSync(GOALS_DIR))('private docs/goals 골이 「argv 를 안 읽는 스크립트」를 플래그와 함께 시키지 않는다', () => {
    const exposure = goalCitationsWithFlags();
    // ⛔ 실패하면 **골이 아니라 그 스크립트**를 고친다 — 모르는 인자를 이름 대고 거부하게.
    //   (`measure-nl-routing-corpus.ts` 가 그 형태다: "이 러너는 인자를 받지 않는다 — 모르는 인자 … 설정은 환경변수다: …")
    expect(exposure.map((item) => `${item.goal} → ${item.script}${item.excerpt}`)).toEqual([]);
  });

  test('분모도 같이 센다 — 「조용한 스크립트」 자체는 결함이 아니다', () => {
    // ⭐ 인자를 «안 받는» 스크립트가 argv 를 안 읽는 것은 정상이다. 문제는 «시키는 쪽»과 만날 때다.
    //   그래서 이 수는 «상한을 걸지 않고» 관측만 한다 — 자의적 임계를 만들지 않는다(퇴화 검사 규율).
    const silent = silentArgScripts();
    const total = scriptEntryPoints();
    expect(total.length).toBeGreaterThan(0);
    expect(silent.length).toBeLessThanOrEqual(total.length);
  });
});
