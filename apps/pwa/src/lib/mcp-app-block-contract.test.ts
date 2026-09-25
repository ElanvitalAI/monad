/** ⛔⭐⭐⭐ 「위젯 블록을 만들면 «결과»도 실어라」 — 17차 `[F]`.
 *
 *  ## 왜 이 파일이 있나
 *
 *  📏 16차 `[F]` 가 겪은 사고가 그대로 적혀 있다(`chat-runtime.ts` 의 긴 주석):
 *  ***`kind: 'mcp_app'` 블록을 만드는 자리가 셋인데 결과를 싣는 곳이 둘이었다.***
 *  ⇒ 위젯은 «떴고», 규범대로 악수까지 했는데, **밀 것이 없어** 「Connecting…」에서 영영 멎었다.
 *  ⛔ 화면은 «정상처럼» 보였다 — 그래서 30분을 뒤지고도 자리를 못 찍었다.
 *
 *  ⚠️📏 **그리고 그 「셋」은 늙었다** — 2026-08-22 실측으로 **넷**이다(복원 경로가 늘었다).
 *  ✅ 지금은 넷 다 싣는다. ⛔ 그러나 ***다섯째가 생기면 또 조용히 빠진다.***
 *  ⇒ 그래서 이 자가 있다. **수를 세지 않고 「전부가 싣는가」만 묻는다** — 자리가 늘어도 따라간다.
 *
 *  ## ⛔⭐⭐ 어떻게 «안전하게» 잘라 내나 — 오늘 배운 함정을 피한 설계
 *
 *  📏 같은 날 다른 자에서 두 번 실패했다: ⓐ「다음 export 까지」로 자르니 ***마지막 함수가
 *  파일 나머지를 삼켰다*** ⓑ 중괄호 균형은 ***정규식 리터럴에 렉서가 어긋났다***.
 *  ⇒ 🔑 여기서는 ***들여쓰기***로 자른다 — 객체 리터럴의 속성은 `kind:` 줄과 «같은 깊이»에 서고,
 *    ***더 «얕은» 코드 줄이 나오면 그 객체는 끝난 것***이다. 정규식도 문자열도 이 판정을 안 흔든다.
 *  ⚠️ 한 줄로 압축된 객체(`{ kind: 'mcp_app', … }`)는 이 자가 못 본다 —
 *    ⛔ 다만 조용히 통과하지 «않는다»: 아래 첫 시험이 「자리 수 ≥ 4」를 요구하므로,
 *    그렇게 쓰기 시작하면 ***발견 수가 줄어 실패한다.***
 *
 *  🔎 이 축을 손으로 재는 명령(⛔ 줄 «전체»가 그것인 자리만 — 안 그러면 «주석»이 세어진다):
 *  ```bash
 *  rg -n "^\s*kind: 'mcp_app',$" apps/pwa/src -g '!*.test.*'
 *  ``` */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 위젯 블록을 «만드는» 파일들. ⭐ 새 파일이 생기면 여기 넣어라 —
 *  ⛔ 넣지 않아도 아래 「자리 수」 단언이 «줄어드는 쪽»은 잡지만, 새 파일의 «누락»은 못 잡는다. */
const SOURCES = ['chat-runtime.ts', 'session-restore.ts'] as const;

interface Site { readonly file: string; readonly line: number; readonly propertyLines: readonly string[] }

/** `kind: 'mcp_app',` 로 시작하는 객체 리터럴에서 ***그 객체 «자신의» 속성 줄만*** 모은다.
 *
 *  ⛔⭐⭐📏 무인 리뷰 must-fix(PR #11289): 1차판은 본문 «어디든» 그 낱말이 있으면 통과시켰다.
 *  ⇒ ***주석·중첩 콜백·다른 속성 값의 참조만으로도 실제 속성 없이 통과한다.***
 *  🔑 그리고 그 상황이 ***이미 소스에 있었다*** — `chat-runtime.ts` 의 긴 주석이 `toolResult` 를
 *    여러 번 «언급»한다. ⇒ 진짜 속성이 빠져도 그 주석으로 통과했을 것이다.
 *  ⛔ 이것은 오늘 이 세션에서 **세 번째** 같은 형태다(자 두 개 ⊕ 「재는 명령」 하나).
 *    🔑 ***정적 자는 「무엇을 재는지」를 좁히지 않으면 언제나 「있는 척」을 잰다.***
 *
 *  ⇒ 그래서 ⓐ **들여쓰기가 정확히 그 객체 깊이인 줄만** 보고 ⓑ **주석 줄을 뺀다.**
 *    ⭐ 스프레드도 그 깊이에 서므로 함께 본다:
 *      `...(rawOutput !== undefined ? { toolResult: rawOutput } : {}),` ✅ */
