#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';
import { normalize, resolve } from 'node:path';
import { parseCronLine, readCrontab } from '../src/domains/schedule-registry.js';
import ts from 'typescript';

type CronFlagFinding = {
  readonly scriptPath: string;
  readonly flag: string;
};

type CronFlagGuardAudit = {
  readonly scriptsInspected: number;
  readonly guardedScripts: readonly string[];
  readonly unguardedScripts: readonly string[];
  readonly unreadableSources: readonly string[];
  /** ⭐ 위임 모듈 쪽 불확실 «경로#이름» — ⛔ 대상 스크립트가 «아니다». 「없다」와 다른 값이다. */
  readonly undeterminedDelegates: readonly string[];
};

type CronFlagContractAudit = {
  readonly mismatchedFlags: readonly CronFlagFinding[];
  readonly undeterminedContracts: readonly string[];
};

type CronFlagAudit = {
  readonly inspectedLines: number;
  readonly findings: readonly CronFlagFinding[];
  readonly missingSources: readonly string[];
  readonly guardAudit: CronFlagGuardAudit;
  readonly contractAudit: CronFlagContractAudit;
};

type AuditDependencies = {
  readonly root?: string;
  readonly sourceFor?: (scriptPath: string) => string | null;
};

const SCRIPT_PATH = /(?:^|\s)((?:\S*\/)?scripts\/(?:[\w.-]+\/)*[\w.-]+\.ts)(?=\s|$)/g;
const FLAG = /^--[\w][\w-]*$/;
// ⭐ FD 지정 리다이렉션(`1>` · `2>>` · `&>`)까지 «한 규칙»으로 — 손으로 나열하면 또 빠진다(무인 리뷰 7차).
const REDIRECT_PREFIX = /^(?:\d*|&)>>?/;
const STOP = /^(?:(?:\d*|&)>>?|\||&&)$/;
const READ_FLAG = /(?:\b(?:argv|process\.argv)\s*\.\s*(?:includes|indexOf)\s*\(\s*|\bflag\s*\(\s*)['"](--[\w-]+)['"]/g;

function repositoryPath(path: string): string {
  return path.match(/scripts\/(?:[\w.-]+\/)*[\w.-]+\.ts$/)?.[0] ?? path;
}

function targetsIn(line: string): readonly { scriptPath: string; tail: string }[] {
  const command = parseCronLine(line)?.command;
  if (!command) return [];
  const targets: { scriptPath: string; tail: string }[] = [];
  // ⛔⭐⭐ 제외는 ***«위치»로*** 한다 — 문자열로 빼면 같은 경로가 «다른 자리»에서 진짜 대상일 때도
  //   함께 빠진다(무인 리뷰 10차: `bun > scripts/x.ts && bun scripts/x.ts --a`).
  //   ⇒ 토큰마다 «문자 오프셋»을 재고, 매치 위치가 그 토큰이면 그 «한 번»만 제외한다.
  const spans: { start: number; end: number; token: string }[] = [];
  for (const match of command.matchAll(/\S+/g)) {
    spans.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, token: match[0] });
  }
  const excludedStarts = new Set<number>();
  for (let index = 0; index < spans.length; index += 1) {
    const token = spans[index]!.token;
    // ⛔⭐ ***떨어진 꼴을 «먼저» 본다*** — `>>` 는 붙은 꼴 검사에도 걸려서,
    //   순서를 뒤집으면 «다음 토큰»을 영영 표시 못 한다(이 창이 그 버그를 냈다).
    if (/^(?:\d*|&)>>?$/.test(token)) {
      if (spans[index + 1]) excludedStarts.add(spans[index + 1]!.start);
      continue;
    }
    // 붙은 꼴(`>>/tmp/x`)은 그 토큰 «자신»이 리다이렉션 ⊕ 대상이다
    if (REDIRECT_PREFIX.test(token)) excludedStarts.add(spans[index]!.start);
  }
  for (const match of command.matchAll(SCRIPT_PATH)) {
    const scriptPath = repositoryPath(match[1]!);
    // 매치는 앞에 공백을 포함할 수 있다 ⇒ 실제 경로가 시작하는 «절대 위치»를 쓴다
    const pathStart = (match.index ?? 0) + match[0].indexOf(match[1]!);
    const inExcludedToken = spans.some((span) => span.start <= pathStart && pathStart < span.end && excludedStarts.has(span.start));
    if (!inExcludedToken && scriptPath !== 'scripts/cron-run.ts') {
      targets.push({ scriptPath, tail: command.slice((match.index ?? 0) + match[0].length) });
    }
  }
  return targets;
}

function flagsBeforeRedirection(tail: string): readonly string[] {
  const flags: string[] = [];
  const tokens = tail.trim().split(/\s+/);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token) break;
    if (token === '|' || token === '&&') break;              // ⇐ 여기서 «다른 명령»이 시작한다
    if (STOP.test(token)) { index += 1; continue; }           // 떨어진 리다이렉션 ⇒ 대상 «하나»를 건너뛴다
    if (REDIRECT_PREFIX.test(token)) continue;                // 붙은 꼴 ⇒ 그 토큰만 건너뛴다
    if (FLAG.test(token)) flags.push(token);
  }
  return flags;
}

