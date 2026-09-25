#!/usr/bin/env bun
/**
 * 불변식이 지목한 함수의 «만족 가능한 자리»가 몇 곳인지 센다 (= 반환 지점 수).
 *
 * 왜: 함수 이름은 하나인데 그 안에 만족시킬 자리가 여럿이면, 자식은 «가장 싼 한 곳»에만
 * 심고 계약은 «참»이 된다. 실측 계기 2026-09-01 `#15058` — 무인 병합됐고 계측이 반만 돌았다.
 *
 * ⛔ 이 자가 있는 이유: `rg -A40 'function <이름>' | rg -c 'return'` 로는 «못 센다».
 *    함수 경계를 안 보므로 세 줄짜리 함수가 8 을 냈다(알려진 음성이 양성보다 컸다).
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';

export interface ExitCount {
  readonly name: string;
  readonly exits: number;
  readonly line: number;
}

/** 파일 안 각 함수 선언의 «자기 몸통» 반환 지점 수 — 중첩 함수는 그 함수 것으로 센다. */
export function functionExits(source: string, fileName = 'in.ts'): ExitCount[] {
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const results: ExitCount[] = [];

  const countOwnExits = (fn: ts.FunctionLikeDeclaration): number => {
    let n = 0;
    const walk = (node: ts.Node): void => {
      if (node !== fn && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))) return;
      if (ts.isReturnStatement(node)) n += 1;
      ts.forEachChild(node, walk);
    };
    if (fn.body) ts.forEachChild(fn.body, walk);
    // 식 본문 화살표(`=> expr`)는 반환 지점 하나다.
    if (fn.body && !ts.isBlock(fn.body)) n = 1;
    return n;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      results.push({
        name: node.name.text,
        exits: countOwnExits(node),
        line: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return results;
}

/** 알려진 양성·음성으로 자를 «먼저» 잰다. */
export function selfCheck(): number {
  // ⛔ 중첩 함수가 «반드시» 있어야 한다 — 없으면 함수 경계 가드를 지워도 이 검사가 «통과»한다
  //   (2026-09-01 실측: 가드를 지우고 verify-by-breaking 했더니 초록이었다 — 표본이 약했다).
  const fixture = [
    'function manyExits(a: number): string {',
    '  if (a === 0) return "zero";',
    '  if (a === 1) return "one";',
    '  return "many";',
    '}',
    'function oneExit(a: number): number {',
    '  const helper = function inner(b: number): number {',
    '    if (b < 0) return -b;',
    '    if (b === 0) return 0;',
    '    return b * 2;',           // ← 이 셋은 inner 것이다. oneExit 이 «세면» 안 된다
    '  };',
    '  return helper(a);',
    '}',
    'const arrow = (a: number) => a + 1;',
  ].join('\n');
  const got = functionExits(fixture);
  const many = got.find(f => f.name === 'manyExits')?.exits;
  const one = got.find(f => f.name === 'oneExit')?.exits;
  const ok = many === 3 && one === 1;
  console.log(`[self-check] manyExits=${many}(기대 3) · oneExit=${one}(기대 1) ⇒ ${ok ? 'PASS' : 'FAIL'}`);
  return ok ? 0 : 1;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--self-check') process.exit(selfCheck());

  const [path, wanted] = args;
  let source: string;
  try { source = readFileSync(path!, 'utf8'); } catch { console.log(`⚪ ${path} — 읽지 못했다 (「없다」가 아니라 「못 쟀다」)`); process.exit(2); }

  const all = functionExits(source, path!);
  const shown = wanted ? all.filter(f => f.name === wanted) : all;
  if (shown.length === 0) { console.log(`⚪ ${wanted ?? '(전체)'} — 그 이름의 «함수 선언»을 못 찾았다 (화살표·메서드는 이 자가 안 센다)`); process.exit(2); }

  let flagged = 0;
  for (const f of shown.sort((a, b) => b.exits - a.exits)) {
    const mark = f.exits >= 2 ? '⛔' : '✅';
    if (f.exits >= 2) flagged += 1;
    console.log(`  ${mark} ${f.name}  ${path}:${f.line}  반환 지점 ${f.exits}`);
  }
  console.log(`\n검사 ${shown.length}개 · 반환 지점 2 이상 ${flagged}개 — 그 함수를 불변식에 대려면 «어느 가지»인지 적어라.`);
  process.exit(flagged > 0 ? 1 : 0);
}