export function mcpAppSites(file: string, source: string): Site[] {
  const lines = source.split('\n');
  const out: Site[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)kind: 'mcp_app',$/.exec(lines[i]!);
    if (!m) continue;
    const depth = m[1]!.length;
    const propertyLines: string[] = [];
    // ⛔⭐📏 무인 리뷰 must-fix 2차(PR #11289): 1차 수렴은 `//` 만 뺐고
    //   ***`/* { toolResult: x } *\/` 같은 «블록» 주석에는 여전히 속았다.***
    //   ⛔ 오늘 이 세션에서 **두 번째** 같은 지적이다(다른 자에서도 같은 자리를 짚혔다).
    //   ⇒ 여러 줄에 걸친 블록 주석도 «상태»로 따라간다.
    let inBlockComment = false;
    for (let k = i + 1; k < lines.length; k += 1) {
      const line = lines[k]!;
      const body = line.trim();
      if (body === '') continue;
      const indent = line.length - line.trimStart().length;
      if (!inBlockComment && indent < depth) break;    // ⛔ 더 얕아졌다 = 이 객체는 끝났다
      const wasInComment = inBlockComment;
      if (inBlockComment) {
        if (body.includes('*/')) inBlockComment = false;
      } else if (body.startsWith('/*') && !body.includes('*/')) {
        inBlockComment = true;
      }
      if (wasInComment || inBlockComment) continue;    // ⛔ 블록 주석 «안»은 속성이 아니다
      if (indent !== depth) continue;                  // ⛔ 더 깊다 = 중첩된 남의 것
      if (body.startsWith('//')) continue;             // ⛔ 줄 주석도 아니다(그 Goodhart)
      if (body.startsWith('/*') && body.includes('*/')) continue; // ⛔ 한 줄짜리 블록 주석
      propertyLines.push(line);
    }
    out.push({ file, line: i + 1, propertyLines });
  }
  return out;
}

/** ⭐ 「그 객체가 이 속성을 «갖는가»」 — 낱말이 아니라 ***속성 «형태»***로 묻는다. 둘을 받는다:
 *
 *  ```ts
 *  screenUrl,                                              // ⓐ shorthand — 속성 줄 «자체»
 *  ...(rawOutput !== undefined ? { toolResult: rawOutput } : {}),   // ⓑ 스프레드 «안»의 키
 *  ```
 *  📏 ⓐ 를 빠뜨렸다가 자가 `session-restore.ts:128` 을 잡았다 — 무인 리뷰가 예고한
 *  *"허용되는 shorthand"* 가 실제로 거기 있었다. */
const carries = (site: Site, prop: string): boolean => site.propertyLines.some((l) => {
  const body = l.trim();
  if (new RegExp(`^${prop}\\s*(?::|,|$)`).test(body)) return true;  // ⓐ shorthand · `prop:` 시작
  return new RegExp(`\\{[^{}]*\\b${prop}\\s*:`).test(body);         // ⓑ 같은 줄의 «중괄호 안» 키
});

const SITES = SOURCES.flatMap((f) =>
  mcpAppSites(f, readFileSync(resolve(import.meta.dir, f), 'utf8')));