function readFlags(source: string): ReadonlySet<string> {
  return new Set([...source.matchAll(READ_FLAG)].map((match) => match[1]!));
}

/** ⭐ 스크립트가 «지역 모듈에 위임»해 플래그를 읽는 경우를 «한 단계» 따라간다.
 *  🩸 실물(2026-09-04): `scripts/botlab/bot-routine.ts` 는 `resolveDeliveryMode(process.argv)` 로 위임하고
 *    `--deliver` 는 `./bot-routine-deliver.ts` 안에서 읽힌다. 한 파일만 보면 ***없는 결함***을 신고한다.
 *
 *  ⛔⭐⭐ 무인 리뷰가 이 함수의 첫 판에서 «둘»을 잡았다(2026-09-04 · 둘 다 옳았다):
 *    ① 모든 상대 import 를 따라가면 ***무관한 helper 의 `--flag` 가 진짜 오타를 가린다***(위음성)
 *       ⇒ ✅ ***`process.argv`(또는 `argv`)를 인자로 «실제 호출»하는 바인딩***이 온 모듈만 따라간다.
 *    ② 그 모듈을 못 읽으면 첫 판은 그 플래그를 「안 읽힘」으로 냈다 — ***위양성***이고 주석과 정반대였다
 *       ⇒ ✅ ***「못 쟀다」로 낸다***(`delegateUnreadable`) — 「없다」와 «같은 값»으로 접지 않는다.
 */
/** ⭐ `undetermined` 는 ***위임 모듈 경로#이름***이다 — «대상 스크립트»가 아니다(무인 리뷰 4차 지적).
 *  대상은 읽었고 가드도 판정했다. 불확실한 것은 «위임 쪽»뿐이다. */
type DelegateReadResult = { readonly flags: ReadonlySet<string>; readonly undetermined: readonly string[] };

/** ⭐ 위임의 «증거»를 ***AST 로*** 판정한다 — 정규식은 ***shadowing 을 못 가린다***.
 *  🩸 무인 리뷰 3차 지적: import 된 이름과 «같은 이름»의 지역 변수·매개변수가 가리면
 *    정규식은 그 호출을 위임으로 «오인»하고 helper 의 플래그를 합쳐 ***진짜 오타를 숨긴다***(위음성).
 *  ✅ 그래서 이 파일이 이미 쓰는 checker 로 ***호출 대상의 선언이 «그 import 바인딩»인지***를 확인한다.
 *  ⛔ 확인 «못 하면» 그 모듈을 «안 따라간다» — 모르면 덜 본다(위양성을 만들지 않는다). */
