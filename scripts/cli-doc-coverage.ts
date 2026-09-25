#!/usr/bin/env bun
/** Recent CLI additions whose live command path has no mention in prescription docs. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { program } from '../src/index.js';
import { debug } from '../src/debug/log.js';

type CommandLike = { name(): string; commands?: readonly CommandLike[] };
type CoverageCandidate = { path: string; source: string; mentions: number; proseMentions: number };
type CliDocCoverage = { since: string; inventory: number; addedCallLines: number; strictCalls: number; chainCalls: number; unresolvedCalls: number; recent: number; undocumented: number; proseOnly: number; candidates: CoverageCandidate[] };
/** `receiver` 가 «없는» 항목은 ***체인 계속 줄***이다 — `  .command('run')` 만 추가되고 수신자 줄은
 *  이번 창에 안 바뀐 경우. 그 자체로는 부모를 모르므로 «파일 안에서 이름이 유일할 때만» 잇는다. */
type AddedCommand = { source: string; receiver?: string; name: string };
type Registration = { receiver: string; name: string; path: string; line: number };
type CoverageOptions = {
  since?: string;
  inventory?: readonly string[];
  patch?: string;
  corpus?: string;
  root?: string;
  readSource?: (source: string) => string | undefined;
  runGit?: (since: string) => string;
};