describe('mcp_app 블록 계약 — 「만들면 결과도 실어라」', () => {
  test('위젯 블록을 만드는 자리를 «찾아낸다»', () => {
    // ⭐ 분모를 낸다 — 「무엇을 몇 개 봤나」를 안 적으면 초록이 「전부 봤다」로 읽힌다.
    console.log(`[mcp-app-block] 찾은 자리 ${SITES.length}개: `
      + SITES.map((s) => `${s.file}:${s.line}`).join(', ')
      + '; 기준=줄 전체가 `kind: \'mcp_app\',` 인 객체 리터럴');
    // 📏 2026-08-22 기준 «넷». 늘어나는 것은 정상(새 경로)이고, 줄어들면 발견이 깨진 것이다
    //   (예: 한 줄로 압축된 객체로 바뀌면 이 자가 못 본다 — 그때 여기서 실패한다).
    expect(SITES.length).toBeGreaterThanOrEqual(4);
  });

  test('⛔ 그 «전부»가 `toolResult` 를 싣는다', () => {
    // 🔑 16차 §2d: 셋 중 둘만 실어서 위젯이 「뜨긴 하고 비어 있었다」.
    //   ⛔ 이 값이 없으면 브리지가 «밀 것이 없다» — 관측이 그것을 `skipped:"no-tool-result"` 로 말한다.
    const offenders = SITES.filter((s) => !carries(s, 'toolResult')).map((s) => `${s.file}:${s.line}`);
    expect(offenders).toEqual([]);
  });

  test('⛔ 그리고 «화면 주소»도 싣는다 — 그것이 없으면 위젯이 애초에 못 뜬다', () => {
    const offenders = SITES.filter((s) => !carries(s, 'screenUrl')).map((s) => `${s.file}:${s.line}`);
    expect(offenders).toEqual([]);
  });
});

/** ⛔⭐⭐⭐ **탐지기 자신을 재는 자.** 무인 리뷰 should-fix(PR #11289):
 *  *"반례를 별도 입력 문자열로 검증하는 단위 테스트가 없어, 반증 주장이 자동화되어 있지 않다."*
 *
 *  📏 옳다 — 위 세 시험은 «실제 소스»가 지금 맞다는 것만 말하고,
 *  ***탐지기가 「속을 수 있나」는 말하지 않는다.*** 그것을 손으로 세 번 반증했는데
 *  ⛔ 손 반증은 ***다음 창에게 남지 않는다***(이 차수가 `#11264` 에서 배운 바로 그것).
 *  ⇒ 그래서 반례를 «문자열»로 박아 둔다. 탐지기를 고치다 무디어지면 이 절이 먼저 운다. */
describe('탐지기 반례 — 「있는 척」에 속지 않는다', () => {
  const site = (src: string) => mcpAppSites('x.ts', src)[0]!;
  const block = (props: string) => `  blocks.push({\n    kind: 'mcp_app',\n${props}\n  });\n`;

  test('⭐ 진짜 속성은 «본다» — shorthand · 명시 키 · 스프레드 안의 키', () => {
    expect(carries(site(block("    screenUrl,")), 'screenUrl')).toBe(true);
    expect(carries(site(block("    screenUrl: uri,")), 'screenUrl')).toBe(true);
    expect(carries(site(block("    ...(raw !== undefined ? { toolResult: raw } : {}),")), 'toolResult')).toBe(true);
  });

  test('⛔ 줄 주석에 속지 않는다', () => {
    expect(carries(site(block("    // toolResult: raw  ← 주석")), 'toolResult')).toBe(false);
  });

  test('⛔ 블록 주석에 속지 않는다 — 한 줄짜리도, 여러 줄짜리도', () => {
    expect(carries(site(block("    /* toolResult: raw */")), 'toolResult')).toBe(false);
    expect(carries(site(block("    /*\n     * toolResult: raw\n     */")), 'toolResult')).toBe(false);
  });

  test('⛔ «중첩된 남의 객체»의 속성에 속지 않는다', () => {
    expect(carries(site(block("    payload: {\n      toolResult: raw,\n    },")), 'toolResult')).toBe(false);
  });

  test('⛔ 객체가 «끝난 뒤»의 줄에 속지 않는다', () => {
    const src = `  blocks.push({\n    kind: 'mcp_app',\n    screenUrl,\n  });\n  const later = { toolResult: raw };\n`;
    expect(carries(site(src), 'toolResult')).toBe(false);
  });
});