function delegateSpecifiers(source: string): readonly { readonly name: string; readonly specifier: string }[] {
  const fileName = 'cron-delegate-target.ts';
  const host = ts.createCompilerHost({});
  host.fileExists = (name) => name === fileName;
  host.readFile = (name) => name === fileName ? source : undefined;
  host.getSourceFile = (name) => name === fileName
    ? ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    : undefined;
  const program = ts.createProgram({ rootNames: [fileName], options: {}, host });
  const file = program.getSourceFile(fileName);
  if (!file) return [];
  const checker = program.getTypeChecker();

  // ⓐ 상대 모듈에서 «값으로» 들여온 바인딩 ⇒ 그 모듈 지정자
  const specifierOf = new Map<ts.ImportSpecifier, string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith('.')) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (!element.isTypeOnly) specifierOf.set(element, statement.moduleSpecifier.text);
    }
  }
  if (specifierOf.size === 0) return [];

  // ⓑ `f(process.argv)` / `f(argv)` 호출의 «선언»이 그 바인딩인 것만 위임으로 센다
  const found = new Map<string, { name: string; specifier: string }>();
  // ⛔⭐⭐ 인자 «바인딩»도 확인한다(무인 리뷰 6차 지적) — 이름만 보면 지역 shadowing 에 속는다.
  //   ✅ 인정하는 것은 ***전역 `process` 의 `.argv`*** «하나»뿐이다:
  //      · `process` 가 이 파일 안에 «선언»돼 있으면(지역 shadow) ⇒ 위임으로 «안 센다»
  //      · bare `argv` 는 «아예 안 받는다» — 그것이 CLI argv 인지 확인할 길이 없다
  //   📏 실측(2026-09-04): 동기가 된 실물(`bot-routine.ts`)은 `resolveDeliveryMode(process.argv)` 형태이고,
  //     bare argv 를 쓰는 `mission-request-judge.ts` 는 `--root`·`--tick` 을 «직접» 읽어 이 좁힘에 안 걸린다.
  //   ⇒ 🔑 ***확인 못 하면 안 따라간다*** — 이 판의 원칙이고, 덜 따라가는 것은 위양성을 만들지 않는다.
  const firstArgIsProcessArgv = (node: ts.CallExpression): boolean => {
    const first = node.arguments[0];
    if (!first || !ts.isPropertyAccessExpression(first) || first.name.text !== 'argv') return false;
    if (!ts.isIdentifier(first.expression) || first.expression.text !== 'process') return false;
    const declarations = checker.getSymbolAtLocation(first.expression)?.declarations ?? [];
    // 이 파일 «안»에 선언이 있으면 지역 shadow 다 ⇒ 위임으로 안 센다.
    return !declarations.some((declaration) => declaration.getSourceFile() === file);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && firstArgIsProcessArgv(node)) {
      const declaration = checker.getSymbolAtLocation(node.expression)?.declarations?.[0];
      const specifier = declaration ? specifierOf.get(declaration as ts.ImportSpecifier) : undefined;
      if (specifier) {
        const element = declaration as ts.ImportSpecifier;
        const exportedName = element.propertyName?.text ?? element.name.text;
        found.set(`${specifier}\u0000${exportedName}`, { name: exportedName, specifier });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...found.values()];
}

/** ⛔⭐ 위임 모듈 «전체»의 플래그를 합치면 ***무관한 export 의 `--flag` 가 진짜 오타를 숨긴다***(리뷰 4차).
 *  ⛔⭐⭐ 그리고 ***이름이 같다고 그것이 «그 export» 인 것도 아니다***(리뷰 5차):
 *    `export { other as used }` 와 로컬 `function used()` 가 공존하면 ***로컬의 플래그가 오타를 숨긴다***.
 *  ⇒ ✅ ***실제 named export 바인딩만*** 해석한다. 해석 못 하면 «합치지 않고» 판정 불가로 낸다.
 */
function readFlagsOfExport(source: string, exportedName: string): { flags: ReadonlySet<string>; found: boolean } {
  const file = ts.createSourceFile('delegate.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hasExportModifier = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

  // ⓐ `export { X as used }` — 별칭이 있으면 «그 로컬 이름»을 찾아야 한다
  let localName = exportedName;
  let sawExportBinding = false;
  for (const statement of file.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
    if (statement.moduleSpecifier) continue; // ⛔ 재수출(다른 모듈)은 이 판이 «안 따라간다»
    for (const element of statement.exportClause.elements) {
      if (element.name.text !== exportedName) continue;
      localName = (element.propertyName ?? element.name).text;
      sawExportBinding = true;
    }
  }

  // ⓑ 선언을 찾는다 — `export` 수식어가 있거나 ⓐ 가 가리킨 로컬이어야 한다
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === localName) {
      if (hasExportModifier(statement) || sawExportBinding) return { flags: readFlags(statement.getText(file)), found: true };
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== localName) continue;
        if (hasExportModifier(statement) || sawExportBinding) return { flags: readFlags(declaration.getText(file)), found: true };
      }
    }
  }
  return { flags: new Set<string>(), found: false };
}

