import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * ⛔⭐⭐⭐ **셀프힐 «사건»은 `if (debug.enabled)` 뒤에 두지 않는다.**
 *
 * CLAUDE.md 넘버원 룰: *"셀프힐 결정은 관측 관문(observe)"*. 그런데 `debug.enabled` 는
 * ***핫패스 게이트***라 운영에서 꺼진다 ⇒ 그 뒤에 둔 관측은 조회에 «영영 0건»이다.
 *
 * 📏 이 저장소가 그 형태를 «세 번» 밟았다:
 *   `#12766` 앵커 절단 관측 · `#12816` 자식 앵커 결손 관측 · 그리고 이 파일이 잡은 `llm.router` ***넷***
 *   (codex 유예 셋 `*-grace-burned` ⊕ `tool-loop.tool-name.repaired`).
 *   🪞 이 줄은 «둘」이라고 적혀 있었다 — 처음 둘을 고치고 나중에 둘을 더 고쳤는데 문면이 «안 따라왔다».
 *      무인 리뷰가 잡았다(`#12825` 사후 리뷰). ***오늘 밤 내내 다룬 「늙은 문면」이 이 파일에도 났다.***
 *   ⇒ 🔑 한 자리를 고치는 것으로는 안 끝난다. ***형태를 잠근다.***
 *
 * ⚠️ 이 자가 «못» 하는 것 — 정직하게 적는다:
 *   ⓐ 파서가 아니라 «들여쓰기» 훑기다. `if (debug.enabled) {` 의 들여쓰기보다 «깊은» 줄까지만 «그 안»으로 본다.
 *      ⇒ 이어붙인 중괄호·비정상 포맷은 놓친다(거짓 음성). ⛔ 「0건」을 「전부 안전」으로 읽지 마라.
 *      ✅ 다만 ***한 줄 `if (debug.enabled) debug.log(…)`*** 와 ***여러 줄로 접힌 `debug.log(`*** 는 «본다» —
 *         무인 리뷰가 그 둘을 거짓 음성으로 짚었고(`#12825`), 아래 「자가 자기를 문다」 절이 그것을 잠근다.
 *      🪞 첫 판은 「뒤 12줄」 고정 창이었고 ***게이트 «밖»의 호출을 위반으로 셌다***(거짓 양성).
 *         자가 자기 결함을 자기 산출로 드러냈고, 그래서 이 판이 있다.
 *   ⓑ 「셀프힐 사건인가」는 ***이벤트 이름의 낱말***로 고른다. 이름이 그 낱말을 안 쓰면 안 걸린다.
 *      🪞 오늘 이 저장소가 배운 그 형태다 — ***「내가 고른 낱말에 안 걸린다」 ≠ 「없다」.***
 *   ⇒ 그래서 이 시험은 ***「분모」를 같이 낸다.*** 수를 보고 다음 사람이 자를 다시 의심할 수 있게.
 */
const SRC = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const REPO = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

/** 셀프힐이 «일어났다」를 뜻하는 이벤트 낱말. ⛔ 늘리는 것은 환영 — 줄이려면 근거를 적어라. */
// ⛔ 'fallback-emitted' 는 30차 §5f 가 «자를 넓혀» 더한 것이다 — 그 전까지 이 자는
//    루프의 «폴백 발신»(=하드스톱을 요약으로 대신하는 자기수복)을 «못 봤다».
//    ⚠️ 낱말을 'fallback' 로 넓히면 UI 폴백 넷까지 걸린다(성격·빈도가 다르다) ⇒ 접미로 좁힌다.
const SELF_HEAL_EVENT_WORDS = ['repaired', 'grace-burned', 'self-heal', 'healed', 'recovered', 'salvage', 'fallback-emitted'];

