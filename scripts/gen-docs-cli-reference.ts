// monad 의 «실물» 명령 표면에서 CLI 레퍼런스를 생성한다.
// ⛔ 문면을 손으로 적지 않는다 — `monad <cmd> --help` 가 내는 것만 싣는다.
// 사용: bun scripts/gen-docs-cli-reference.ts > 내부 문서 `cli-reference`
// 목록만 대조: bun scripts/gen-docs-cli-reference.ts --check-names
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type CommandRow = { name: string; alias?: string; desc: string; subs: number };

export const SECTIONS: { title: string; hint: string; names: string[] }[] = [
  { title: '하니스 — 골을 쏘고 런을 몬다', hint: '이 저장소의 척추다.', names: ['harness', 'dev', 'self', 'pr', 'repo'] },
  { title: 'PTY 컨트롤 — 남의 화면을 밖에서 읽고 쓴다', hint: 'monad 고유 축.', names: ['pty', 'agent-mission', 'acp', 'attach', 'browser'] },
  { title: '관측 — 관측 · 자기인지 · 셀프힐링', hint: '제1원칙이 사는 자리.', names: ['logs', 'ops', 'signals', 'loops', 'fleet', 'where', 'status', 'history', 'inspect'] },
  { title: '대화 · 세션', hint: '', names: ['chat', 'ask', 'agent', 'repl', 'session', 'memory', 'docs'] },
  { title: '프로바이더 · 모델', hint: '', names: ['provider', 'provider:set', 'provider:use', 'provider:rotate', 'provider:restore', 'tier', 'registry', 'local', 'model-watch', 'usage', 'login', 'token'] },
  { title: '자동화 — 워크플로 · 스케줄 · 오토파일럿', hint: '', names: ['wf', 'schedule', 'autopilot', 'scheduler', 'task'] },
  { title: '설치 · 진단 · 설정', hint: '', names: ['setup', 'doctor', 'onboarding', 'config', 'keys', 'leader', 'sync', 'theme', 'status-bar'] },
  { title: '표면 — NEXUS · MCP · 채널', hint: '', names: ['nexus', 'mcp', 'telegram-test', 'discord-test', 'voice', 'publish'] },
  { title: '판정 · 도메인', hint: '이 회사 전용에 가깝다 — 공개 배포에서 갈릴 축.', names: ['decide', 'decide-recipe', 'ax-screen', 'finance', 'ad', 'buzz', 'factcheck', 'measure-fabric-arc-ab'] },
  { title: '게이트웨이를 통과하는 git · gh', hint: '락 재시도와 파이프 가시 종료코드를 붙인다.', names: ['git', 'gh'] },
];

export function readCommandTable(run: (args: string[]) => string = defaultRun): CommandRow[] {
  const body = run(['--help']).split('Commands:')[1] ?? '';
  const rows: CommandRow[] = [];
  let cur: CommandRow | undefined;
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    const m = /^ {2}(\S+)(?:\s+\[[^\]]*\]|\s+<[^>]*>)*\s{2,}(.*)$/.exec(line.trimEnd());
    if (m) {
      if (cur) rows.push(cur);
      const [name, alias] = m[1]!.split('|');
      cur = { name: name!, ...(alias ? { alias } : {}), desc: m[2]!.trim(), subs: 0 };
    } else if (cur && line.startsWith('    ')) {
      cur.desc += ` ${line.trim()}`;
    }
  }
  if (cur) rows.push(cur);
  return rows.filter((r) => r.name !== 'help');
}

export function countSubcommands(name: string, run: (args: string[]) => string = defaultRun): number {
  const body = run([name, '--help']).split('Commands:')[1] ?? '';
  return body.split('\n').filter((l) => /^ {2,}\S/.test(l)).length;
}

