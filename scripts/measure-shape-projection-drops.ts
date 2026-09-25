// 자: 「값이 «안»에 있는데 «나가는 shape»에 없다」 — 그 형태가 이 저장소에 몇 자리인가.
//
// ⛔ 왜 이 자가 있나 — 2026-08-18 에 «넷»이 하루에 났다. 🅣 표본 둘(OBS-T87 관측자 · 축 W 의
//   firstRegisteredAt) ⊕ 🅢 표본 둘(#9998 이 분해 신원을 셋 중 하나에만 꽂았다). 표본 넷은
//   「계열이다」라고 말하기엔 얕고, ***분모가 없으면 「많다」가 아니라 「내가 넷을 봤다」일 뿐***이다.
//   ⇒ 이 자는 «분모»를 만든다.
//
// 🎯 세는 것 — 인자 «하나»를 받아 다른 object 를 내는 함수(=매퍼)에서,
//   인자 타입에 «있는» 속성 이름이 반환 타입에 «없는» 것.
// ⛔ 세지 «않는» 것 — 의도적 축소(비밀 가리기·용량 줄이기)는 여기서 못 가른다.
//   그래서 산출은 «결손»이 아니라 ***「후보」***다. 사람이 열어 가른다.
// ⛔ 겹침을 요구한다 — 두 타입이 속성 «둘 이상»을 공유할 때만 「같은 레코드의 투영」으로 본다.
//   안 그러면 그냥 「A 를 받아 B 를 만드는 함수」가 전부 걸린다.
import ts from 'typescript';
import { relative } from 'node:path';

const MIN_SHARED = 2;          // 「같은 레코드의 투영」으로 볼 최소 공유 속성 수
const MIN_SOURCE_PROPS = 3;    // 원본이 이보다 작으면 투영이라 부르기 어렵다

const configPath = ts.findConfigFile('.', ts.sys.fileExists, 'tsconfig.json');
if (!configPath) { console.error('tsconfig.json 을 못 찾았다'); process.exit(1); }
const parsed = ts.parseJsonConfigFileContent(
  ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, process.cwd());
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

/** Promise<T> · readonly wrapper 를 벗긴다. 못 벗기면 원본을 돌려준다. */
function unwrap(type: ts.Type): ts.Type {
  const sym = type.getSymbol();
  if (sym?.getName() === 'Promise') {
    const args = checker.getTypeArguments(type as ts.TypeReference);
    if (args.length === 1) return args[0]!;
  }
  return type;
}

/**
 * ⛔⭐ **이 저장소가 «선언한» 타입인가.** 1차판은 이 관문이 없어서 `string`(프로토타입 49개) ·
 *   `Buffer`(106개)를 「필드를 103개 떨구는 매퍼」로 셌다 — 463/1292 라는 «그럴듯한» 수가 나왔고
 *   떨군 것이 `charAt` · `subarray` 여서 잡혔다. ***내장 타입은 투영의 대상이 아니다.***
 */
function isLocallyDeclared(type: ts.Type): boolean {
  const decls = type.getSymbol()?.getDeclarations() ?? type.aliasSymbol?.getDeclarations() ?? [];
  if (decls.length === 0) return false;
  return decls.some((d) => {
    const f = d.getSourceFile().fileName;
    return !f.includes('node_modules') && !f.includes('/typescript/lib/') && !/lib\.[a-z0-9.]*d\.ts$/.test(f);
  });
}

/** 속성 이름 집합 — object 가 아니면 null(=매퍼 후보가 아니다). */
function propNames(type: ts.Type): Set<string> | null {
  const t = unwrap(type);
  if (t.isUnionOrIntersection()) return null;          // 갈래는 「투영」으로 못 읽는다
  if (t.getCallSignatures().length > 0) return null;   // 함수 타입
  if (checker.isArrayType(t) || checker.isTupleType(t)) return null;
  if (t.flags & ts.TypeFlags.StringLike) return null;  // string 은 프로토타입 49개를 «속성»으로 낸다
  if (t.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike)) return null;
  if (!isLocallyDeclared(t)) return null;              // ⛔ 위 주석 — 1차판이 여기서 오염됐다
  const props = t.getProperties().map((p) => p.getName()).filter((n) => !n.startsWith('__'));
  if (props.length === 0) return null;
  return new Set(props);
}

type Hit = { file: string; line: number; fn: string; dropped: string[]; shared: number; srcSize: number };
const hits: Hit[] = [];
const candidateNames: string[] = [];   // 분모를 이름별로도 쪼갤 수 있게 «후보 전부»를 남긴다
let candidates = 0;
let filesScanned = 0;