const GATE_OPEN = /if\s*\(\s*debug\.enabled\s*\)/;
const DEBUG_CALL = /debug\.log\(\s*'([^']+)'\s*,\s*'([^']+)'/;
/** `debug.log(` 가 «열리기만» 한 줄 — 인자가 다음 줄로 접힌 형태. */
const DEBUG_CALL_OPEN = /debug\.log\(\s*$/;
/** 접힌 인자를 잇기 위해 몇 줄까지 붙여 볼 것인가. */
const FOLD_LOOKAHEAD = 3;

/** 한 줄에서 못 찾으면 뒤 몇 줄을 «이어 붙여» 다시 본다(포맷터가 접은 경우). */
function matchDebugCall(lines: string[], at: number): RegExpExecArray | null {
  const direct = DEBUG_CALL.exec(lines[at]!);
  if (direct) return direct;
  if (!DEBUG_CALL_OPEN.test(lines[at]!)) return null;
  const joined = lines.slice(at, Math.min(lines.length, at + 1 + FOLD_LOOKAHEAD)).join(' ');
  return DEBUG_CALL.exec(joined);
}
/** 안전판 — 블록이 닫히는 것을 못 찾아도 여기서 멈춘다. ⛔ 파서가 아니므로 «근사»다. */
const MAX_BLOCK_LINES = 60;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

type Site = { file: string; line: number; category: string; event: string };

/** ⭐ 파일이 아니라 «줄»을 받는다 — 그래야 이 자를 «합성 표본»으로 물 수 있다. */
export function scanGatedDebugCalls(lines: string[], file = '<inline>'): { sites: Site[]; gatesSeen: number } {
  const sites: Site[] = [];
  let gatesSeen = 0;
  for (let i = 0; i < lines.length; i++) {
      if (!GATE_OPEN.test(lines[i]!)) continue;
      gatesSeen++;
      // ⛔⭐ 한 줄 형태 — `if (debug.enabled) debug.log('c','e', …)`.
      //   블록이 «없으므로» 아래 들여쓰기 훑기가 원리상 못 본다. 그래서 여는 줄 자신을 «먼저» 본다.
      const inline = matchDebugCall(lines, i);
      if (inline) sites.push({ file, line: i + 1, category: inline[1]!, event: inline[2]! });
      const gateIndent = indentOf(lines[i]!);
      for (let j = i + 1; j < Math.min(lines.length, i + 1 + MAX_BLOCK_LINES); j++) {
        const line = lines[j]!;
        if (line.trim() === '') continue;
        // ⛔ 블록이 «닫혔으면» 멈춘다 — 게이트와 같은(혹은 얕은) 들여쓰기의 줄이 그 신호다.
        //   이 한 줄이 없으면 게이트 «밖»의 호출을 위반으로 센다(첫 판이 그랬다).
        if (indentOf(line) <= gateIndent) break;
        const m = matchDebugCall(lines, j);
        if (m) sites.push({ file, line: j + 1, category: m[1]!, event: m[2]! });
      }
  }
  return { sites, gatesSeen };
}

function gatedDebugCalls(): { sites: Site[]; gatesSeen: number; filesScanned: number } {
  const sites: Site[] = [];
  let gatesSeen = 0;
  const files = walk(SRC.replace(/\/debug$/, ''));
  for (const file of files) {
    const scanned = scanGatedDebugCalls(readFileSync(file, 'utf8').split('\n'), relative(REPO, file));
    sites.push(...scanned.sites);
    gatesSeen += scanned.gatesSeen;
  }
  return { sites, gatesSeen, filesScanned: files.length };
}

describe('셀프힐 관측 래칫 — 「일어났다」는 debug 게이트 밖에 있어야 한다', () => {
  it('셀프힐 «사건» 이벤트가 `if (debug.enabled)` 뒤에 «없다»', () => {
    const { sites, gatesSeen, filesScanned } = gatedDebugCalls();
    const offenders = sites.filter((s) => SELF_HEAL_EVENT_WORDS.some((w) => s.event.includes(w)));
    // ⭐ 「0건」을 읽는 사람이 «무엇을 훑었는지»를 같이 보게 한다.
    //   ⛔ 이 줄이 없으면 다음 사람이 「0」을 「안전하다」로 읽는다 — 자가 좁아서 0일 수도 있다.
    console.log(
      `[self-heal ratchet] files=${filesScanned} gates=${gatesSeen} gatedDebugCalls=${sites.length} `
      + `offenders=${offenders.length} (words: ${SELF_HEAL_EVENT_WORDS.join(', ')}; block scan by indent, cap=${MAX_BLOCK_LINES})`,
    );
    expect(offenders.map((o) => `${o.file}:${o.line} ${o.category}/${o.event}`)).toEqual([]);
  });

  // ⛔⭐⭐⭐ **자가 «자기를» 문다.** 무인 리뷰(`#12825` 사후)가 이 자의 거짓 음성 «둘»을 짚었다 —
  //   한 줄 `if (debug.enabled) debug.log(…)` 와 여러 줄로 «접힌» `debug.log(`.
  //   ⛔ 「넓혔다」를 «주장»으로 두지 않으려고 합성 표본으로 못 박는다.
  //   🪞 오늘 밤 이 창의 규율 그대로다 — ***자를 만들었으면 「손으로 아는 답」과 맞춰 본다.***
  it.each([
    ['한 줄 게이트', ["    if (debug.enabled) debug.log('llm.router', 'x.tool-name.repaired', { a: 1 });"]],
    ['여러 줄로 접힌 호출', [
      '    if (debug.enabled) {',
      '      debug.log(',
      "        'llm.router',",
      "        'x.codex-grace-burned',",
      '        { a: 1 },',
      '      );',
      '    }',
    ]],
    ['보통 형태', [
      '    if (debug.enabled) {',
      "      debug.log('llm.router', 'x.self-heal.applied', { a: 1 });",
      '    }',
    ]],
  ])('%s 를 «본다» — 이 형태를 놓치면 래칫이 조용히 무력해진다', (_label, lines) => {
    const { sites } = scanGatedDebugCalls(lines as string[]);
    expect(sites.map((x) => `${x.category}/${x.event}`)).toHaveLength(1);
    expect(SELF_HEAL_EVENT_WORDS.some((w) => sites[0]!.event.includes(w))).toBe(true);
  });

  // ⛔ 반대쪽도 문다 — 게이트 «밖»의 호출을 위반으로 세면 안 된다(1판이 그랬다).
  it('게이트가 닫힌 «뒤»의 호출은 세지 않는다 — 1판의 거짓 양성', () => {
    const { sites } = scanGatedDebugCalls([
      '    if (debug.enabled) {',
      "      debug.log('a', 'b');",
      '    }',
      "    debug.log('llm.router', 'x.tool-name.repaired', { a: 1 });",
    ]);
    expect(sites.map((x) => x.event)).toEqual(['b']);
  });

  // ⛔⭐ 위 시험이 «공짜로» 통과하는 길을 막는다 — 자가 아무것도 못 훑으면 offenders 는 «항상» 0이다.
  //   그건 「위반이 없다」가 아니라 ***「잴 것이 없다」***다.
  it('자가 실제로 «훑었다» — 위 시험이 공짜로 통과하는 것을 막는다', () => {
    const { sites, gatesSeen, filesScanned } = gatedDebugCalls();
    expect(filesScanned).toBeGreaterThan(0);
    expect(gatesSeen).toBeGreaterThan(0);
    // 게이트 뒤에 debug.log 가 «많이» 있는 것은 정상이다(핫패스는 거기 있어야 한다).
    // 이 줄은 「자가 그것을 볼 수 있나」만 문다.
    expect(sites.length).toBeGreaterThan(0);
  });
});