function defaultRun(args: string[]): string {
  const r = spawnSync('bun', ['bin/monad.mjs', ...args], { encoding: 'utf8', timeout: 90_000 });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

export type CommandListDrift = { storedOnly: string[]; liveOnly: string[] };

export type GenDocsCliOptions = {
  argv?: readonly string[];
  run?: (args: string[]) => string;
  readDocument?: () => string;
  stdout?: { write: (chunk: string) => void };
  out?: { log: (line: string) => void };
  setExitCode?: (code: number) => void;
};

export const COMMAND_LIST_DRIFT_WARNING =
  '설명 문면 변경은 이 검사가 못 본다 — 목록만 대조한다. 성공이 문서 전체가 최신임을 뜻하지 않는다.';

const STORED_REFERENCE = join(import.meta.dir, '..', 'docs/site/cli-reference.md');

function sortedUnique(names: Iterable<string>): string[] {
  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

/** Documented top-level names from generated table rows and the unsectioned rest list. */
export function parseDocumentedCommandNames(markdown: string): string[] {
  const names: string[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const table = /^\| `monad ([^`]+)`/.exec(line);
    if (table) {
      names.push(table[1]!);
      continue;
    }
    const rest = /^- `monad ([^`]+)`/.exec(line);
    if (rest) names.push(rest[1]!);
  }
  return sortedUnique(names);
}

/** Pure list drift: injected live names ⊕ stored markdown. No files, no processes. */
export function commandListDrift(liveNames: readonly string[], storedDocument: string): CommandListDrift {
  const live = new Set(liveNames);
  const stored = new Set(parseDocumentedCommandNames(storedDocument));
  return {
    storedOnly: [...stored].filter((name) => !live.has(name)).sort((left, right) => left.localeCompare(right)),
    liveOnly: [...live].filter((name) => !stored.has(name)).sort((left, right) => left.localeCompare(right)),
  };
}

export function commandListDriftCli(options: GenDocsCliOptions = {}): CommandListDrift {
  const run = options.run ?? defaultRun;
  const readDocument = options.readDocument ?? (() => readFileSync(STORED_REFERENCE, 'utf8'));
  const out = options.out ?? console;
  const setExitCode = options.setExitCode ?? ((code: number) => { process.exitCode = code; });
  const drift = commandListDrift(readCommandTable(run).map((row) => row.name), readDocument());
  for (const name of drift.storedOnly) out.log(`stored-only: ${name}`);
  for (const name of drift.liveOnly) out.log(`live-only: ${name}`);
  out.log(COMMAND_LIST_DRIFT_WARNING);
  setExitCode(drift.storedOnly.length > 0 || drift.liveOnly.length > 0 ? 1 : 0);
  return drift;
}

export function runGenDocsCliReference(options: GenDocsCliOptions = {}): void {
  const argv = options.argv ?? process.argv.slice(2);
  if (argv.includes('--check-names')) {
    commandListDriftCli(options);
    return;
  }
  const run = options.run ?? defaultRun;
  const rows = readCommandTable(run);
  for (const r of rows) r.subs = countSubcommands(r.name, run);
  (options.stdout ?? process.stdout).write(renderReference(rows));
}

export function renderReference(rows: CommandRow[]): string {
  const byName = new Map(rows.map((r) => [r.name, r]));
  const placed = new Set<string>();
  const out: string[] = [];
  const leaves = rows.reduce((n, r) => n + r.subs, 0) + rows.length;
  out.push('# CLI 레퍼런스');
  out.push('');
  out.push(`> ⛔ **이 문서는 «생성물»이다.** \`bun scripts/gen-docs-cli-reference.ts\` 가 실물 \`--help\` 에서 만든다.`);
  out.push('> 손으로 고치지 마라 — 다음 생성에서 지워진다.');
  out.push('');
  out.push(`📏 최상위 **${rows.length}** · 하위 **${rows.reduce((n, r) => n + r.subs, 0)}** ⇒ 잎 명령 약 **${leaves}**`);
  out.push('');
  for (const section of SECTIONS) {
    const picked = section.names.map((n) => byName.get(n)).filter((r): r is CommandRow => Boolean(r));
    if (picked.length === 0) continue;
    out.push(`## ${section.title}`);
    if (section.hint) out.push(`> ${section.hint}`);
    out.push('');
    out.push('| 명령 | 하위 | 무엇을 하나 |');
    out.push('|---|---:|---|');
    for (const r of picked) {
      placed.add(r.name);
      const name = r.alias ? `\`monad ${r.name}\` (\`${r.alias}\`)` : `\`monad ${r.name}\``;
      out.push(`| ${name} | ${r.subs || '—'} | ${r.desc.replace(/\|/g, '\\|').slice(0, 220)} |`);
    }
    out.push('');
  }
  const rest = rows.filter((r) => !placed.has(r.name));
  if (rest.length > 0) {
    out.push('## 아직 절에 못 넣은 것');
    out.push('> ⚠️ 이 목록이 비지 않으면 `SECTIONS` 가 실물보다 낡은 것이다 — 절을 늘려라.');
    out.push('');
    for (const r of rest) out.push(`- \`monad ${r.name}\` — ${r.desc.slice(0, 160)}`);
    out.push('');
  }
  return out.join('\n');
}

if (import.meta.main) runGenDocsCliReference();