const REPO_ROOT = join(import.meta.dir, '..');
const DOC_ROOTS = ['.rules', 'docs/manual'] as const;
const DOC_FILES = ['CLAUDE.md', 'AGENTS.md'] as const;
const COMMAND_CALL = /\b([A-Za-z_$][\w$]*)\s*\.\s*command\s*\(\s*(['"])([^'"]+)\2/g;
/** ⭐⭐ **느슨한 자 — «분모»다.** `COMMAND_CALL` 은 `<수신자>.command(` 형태만 문다. 이것은 그보다 넓게
 *  «어떤 형태로든» 명령을 등록하려 든 추가 줄을 센다(체인 계속 줄 `  .command('x')` · `.addCommand(` 포함).
 *  ⛔ 둘의 «차이»가 곧 ***「내 엄격한 파서가 못 읽은 등록」***이다. 같은 파서로 센 수는 분모가 될 수 없다
 *  (무인 리뷰 4R 지적 — 내 직전 주석이 그 점에서 «과장»이었다). */
const ANY_COMMAND_REGISTRATION = /\.\s*(?:command|addCommand)\s*\(/g;
/** 수신자 없이 «줄 맨 앞»에서 시작하는 체인 계속 호출 — `  .command('run')`. */
const CHAIN_CONTINUATION = /(?:^|\n)\s*\.\s*command\s*\(\s*(['"])([^'"]+)\1/g;
const DECLARATION = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\.\s*command\s*\(\s*(['"])([^'"]+)\3/g;

function commandName(raw: string): string { return raw.trim().split(/\s+/)[0]!; }
function lineAt(text: string, index: number): number { return text.slice(0, index).split('\n').length; }

/** The live Commander object, not source text, is the authoritative command inventory. */
function commandPaths(root: CommandLike): string[] {
  const paths: string[] = [];
  const walk = (command: CommandLike, parent: string[]): void => {
    for (const child of command.commands ?? []) {
      const path = [...parent, child.name()];
      paths.push(path.join(' '));
      walk(child, path);
    }
  };
  walk(root, []);
  return paths.sort((a, b) => a.localeCompare(b));
}

function walkMarkdown(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkMarkdown(full, files);
    else if (entry.endsWith('.md')) files.push(full);
  }
  return files;
}

function documentationCorpus(root: string): string {
  const files = DOC_ROOTS.flatMap((dir) => walkMarkdown(join(root, dir)));
  for (const file of DOC_FILES) if (existsSync(join(root, file))) files.push(join(root, file));
  // ⛔⭐ **파일을 «공백»으로 이으면 안 된다**(무인 리뷰 8R) — 낱말 사이를 `\\s+` 로 매치하므로
  //   A 파일 끝의 `pty` 와 B 파일 첫 줄의 `find` 가 «한 명령»으로 우연히 완성될 수 있다.
  //   ⇒ 비공백 구분자를 끼워 경계에서 매치가 «끊기게» 한다.
  return files.map((file) => readFileSync(file, 'utf8')).join('\n\u0000\n');
}

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
/** ⛔⭐⭐⭐ **「호출로 쓰인 것」만 센다** — 맨 경로를 세면 산문이 언급으로 «오인»된다(무인 리뷰 5R).
 *  📏 이 저장소의 문서는 명령을 «부르는 형태»로 적는다 — `monad <경로>` 또는 `bun bin/monad.mjs <경로>`.
 *  그것이 `CLAUDE.md` 의 「밟지 마라」가 못 박은 규율이기도 하다(자를 «부르는 이름»으로 적지 마라).
 *  ⇒ 접두를 요구하면 「publish file」·「session export」 같은 «일상 낱말 조합»이 언급으로 세어지지 않는다.
 *  ⚠️ 대가: 접두 없이 적힌 «진짜» 언급은 0 으로 센다. 그쪽 오차는 ***과소가 아니라 과대 보고***라
 *  (결손이 «더» 많이 뜬다) 관측으로서 안전한 방향이고, 후보 목록을 열면 사람이 바로 가른다. */
const INVOCATION_PREFIX = '(?<![\\w-])(?:(?:bun\\s+)?(?:\\./)?(?:bin/)?monad(?:\\.mjs)?)\\s+';
function countCommandMentions(corpus: string, path: string): { invocations: number; prose: number } {
  const body = `${path.split(' ').map(escapeRegex).join('\\s+')}(?![\\w-])`;
  const invocations = [...corpus.matchAll(new RegExp(`${INVOCATION_PREFIX}${body}`, 'g'))].length;
  // ⭐⭐ **「호출로 안 쓰였다」와 「아예 안 나온다」를 «다른 값»으로.** 무인 리뷰 6R 이 옳았다 —
  //   접두만 요구하면 `⛔ \`pr land\` 를 쓸 땐 셋을 안다` 처럼 «분명히 가리키는» 문장이 0 으로 접힌다.
  //   ⇒ 결손 후보는 «둘 다 0» 일 때만이고, 「산문으로만 나온다」는 그 자체로 하나의 관측이다.
  const prose = [...corpus.matchAll(new RegExp(`(?<![\\w-])${body}`, 'g'))].length;
  return { invocations, prose };
}

/** Parse the one `git log -U0 --text` output, retaining each added command call and the file it landed in.
 *
 *  ⛔⭐ **줄 번호는 «싣지 않는다»** — 종전 판은 각 추가 줄의 「그 커밋 당시」 줄 번호를 함께 실었고,
 *  연관 판정이 그것을 «현재» 줄과 비교했다. 그 사이 위쪽을 한 줄만 고쳐도 어긋나
 *  21일 창의 `recent` 가 **1** 로 주저앉았다(2026-08-09 실측 · 제거 후 **73**).
 *  ⇒ 읽는 곳이 없어진 값을 «타입에 남겨 두면» 다음 사람이 그것을 계약으로 읽는다. 그래서 지운다.
 */
function addedCommandsFromPatch(patch: string): { added: AddedCommand[]; addedCallLines: number } {
  const added: AddedCommand[] = [];
  let addedCallLines = 0;
  let source: string | undefined;
  let inHunk = false;
  const addedLines: string[] = [];
  const flush = (): void => {
    const text = addedLines.join('\n');
    COMMAND_CALL.lastIndex = 0;
    // ⛔⭐ **두 자가 «같은 호출»을 겹쳐 셀 수 있다** — 둘 다 「닫는 따옴표 «직후»」에서 끝나므로
    //   그 끝 오프셋을 열쇠로 중복을 지운다. 안 지우면 `parsedCalls` 가 분모 `addedCallLines` 를
    //   «넘어서» 간극이 음수가 된다(실측으로 그렇게 됐다 — 202 > 140).
    const seenEnd = new Set<number>();
    for (let match; (match = COMMAND_CALL.exec(text));) {
      seenEnd.add(match.index + match[0].length);
      if (source) added.push({ source, receiver: match[1]!, name: commandName(match[3]!) });
    }
    // ⭐⭐ 수신자 줄이 «안 바뀐» 체인도 후보로 올린다(무인 리뷰 5R must-fix). 부모는 모르는 채로 올리고,
    //   잇는 판단은 `recentCommandPaths` 가 «파일 안 유일성»으로 한다 — 모호하면 «안 잇는다».
    CHAIN_CONTINUATION.lastIndex = 0;
    for (let match; (match = CHAIN_CONTINUATION.exec(text));) {
      if (seenEnd.has(match.index + match[0].length)) continue;
      if (source) added.push({ source, name: commandName(match[2]!) });
    }
    addedLines.length = 0;
  };
  for (const line of patch.split('\n')) {
    // ⛔⭐⭐ **모든 파일 헤더에서 `source` 를 «먼저 지운다»** (무인 리뷰 3R must-fix · 실버그).
    //   종전엔 `src/**.ts` 에만 매치해서, 다음 파일이 `내부 문서 `x`` 면 `source` 가 «직전 TS 파일»로
    //   남았고 그 문서의 추가 줄이 그 파일에 «귀속»됐다. `git log` 산출은 한 커밋에 여러 파일을 싣는다.
    //   ⇒ 「못 읽었다」가 「남의 것으로 읽었다」가 되는 자리라, 침묵보다 나쁘다.
    if (line.startsWith('+++ ')) {
      flush();
      inHunk = false;
      source = /^\+\+\+ b\/(src\/[^\s]+\.ts)$/.exec(line)?.[1];
      continue;
    }
    if (/^@@ -[^+]+\+\d+/.test(line)) { flush(); inHunk = true; continue; }
    if (!source || !inHunk) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      const body = line.slice(1);
      ANY_COMMAND_REGISTRATION.lastIndex = 0;
      addedCallLines += [...body.matchAll(ANY_COMMAND_REGISTRATION)].length;
      addedLines.push(body);
    }
  }
  flush();
  return { added, addedCallLines };
}

/** Recover source-local command paths, retaining call locations to distinguish duplicate leaf names. */
function registrationsInSource(text: string): Registration[] {
  const paths = new Map<string, string[]>([['program', []]]);
  const registrations: Registration[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    DECLARATION.lastIndex = 0;
    for (let match; (match = DECLARATION.exec(text));) {
      const [, variable, receiver, , raw] = match;
      const parent = paths.get(receiver!);
      if (!parent || paths.has(variable!)) continue;
      const path = [...parent, commandName(raw!)];
      paths.set(variable!, path);
      registrations.push({ receiver: receiver!, name: path.at(-1)!, path: path.join(' '), line: lineAt(text, match.index) });
      changed = true;
    }
  }
  COMMAND_CALL.lastIndex = 0;
  for (let match; (match = COMMAND_CALL.exec(text));) {
    const [, receiver, , raw] = match;
    const parent = paths.get(receiver!);
    if (!parent) continue;
    const path = [...parent, commandName(raw!)].join(' ');
    const line = lineAt(text, match.index);
    if (!registrations.some((item) => item.receiver === receiver && item.path === path && item.line === line)) {
      registrations.push({ receiver: receiver!, name: commandName(raw!), path, line });
    }
  }
  return registrations;
}

function leafPaths(paths: Iterable<string>): Set<string> {
  const all = [...paths];
  return new Set(all.filter((path) => !all.some((other) => other.startsWith(`${path} `))));
}

/** Match added call locations to current source-local complete paths, then to the live Commander inventory. */
function recentCommandPaths(inventory: readonly string[], added: readonly AddedCommand[], readSource: (source: string) => string | undefined): { recent: Map<string, string>; unresolved: number } {
  const recent = new Map<string, string>();
  let unresolved = 0;
  const bySource = new Map<string, AddedCommand[]>();
  for (const item of added) bySource.set(item.source, [...(bySource.get(item.source) ?? []), item]);
  const liveLeaves = leafPaths(inventory);
  for (const [source, additions] of bySource) {
    const text = readSource(source);
    if (text === undefined) continue;
    const registrations = registrationsInSource(text);
    const sourceLeaves = leafPaths(registrations.map((item) => item.path));
    for (const addition of additions) {
      // ⛔⭐⭐ **줄 번호로 맞추지 «않는다»** — `addition.line` 은 «그 커밋 당시»의 줄이고
      //   `registration.line` 은 «지금»의 줄이다. 그 사이 위쪽을 한 줄만 고쳐도 어긋난다.
      //   📏 실측(2026-08-09): 줄 일치를 요구하니 21일 창에서 `recent` 가 «1» 이었고 —
      //   ***관측이 「거의 항상 0」이 되어 «퇴화»했다***(판정이 다른 답을 낼 수 없는 죽은 칸).
      //   ⭐ 정밀도 요구는 «파일 안 줄 위치»가 아니라 ***「잎 이름이 어느 부모의 것인가」***였다.
      //   그것은 `receiver`(등록 변수)가 이미 가른다 — `pty.command('list')` 와 `nexus.command('list')`.
      //   ⇒ 같은 파일 · 같은 receiver · 같은 이름이면 그 등록이다. 줄은 안 본다.
      const named = registrations.filter((item) => item.name === addition.name
        && sourceLeaves.has(item.path) && liveLeaves.has(item.path));
      if (addition.receiver === undefined) {
        // ⛔⭐ **체인 계속 줄은 「유일할 때만」 잇는다** — 같은 이름이 그 파일에 둘 이상이면 부모를 «모른다».
        //   ⇒ 그럴 땐 «찍지 않는다». 틀린 부모에 귀속하는 것이 안 잇는 것보다 나쁘고, 그 미해결 수는
        //   `addedCallLines − parsedCalls` 간극이 이미 «값»으로 들고 있다.
        if (named.length === 1) recent.set(named[0]!.path, source);
        else unresolved++;   // ⭐ 「못 이었다」를 «0 이 아니라» 이 수로 남긴다
        continue;
      }
      for (const registration of named) {
        if (registration.receiver === addition.receiver) recent.set(registration.path, source);
      }
    }
  }
  return { recent: new Map([...recent.entries()].sort(([a], [b]) => a.localeCompare(b))), unresolved };
}

export function collectCliDocCoverage(options: CoverageOptions = {}): CliDocCoverage {
  const since = options.since ?? '21 days ago';
  const root = options.root ?? REPO_ROOT;
  const inventory = [...(options.inventory ?? commandPaths(program))];
  // ⛔⭐ `maxBuffer` 는 «필수»다 — 기본 1MB 이고 이 저장소의 21일 창 패치는 그것을 넘는다.
  //   안 주면 `execFileSync` 가 **`ENOBUFS`** 로 던지고, 그 실패가 「관측 0건」이 아니라
  //   ***스크립트 자체의 `exit 1`*** 로 나타난다(2026-08-09 실측 — 하니스 런 둘이 여기서 죽었다).
  //   ⇒ 「관측이 아무것도 못 찾았다」와 「관측이 «돌지도 못했다»」를 다른 값으로 두려면 이 줄이 필요하다.
  const patch = options.patch ?? (options.runGit ?? ((window) => execFileSync('git', ['log', `--since=${window}`, '-U0', '--text', '--', 'src'], { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 } as const)))(since); // git-spawn-allow: 최근 CLI 등록 관측의 주입 가능한 git log 입력이다.
  const readSource = options.readSource ?? ((source) => { try { return readFileSync(join(root, source), 'utf8'); } catch { return undefined; } });
  // ⭐⭐⭐ **세 수를 «다른 자»로 낸다** — 간극마다 뜻이 다르다(무인 리뷰 4R 로 «고쳐 쓴» 문면).
  //     addedCallLines  느슨한 자로 센 「등록하려 든 추가 줄」   ← ***분모***
  //     recent          그중 «살아 있는 명령 경로»로 이어붙인 수
  //     strictCalls     엄격한 자(`<수신자>.command(`)가 읽은 수
  //     chainCalls      수신자 없는 «체인 계속» 줄로 읽은 수
  //     unresolvedCalls 읽었지만 «부모가 모호»해 «일부러 안 이은» 수
  //   ⇒ `addedCallLines − (strictCalls + chainCalls)` = ***느슨한 자는 봤는데 «어느 자로도 못 읽은» 등록***
  //     ⛔ 그 «원인»은 여기서 주장하지 않는다 — 안 쟀다. (📏 오늘 `.addCommand(` 추가 줄은 «0» 이므로
  //     적어도 그것은 «아니다». 원인이 알고 싶으면 후보 파일을 열어야 한다.)
  //   ⇒ `unresolvedCalls`              = 읽었지만 부모가 둘 이상이라 «찍지 않은» 것
  //     (틀린 부모에 귀속하는 것이 안 잇는 것보다 나쁘다 — 그래서 «세고» 넘어간다)
  //   ⇒ `strictCalls + chainCalls − recent` = 위 ⊕ 삭제·리네임·비활성으로 살아 있는 경로가 없는 것
  //   ⛔ 직전 판은 이 자리를 «같은 파서»의 성공 건수로 세어 놓고 「파서가 못 읽는 것의 분모」라 적었다.
  //     ***같은 자로 센 수는 그 자의 사각을 못 잰다*** — 그 문장이 이 파일에서 가장 위험한 과장이었다.
  const { added, addedCallLines } = addedCommandsFromPatch(patch);
  // ⛔⭐⭐ **정의와 구현을 맞춘다**(무인 리뷰 7R must-fix · 내 잘못) — 직전 판은 `parsedCalls` 를
  //   「엄격한 파서의 성공 수」라 «설명»해 놓고 실제로는 체인 계속 항목까지 더한 `added.length` 였다.
  //   ⇒ 그러면 `addedCallLines − parsedCalls` 가 「엄격한 자가 못 읽은 수」를 «안 가리킨다». 갈라 센다.
  const strictCalls = added.filter((item) => item.receiver !== undefined).length;
  const chainCalls = added.length - strictCalls;
  const { recent, unresolved } = recentCommandPaths(inventory, added, readSource);
  const corpus = options.corpus ?? documentationCorpus(root);
  const scored = [...recent.entries()].map(([path, source]) => {
    const counted = countCommandMentions(corpus, path);
    return { path, source, mentions: counted.invocations, proseMentions: counted.prose };
  });
  const candidates = scored.filter((candidate) => candidate.mentions === 0 && candidate.proseMentions === 0)
    .sort((a, b) => a.path.localeCompare(b.path));
  // ⭐ 「호출로는 한 번도 안 쓰였지만 산문으로는 나온다」 — 결손은 아니지만 «다른 상태»라 세어 둔다.
  const proseOnly = scored.filter((candidate) => candidate.mentions === 0 && candidate.proseMentions > 0).length;
  return { since, inventory: inventory.length, addedCallLines, strictCalls, chainCalls, unresolvedCalls: unresolved, recent: recent.size, undocumented: candidates.length, proseOnly, candidates };
}

function argumentValue(name: string): string | undefined {
  const value = process.argv.find((argument) => argument.startsWith(`${name}=`));
  return value?.slice(name.length + 1);
}

/** ⛔⭐ **모르는 인자를 «조용히 삼키지» 않는다** (`MANUAL-goal-authoring-method` §2b ⑴).
 *  종전 판은 `--json` 을 «받고 무시»했다 — 산출이 항상 JSON 이라 «맞는 것처럼 보였고»,
 *  그래서 오타(`--sinse=…`)도 조용히 기본값으로 돌았다. 거부할 땐 «이름을 대고», 있는 값을 같이 알려 준다. */
const KNOWN_FLAGS = ['--json', '--since'] as const;
function rejectUnknownArguments(argv: readonly string[]): string | undefined {
  for (const argument of argv) {
    const [name, ...rest] = argument.split('=');
    if (!KNOWN_FLAGS.includes(name as (typeof KNOWN_FLAGS)[number])) {
      return `알 수 없는 인자: ${name} — 쓸 수 있는 것은 ${KNOWN_FLAGS.join(' · ')} 뿐이다 (예: --since='30 days ago').`;
    }
    // ⛔⭐ **모양까지 문다** (리뷰 3R should-fix) — 종전엔 이름만 봐서 `--since`(값 없음)가 «조용히»
    //   기본값으로 돌고 `--json=아무거나`가 통과했다. ***이름만 맞으면 통과하는 검사는 오타를 못 잡는다.***
    if (name === '--since' && (rest.length === 0 || rest.join('=').trim() === '')) {
      return '--since 는 값이 필요하다 — --since=<git 시간 표현> 형태로 준다 (예: --since=\'30 days ago\').';
    }
    if (name === '--json' && rest.length > 0) return '--json 은 값을 받지 않는다 — 그냥 --json 으로 준다.';
  }
  return undefined;
}

if (import.meta.main) {
  // ⛔⭐⭐ **관측 sink 를 «먼저» 건다** — `debug.log` 만으로는 `logs.db` 에 «안 닿는다».
  //   📏 실측(2026-08-09): 이 줄이 없을 때 `monad logs --category cli.doc-coverage` 가 «0건»이었다.
  //   ⇒ 「관측을 남겼다」와 「관측이 도착했다」는 다른 축이다(`#6701` · `I-T8` · `pr-cli.ts` 선례).
  //   fail-open — 관측 배선 실패가 «측정 자체»를 막지 않는다.
  try {
    const { registerStandaloneLogSink } = await import('../src/domains/standalone-log-sink.js');
    await registerStandaloneLogSink('cli-doc-coverage');
  } catch { /* fail-open */ }
  const rejection = rejectUnknownArguments(process.argv.slice(2));
  if (rejection) {
    process.stderr.write(`${rejection}\n`);
    process.exit(2);
  }
  try {
    const result = collectCliDocCoverage({ since: argumentValue('--since') });
    debug.log('cli.doc-coverage', 'measured', result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    debug.log('cli.doc-coverage', 'failed', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