function readFlagsWithLocalDelegates(scriptPath: string, source: string, readDelegate: (path: string) => string | null): DelegateReadResult {
  const flags = new Set(readFlags(source));
  const dir = scriptPath.slice(0, scriptPath.lastIndexOf('/'));
  const undetermined: string[] = [];
  for (const { name, specifier } of delegateSpecifiers(source)) {
    const relative = normalize(`${dir}/${specifier.replace(/\.js$/, '.ts')}`);
    const delegateSource = readDelegate(relative);
    if (delegateSource === null) { undetermined.push(`${relative}#${name}`); continue; }
    const exported = readFlagsOfExport(delegateSource, name);
    // ⛔ 그 이름을 못 찾으면 «합치지 않는다» — 모르면 덜 본다.
    if (!exported.found) { undetermined.push(`${relative}#${name}`); continue; }
    for (const flag of exported.flags) flags.add(flag);
  }
  return { flags, undetermined };
}

type RuntimeUnknownCronFlagImports = {
  readonly named: ReadonlySet<ts.ImportSpecifier>;
  readonly namespaces: ReadonlySet<ts.NamespaceImport>;
};

function runtimeUnknownCronFlagImports(file: ts.SourceFile): RuntimeUnknownCronFlagImports {
  const named = new Set<ts.ImportSpecifier>();
  const namespaces = new Set<ts.NamespaceImport>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== '../src/domains/cron-flag-contract.js') continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings);
      continue;
    }
    for (const element of bindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (!element.isTypeOnly && importedName === 'unknownCronFlag') named.add(element);
    }
  }
  return { named, namespaces };
}

type UnknownCronFlagContract = {
  readonly contracts: readonly ReadonlySet<string>[];
  readonly hasUndeterminedContract: boolean;
} | undefined;

function unknownCronFlagContract(source: string): UnknownCronFlagContract {
  const fileName = 'cron-target.ts';
  const host = ts.createCompilerHost({});
  host.fileExists = (name) => name === fileName;
  host.readFile = (name) => name === fileName ? source : undefined;
  host.getSourceFile = (name) => name === fileName
    ? ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    : undefined;
  const program = ts.createProgram({ rootNames: [fileName], options: {}, host });
  const file = program.getSourceFile(fileName);
  if (!file) return undefined;
  const importedBindings = runtimeUnknownCronFlagImports(file);
  if (importedBindings.named.size === 0 && importedBindings.namespaces.size === 0) return undefined;
  const checker = program.getTypeChecker();
  let sawGuard = false;
  const contracts: ReadonlySet<string>[] = [];
  let hasUndeterminedContract = false;
  const literalFlags = (node: ts.Expression): ReadonlySet<string> | undefined => {
    if (!ts.isObjectLiteralExpression(node)) return undefined;
    const flags = new Set<string>();
    const categories = new Set<string>();
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) return undefined;
      if (property.name.text !== 'boolean' && property.name.text !== 'valued') continue;
      categories.add(property.name.text);
      if (!ts.isArrayLiteralExpression(property.initializer)) return undefined;
      for (const element of property.initializer.elements) {
        if (!ts.isStringLiteral(element)) return undefined;
        flags.add(element.text);
      }
    }
    return categories.has('boolean') && categories.has('valued') ? flags : undefined;
  };
  const visit = (node: ts.Node): void => {
    if (!ts.isCallExpression(node)) {
      ts.forEachChild(node, visit);
      return;
    }
    let isGuard = false;
    if (ts.isIdentifier(node.expression)) {
      const declaration = checker.getSymbolAtLocation(node.expression)?.declarations?.[0];
      isGuard = Boolean(declaration && importedBindings.named.has(declaration as ts.ImportSpecifier));
    } else if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'unknownCronFlag') {
      const declaration = checker.getSymbolAtLocation(node.expression.expression)?.declarations?.[0];
      isGuard = Boolean(declaration && importedBindings.namespaces.has(declaration as ts.NamespaceImport));
    }
    if (isGuard) {
      sawGuard = true;
      const flags = node.arguments[1] ? literalFlags(node.arguments[1]) : undefined;
      if (flags) contracts.push(flags);
      else hasUndeterminedContract = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return sawGuard ? { contracts, hasUndeterminedContract } : undefined;
}