for (const sf of program.getSourceFiles()) {
  const f = relative(process.cwd(), sf.fileName);
  if (sf.isDeclarationFile) continue;
  if (!f.startsWith('src/')) continue;
  if (f.endsWith('.test.ts') || f.endsWith('.d.ts')) continue;
  filesScanned += 1;

  const visit = (node: ts.Node): void => {
    let fn: ts.SignatureDeclaration | null = null;
    let name = '(anonymous)';
    if (ts.isFunctionDeclaration(node) && node.name) { fn = node; name = node.name.text; }
    else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) { fn = node; name = node.name.text; }
    else if (ts.isVariableDeclaration(node) && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      && ts.isIdentifier(node.name)) { fn = node.initializer; name = node.name.text; }

    if (fn && fn.parameters.length === 1) {
      const sig = checker.getSignatureFromDeclaration(fn);
      const param = fn.parameters[0]!;
      if (sig && ts.isIdentifier(param.name)) {
        const src = propNames(checker.getTypeOfSymbolAtLocation(
          checker.getSymbolAtLocation(param.name)!, param.name));
        const dst = propNames(checker.getReturnTypeOfSignature(sig));
        if (src && dst && src.size >= MIN_SOURCE_PROPS) {
          const shared = [...src].filter((p) => dst.has(p)).length;
          // ⛔⭐ **「투영」과 「조립」을 가른다.** 2차판은 겹침 «수»만 봐서 `makeConfigCtx(opts)` 처럼
          //   ***옵션 가방을 받아 «다른» 객체를 만드는*** 함수가 「37개를 떨궜다」로 잡혔다.
          //   ⇒ 목적지가 «절반 이상» 원본 필드로 이뤄질 때만 «같은 레코드의 투영»으로 본다.
          if (shared >= MIN_SHARED && shared >= dst.size * 0.5) {
            candidates += 1;
            candidateNames.push(name);
            const dropped = [...src].filter((p) => !dst.has(p));
            if (dropped.length > 0) {
              const { line } = sf.getLineAndCharacterOfPosition(fn.getStart(sf));
              hits.push({ file: f, line: line + 1, fn: name, dropped, shared, srcSize: src.size });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

hits.sort((a, b) => b.dropped.length - a.dropped.length);
console.log(`📏 스캔 ${filesScanned} 파일 · 매퍼 «후보» ${candidates}자리 · 그중 필드를 떨구는 것 ***${hits.length}***`
  + ` (${candidates === 0 ? 'n/a' : (hits.length / candidates * 100).toFixed(1)}%)\n`);
console.log('| 자리 | 함수 | 원본 필드 | 공유 | ***떨군 것*** |');
console.log('|---|---|---:|---:|---|');
for (const h of hits.slice(0, 40)) {
  console.log(`| ${h.file}:${h.line} | \`${h.fn}\` | ${h.srcSize} | ${h.shared} | **${h.dropped.length}** — ${h.dropped.slice(0, 6).join(' · ')}${h.dropped.length > 6 ? ' …' : ''} |`);
}
if (hits.length > 40) console.log(`\n… 그 밖 ${hits.length - 40}자리 (상위 40만 표시 — ⛔ 이 절단은 «표시»일 뿐 판정이 아니다)`);

// ⭐ **모호성 0 인 부분집합** — 위 표는 「옵션 가방 → 조립」이 섞여 있어 사람이 갈라야 한다.
//   그런데 ***이름이 「투영 관용구」인 것***은 갈 필요가 없다: 「같은 레코드를 다른 shape 으로 낸다」가
//   이름에 이미 적혀 있다. 「계열이다」를 말할 때 «이 수»를 인용한다.
const IDIOM = /^(rowTo|to[A-Z]|as[A-Z]|serialize|snapshot|describe|observe|project|render[A-Z])|^(view|summary)$/;
const idiomAll = candidateNames.filter((n) => IDIOM.test(n)).length;
const idiomHits = hits.filter((h) => IDIOM.test(h.fn));
console.log(`\n---\n\n⭐ **투영 관용구 부분집합** (rowTo* · to* · as* · serialize* · snapshot* · describe* · observe* · view · summary)`);
console.log(`📏 그 이름의 매퍼 ${idiomAll}자리 · 그중 필드를 떨구는 것 ***${idiomHits.length}***`
  + ` (${idiomAll === 0 ? 'n/a' : (idiomHits.length / idiomAll * 100).toFixed(1)}%)\n`);
console.log('| 자리 | 함수 | ***떨군 것*** |');
console.log('|---|---|---|');
for (const h of idiomHits) {
  console.log(`| ${h.file}:${h.line} | \`${h.fn}\` | **${h.dropped.length}** — ${h.dropped.slice(0, 8).join(' · ')}${h.dropped.length > 8 ? ' …' : ''} |`);
}
console.log(`\n⛔ 읽는 법`);
console.log(`  · 이 표는 «결손 목록»이 아니라 ***「후보」***다 — 의도적 축소를 자동으로 못 가른다.`);
console.log(`  · 「계열이다」를 말하려면 «분모»(${candidates})와 «비율»을 같이 인용한다.`);
console.log(`  · 겹침 문턱 ${MIN_SHARED} · 원본 최소 속성 ${MIN_SOURCE_PROPS} — 이 둘을 바꾸면 수가 바뀐다.`);
