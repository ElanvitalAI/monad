// F1 enforcement (Federation invariant from REQUIREMENTS §5):
//   "Input never bypasses the surface tree — every InputEvent is
//    dispatched against the current surface stack; no global
//    keyboard shortcut that ignores modal focus."
//
// A `display.registerKeyBinding({ scope: 'global' })` is fine when
// the binding either (a) has a `when` predicate that gates on
// surface state, or (b) is genuinely process-wide (Ctrl+C abort etc).
//
// The bad combo is `scope: 'global'` AND `when: () => true` (or no
// `when` predicate at all gating on surface state) — that's a
// shortcut that fires regardless of modal capture, breaking F1.
//
// PLAN ref: 내부 문서 `PLAN-substrate-rebuild-2026-05-03` §7
// REQUIREMENTS ref: 내부 문서 `REQUIREMENTS-substrate-occam-2026-05-03` §5 F1

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

// Match `when: () => true` (no parens variant or any spacing).
const ALWAYS_TRUE_WHEN = /\bwhen\s*:\s*\(\s*\)\s*=>\s*true\b/;

// ⛔⭐⭐ `scope: 'global'` 이라는 «낱말»이 이 저장소에서 «다섯 축»을 덮는다 (2026-08-26 전수).
//   ① 대시보드 키바인딩            ② NEXUS SwitchSpec(설정 스위치)   ③ 미션 워킹메모리 entry
//   ④ 프롬프트 뱅크 조각            ⑤ saveWorkflow 의 저장 스코프
//   ⇒ 그래서 아래 「글로벌 키스페이스」 감사는 «키바인딩만» 세야 한다.
//   📌 판별자 = ***같은 오브젝트 리터럴에 `key:`(또는 `chordPrefix:`)가 있나***.
//      키바인딩의 정의가 그것이고, 나머지 넷은 어느 것도 `key:` 를 갖지 않는다.
//   ⚠️ 인터페이스 «멤버 선언»(`scope: 'global';`)도 뺀다 — 등록이 아니라 타입이다.
const GLOBAL_SCOPE_ANY = /scope:\s*['"]global['"]/;
const GLOBAL_SCOPE_VALUE = /scope:\s*['"]global['"]\s*,/;
const KEYBINDING_PROP = /^\s*(key|chordPrefix)\s*:/;
const KEYBINDING_WINDOW = 6;

/** 파일 안의 `scope: 'global'` 을 「키바인딩인 것」과 「아닌 것」으로 가른다. */
function countGlobalScopes(text: string): { any: number; keybinding: number } {
  const lines = text.split('\n');
  let any = 0;
  let keybinding = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!GLOBAL_SCOPE_ANY.test(line)) continue;
    any++;
    if (!GLOBAL_SCOPE_VALUE.test(line)) continue; // 인터페이스 멤버 선언
    const from = Math.max(0, i - KEYBINDING_WINDOW);
    const to = Math.min(lines.length, i + KEYBINDING_WINDOW + 1);
    for (let j = from; j < to; j++) {
      if (KEYBINDING_PROP.test(lines[j]!)) { keybinding++; break; }
    }
  }
  return { any, keybinding };
}