function usesUnknownCronFlag(source: string): boolean {
  return unknownCronFlagContract(source) !== undefined;
}

/** Compare literal cron-supplied flag tokens with literal argv flag reads; no shell semantics are interpreted. */
export function auditCronFlags(lines: readonly string[], dependencies: AuditDependencies = {}): CronFlagAudit {
  const root = dependencies.root ?? process.cwd();
  const sourceFor = dependencies.sourceFor ?? ((scriptPath: string): string | null => {
    const path = resolve(root, scriptPath);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  });
  const findings: CronFlagFinding[] = [];
  const missingSources = new Set<string>();
  const seen = new Set<string>();
  const guardedScripts = new Set<string>();
  const unguardedScripts = new Set<string>();
  const unreadableSources = new Set<string>();
  const undeterminedDelegates = new Set<string>();
  const contractMismatches: CronFlagFinding[] = [];
  const undeterminedContracts = new Set<string>();
  const contractSeen = new Set<string>();
  const guardSeen = new Set<string>();

  for (const line of lines) {
    for (const target of targetsIn(line)) {
      const flags = flagsBeforeRedirection(target.tail);
      const source = sourceFor(target.scriptPath);
      if (source === null) {
        missingSources.add(target.scriptPath);
        if (flags.length > 0 && !guardSeen.has(target.scriptPath)) unreadableSources.add(target.scriptPath);
        if (flags.length > 0) guardSeen.add(target.scriptPath);
        continue;
      }
      if (flags.length > 0 && !guardSeen.has(target.scriptPath)) {
        guardSeen.add(target.scriptPath);
        (usesUnknownCronFlag(source) ? guardedScripts : unguardedScripts).add(target.scriptPath);
      }
      if (flags.length > 0) {
        const contract = unknownCronFlagContract(source);
        if (contract) {
          if (contract.hasUndeterminedContract) undeterminedContracts.add(target.scriptPath);
          for (const flag of flags) {
            const key = `${target.scriptPath}\u0000${flag}`;
            if (contract.contracts.some((flagsInContract) => !flagsInContract.has(flag)) && !contractSeen.has(key)) {
              contractSeen.add(key);
              contractMismatches.push({ scriptPath: target.scriptPath, flag });
            }
          }
        }
      }
      const delegate = readFlagsWithLocalDelegates(target.scriptPath, source, sourceFor);
      // ⛔⭐ 위임 쪽이 불확실하면 「안 읽힘」이라 «단정하지 않는다» — 그러나 그것은 «위임»의 불확실이지
      //   대상 스크립트를 «못 읽은» 것이 아니다(무인 리뷰 4차 지적: 사실과 다르게 보고하고 있었다).
      for (const item of delegate.undetermined) undeterminedDelegates.add(item);
      if (delegate.undetermined.length > 0) continue;
      const read = delegate.flags;
      for (const flag of flags) {
        const key = `${target.scriptPath}\u0000${flag}`;
        if (!read.has(flag) && !seen.has(key)) {
          seen.add(key);
          findings.push({ scriptPath: target.scriptPath, flag });
        }
      }
    }
  }
  return {
    inspectedLines: lines.length,
    findings,
    missingSources: [...missingSources],
      guardAudit: {
        scriptsInspected: guardSeen.size,
        guardedScripts: [...guardedScripts],
        unguardedScripts: [...unguardedScripts],
        unreadableSources: [...unreadableSources],
        undeterminedDelegates: [...undeterminedDelegates],
      },
      contractAudit: {
        mismatchedFlags: contractMismatches,
        undeterminedContracts: [...undeterminedContracts],
      },
    };
}

