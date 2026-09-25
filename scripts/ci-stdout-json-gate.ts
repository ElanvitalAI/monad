/**
 * Direct console.log(JSON.stringify(...)) ratchet gate.
 *
 * Existing uses are file-local baseline debt. New files and count increases must
 * use writeStdoutJson from src/cli/stdout-json.ts instead.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = join(import.meta.dir, '..');
const BASELINE = join(import.meta.dir, 'stdout-json-baseline.txt');
const SOURCE_FILE = /\.tsx?$/;

type StdoutJsonGateIo = {
  args?: string[];
  cwd?: string;
  scan?: () => Map<string, number>;
  loadBaseline?: () => Map<string, number>;
  writeBaseline?: (entries: Map<string, number>) => void;
  log?: (message: string) => void;
  error?: (message: string) => void;
};

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    // ⛔⭐ `.claude` 를 빼는 이유 — 그 아래 `worktrees/` 에 «남의 작업 트리»가 산다.
    //   📏 실측 2026-09-22: 가짜 워크트리에 위반 하나를 심으니 이 자가 그것을 고발했다
    //   (scanned 65 → 66 · `.claude/worktrees/__probe__/src/fake.ts: 0 → 1`).
    //   ⇒ 게이트가 «이 저장소의 부채»가 아닌 것으로 착지를 막는다. 형제 게이트(mock-module-restore)도 같다.
    if (name === 'node_modules' || name === '.git' || name === '.monad-test' || name === '.claude') continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (SOURCE_FILE.test(name)) out.push(path);
  }
}

function isNamedCall(node: ts.Expression, objectName: string, methodName: string): node is ts.PropertyAccessExpression {
  return ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === objectName
    && node.name.text === methodName;
}

function isDirectJsonConsoleLog(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !isNamedCall(node.expression, 'console', 'log')) return false;
  const firstArgument = node.arguments[0];
  return !!firstArgument
    && ts.isCallExpression(firstArgument)
    && isNamedCall(firstArgument.expression, 'JSON', 'stringify');
}

export function countDirectJsonConsoleLogs(source: string): number {
  const file = ts.createSourceFile('candidate.ts', source, ts.ScriptTarget.Latest, true);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (isDirectJsonConsoleLog(node)) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(file);
  return count;
}

/** 뿌리 아래 소스를 걸어 파일별 위반 수를 센다. ⭐ 시험이 «실제 디렉토리»로 정의역을 누를 수 있게 export 한다. */
export function scan(root = ROOT): Map<string, number> {
  const files: string[] = [];
  walk(root, files);
  const entries = new Map<string, number>();
  for (const file of files) {
    const count = countDirectJsonConsoleLogs(readFileSync(file, 'utf8'));
    if (count > 0) entries.set(relative(root, file), count);
  }
  return entries;
}

function loadBaseline(root = ROOT): Map<string, number> {
  const entries = new Map<string, number>();
  const baseline = join(root, 'scripts', 'stdout-json-baseline.txt');
  if (!existsSync(baseline)) return entries;
  for (const line of readFileSync(baseline, 'utf8').split('\n')) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    const [count, file] = text.split('\t', 2);
    if (file) entries.set(file, Number.parseInt(count, 10) || 0);
  }
  return entries;
}

function writeBaseline(entries: Map<string, number>): void {
  const total = [...entries.values()].reduce((sum, count) => sum + count, 0);
  const lines = [...entries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, count]) => `${count}\t${file}`);
  writeFileSync(BASELINE, [
    '# direct console.log(JSON.stringify(...)) baseline (file-local count).',
    '# New files and increases fail; replace uses with writeStdoutJson from src/cli/stdout-json.ts.',
    `# total=${total} · files=${entries.size}`,
    '',
    ...lines,
    '',
  ].join('\n'));
}

export function runStdoutJsonGate(io: StdoutJsonGateIo = {}): number {
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;
  const args = io.args ?? process.argv.slice(2);
  const root = io.cwd ?? ROOT;
  const current = io.scan ? io.scan() : scan(root);
  const total = [...current.values()].reduce((sum, count) => sum + count, 0);
  log(`[stdout-json-gate] scanned ${current.size} file(s); ${total} direct JSON console.log call(s).`);
  if (args.includes('--update')) {
    (io.writeBaseline ?? writeBaseline)(current);
    log(`[stdout-json-gate] baseline 갱신 — ${current.size} 파일 · ${total} direct JSON console.log.`);
    return 0;
  }
  const baseline = io.loadBaseline ? io.loadBaseline() : loadBaseline(root);
  if (baseline.size === 0) {
    error(`[stdout-json-gate] FAIL — baseline이 없거나 비어 있습니다: ${relative(ROOT, BASELINE)}. --update로 현재 부채를 명시적으로 스냅샷하십시오.`);
    return 1;
  }
  const violations = [...current.entries()].filter(([file, count]) => count > (baseline.get(file) ?? 0));
  const ratcheted = [...baseline.entries()].filter(([file, allowed]) => (current.get(file) ?? 0) < allowed);
  if (violations.length > 0) {
    error('[stdout-json-gate] FAIL — 신규 direct JSON console.log 감지. writeStdoutJson from src/cli/stdout-json.ts 를 사용하십시오.');
    for (const [file, count] of violations) error(`  ${file}: ${baseline.get(file) ?? 0} → ${count}`);
    return 1;
  }
  log(`[stdout-json-gate] PASS — 신규 direct JSON console.log 없음 (baseline ${total} 유지${ratcheted.length ? ' · 부채 감소→--update 권장' : ''}).`);
  return 0;
}

if (import.meta.main) process.exit(runStdoutJsonGate());