describe('F1 federation guard · no global key bypass', () => {
  test('no source has both scope: \'global\' AND when: () => true', () => {
    const offenders: Array<{ file: string; line: number; text: string }> = [];

    for (const file of walk(SRC_DIR)) {
      const rel = file.slice(ROOT.length + 1);
      const text = readFileSync(file, 'utf8');
      // Quick skip: file must mention BOTH patterns; otherwise no
      // chance of co-occurrence.
      if (!text.includes("scope: 'global'") && !text.includes('scope: "global"')) continue;
      if (!ALWAYS_TRUE_WHEN.test(text)) continue;

      // Block-level co-occurrence detection: check `registerKeyBinding`
      // / `keyBinding` blocks that contain both forms within ~12 lines.
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!/scope:\s*['"]global['"]/.test(lines[i]!)) continue;
        const blockStart = Math.max(0, i - 8);
        const blockEnd = Math.min(lines.length, i + 8);
        let hasAlwaysTrue = false;
        for (let j = blockStart; j < blockEnd; j++) {
          if (ALWAYS_TRUE_WHEN.test(lines[j]!)) { hasAlwaysTrue = true; break; }
        }
        if (hasAlwaysTrue) {
          offenders.push({ file: rel, line: i + 1, text: lines[i]!.trim() });
        }
      }
    }

    if (offenders.length > 0) {
      const detail = offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.text}`)
        .join('\n');
      throw new Error(
        `F1 violation — global-scope keybinding with always-true when predicate found in ${offenders.length} site(s):\n${detail}\n\n`
        + `Either narrow the scope to a specific surface/owner, OR replace \`when: () => true\` with a predicate that respects the current modal stack.\n`
        + `See docs/refactoring/REQUIREMENTS-substrate-occam-2026-05-03.md §5 F1.`,
      );
    }
    expect(offenders).toEqual([]);
  });

  test('all global-scope keybindings have either no when, narrow when, or process-wide intent', () => {
    // Sanity audit — counts global-scope **keybindings** and reports for
    // visibility in CI logs. Helps reviewers spot accidental growth of
    // the global keyspace.
    //
    // 🪞⭐⭐ 2026-08-26 — ***이 자가 「글로벌 키바인딩 수」를 세고 있지 «않았다».***
    //   옛 자는 src/ 전체에서 `scope: 'global'` 문자열을 «그냥» 셌고, 그 낱말은
    //   이 저장소에서 서로 다른 «다섯 축»을 덮는다(위 GLOBAL_SCOPE_ANY 주석).
    //   📏 그날 실측:  옛 자 = ***57***  ↔  실제 키바인딩 = ***26***
    //      (비-키바인딩 31 = 스위치 22 · 워킹메모리 4 · 프롬프트 3 · 워크플로 1 · 타입선언 1)
    //   ⇒ 그래서 「17 → 57 · 임계 50 을 105일 전에 넘었다」(#12776)의 정체는
    //      ***키스페이스가 자란 것이 아니라 «자가 다른 개념 넷을 같이 센 것»***이었다.
    //   ⛔⭐ 그렇다고 ***임계를 올리지 않는다*** — 그건 경보를 끄는 것이다.
    //      고친 것은 «자»이고, 임계 50 은 «그대로» 둔다. 26 은 여전히 그 아래다.
    //   📌 「26 이 괜찮은가」는 이 시험이 «안 정한다» — 키바인딩 소유 축의 판단이다.
    let keybindingCount = 0;
    let anyScopeCount = 0;
    const perFile: string[] = [];
    for (const file of walk(SRC_DIR)) {
      const { any, keybinding } = countGlobalScopes(readFileSync(file, 'utf8'));
      anyScopeCount += any;
      keybindingCount += keybinding;
      if (any > 0) perFile.push(`  ${file.slice(ROOT.length + 1)}  any=${any} keybinding=${keybinding}`);
    }
    // ⭐ 「0건」·「N건」을 읽는 사람이 «무엇이 빠졌는지»를 같이 보게 한다.
    //   ⛔ 이 줄이 없으면 다음 사람이 또 「57」을 키바인딩 수로 읽는다.
    console.log(
      `[F1 audit] global-scope keybindings=${keybindingCount} `
      + `(raw \`scope: 'global'\` occurrences=${anyScopeCount}; `
      + `the difference is switches/working-memory/prompt/workflow scopes + type decls)\n`
      + perFile.join('\n'),
    );
    // Snapshot the count at the moment of writing (2026-05-03 = ~17).
    // Allow up to 2x growth before forcing a manual review. Lower
    // bound 1 because at least Ctrl+C / global ESC chords are
    // expected to remain global.
    expect(keybindingCount).toBeGreaterThanOrEqual(1);
    expect(keybindingCount).toBeLessThan(50);
  });
});