export function formatCronFlagAudit(result: CronFlagAudit): string {
  const lines = [`검사한 크론 줄: ${result.inspectedLines}`];
  if (result.missingSources.length > 0) {
    lines.push('읽지 못한 대상 스크립트:');
    for (const scriptPath of result.missingSources) lines.push(`- ${scriptPath}`);
  }
  // ⛔⭐⭐ 「못 쟀다」를 「문제 없음」으로 «접지 않는다» — 위임 모듈을 못 읽은 대상이 있으면
  //   그 대상들에 대해선 «판정 불가»다. 성공을 단정하면 읽는 사람이 신호를 끈다(무인 리뷰 지적).
  // ⛔ `missingSources` 로 «이미» 말한 것은 다시 말하지 않는다 — 같은 사실을 세 줄로 내지 않는다.
  // ⛔ 같은 사실을 두 번 말하지 않는다 — 아래쪽 「가드 판정 불가」 목록이 «경로»를 이미 낸다.
  //   여기서는 ***성공을 단정하지 않는다***는 사실만 한 줄로 말한다(무인 리뷰 지적).
  // ⛔⭐ 위임 쪽 불확실은 «위임 경로#이름»으로 낸다 — 대상 스크립트를 「못 읽었다」고 말하지 않는다.
  if (result.guardAudit.undeterminedDelegates.length > 0) {
    lines.push('판정 불가(위임 대상을 확인 못 함) — 이 위임들 때문에 읽힘 여부를 단정할 수 없다:');
    for (const item of result.guardAudit.undeterminedDelegates) lines.push(`- ${item}`);
  }
  if (result.contractAudit.undeterminedContracts.length > 0) {
    lines.push('판정 불가(가드 계약을 정적으로 읽지 못함):');
    for (const scriptPath of result.contractAudit.undeterminedContracts) lines.push(`- ${scriptPath}`);
  }
  if (result.contractAudit.mismatchedFlags.length > 0) {
    lines.push('가드 계약에 없는 크론 플래그:');
    for (const finding of result.contractAudit.mismatchedFlags) lines.push(`- ${finding.scriptPath}: ${finding.flag}`);
  }
  if (result.findings.length === 0 && result.missingSources.length === 0 && result.guardAudit.unreadableSources.length === 0 && result.guardAudit.undeterminedDelegates.length === 0 && result.contractAudit.mismatchedFlags.length === 0 && result.contractAudit.undeterminedContracts.length === 0) {
    // ⛔⭐ 「초록」은 «무엇으로» 초록인지 말한다 — 이 관문은 축이 «셋»이고, 문면이 축① 만 말하면
    //   읽는 사람은 「가드 계약도 봤나」를 «다시 재야» 한다. 관문 조건이 늘면 이 줄도 같이 는다.
    lines.push('문제 없음 — 세 축 전부: ⑴크론이 주는 플래그를 스크립트가 읽는다 ⑵가드 판정을 못 한 대상이 없다 ⑶가드 계약이 크론이 주는 플래그를 «받는다».');
  } else if (result.findings.length > 0) {
    lines.push('읽히지 않는 크론 플래그:');
    for (const finding of result.findings) lines.push(`- ${finding.scriptPath}: ${finding.flag}`);
  }
  lines.push(`가드 검사 대상 스크립트: ${result.guardAudit.scriptsInspected}`);
  lines.push(`unknownCronFlag 가드 있음: ${result.guardAudit.guardedScripts.length}`);
  lines.push(`unknownCronFlag 가드 없음: ${result.guardAudit.unguardedScripts.length}`);
  if (result.guardAudit.unguardedScripts.length > 0) {
    lines.push('unknownCronFlag 가드 없는 스크립트:');
    for (const scriptPath of result.guardAudit.unguardedScripts) lines.push(`- ${scriptPath}`);
  }
  if (result.guardAudit.unreadableSources.length > 0) {
    lines.push(`가드 판정 불가(읽지 못한 대상): ${result.guardAudit.unreadableSources.length}`);
    for (const scriptPath of result.guardAudit.unreadableSources) lines.push(`- ${scriptPath}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Bun module entrypoint calls main() below; injected lines keep CLI tests independent of live crontab. */
export async function main(lines?: readonly string[]): Promise<CronFlagAudit> {
  const cronLines = lines ?? readCrontab().split('\n');
  const result = auditCronFlags(cronLines);
  process.stdout.write(formatCronFlagAudit(result));
  return result;
}

if (import.meta.main) void main();
