import { describe, expect, test } from 'bun:test';
import {
  COMMAND_LIST_DRIFT_WARNING,
  commandListDrift,
  parseDocumentedCommandNames,
  renderReference,
  runGenDocsCliReference,
  SECTIONS,
  type CommandRow,
} from './gen-docs-cli-reference.js';

function storedDocument(names: readonly string[], rest: readonly string[] = []): string {
  const rows = names.map((name) => `| \`monad ${name}\` | — | desc |`).join('\n');
  const leftover = rest.map((name) => `- \`monad ${name}\` — leftover`).join('\n');
  return `# CLI 레퍼런스\n\n| 명령 | 하위 | 무엇을 하나 |\n|---|---:|---|\n${rows}\n${leftover ? `\n## 아직 절에 못 넣은 것\n${leftover}\n` : ''}`;
}

function helpFor(names: readonly string[]): string {
  const rows = names.map((name) => `  ${name}  description of ${name}`).join('\n');
  return `Usage: monad [options] [command]\n\nCommands:\n${rows}\n  help  display help\n`;
}

describe('commandListDrift', () => {
  test('equal name sets produce empty stored-only and live-only lists', () => {
    const names = ['chat', 'dev', 'logs'];
    expect(commandListDrift(names, storedDocument(names))).toEqual({ storedOnly: [], liveOnly: [] });
  });

  test('names present only in the stored document are returned as strings', () => {
    const result = commandListDrift(['chat', 'dev'], storedDocument(['chat', 'gone', 'dev']));
    expect(result.storedOnly).toContain('gone');
    expect(result.storedOnly).toEqual(['gone']);
    expect(result.liveOnly).toEqual([]);
  });

  test('names present only in the live command set are returned as strings', () => {
    const result = commandListDrift(['chat', 'newcmd', 'dev'], storedDocument(['chat', 'dev']));
    expect(result.liveOnly).toContain('newcmd');
    expect(result.liveOnly).toEqual(['newcmd']);
    expect(result.storedOnly).toEqual([]);
  });

  test('parses unsectioned leftover names from the stored document', () => {
    const result = commandListDrift(['chat'], storedDocument(['chat'], ['questions']));
    expect(parseDocumentedCommandNames(storedDocument(['chat'], ['questions']))).toEqual(['chat', 'questions']);
    expect(result.storedOnly).toEqual(['questions']);
  });
});

describe('renderReference', () => {
  test('emits the existing generated document format for a given row list', () => {
    const rows: CommandRow[] = [
      { name: 'harness', desc: 'dev-harness worktree 수명', subs: 18 },
      { name: 'dev', alias: 'drive', desc: 'drive alias', subs: 0 },
      { name: 'questions', desc: 'AskUserQuestion 대기', subs: 0 },
    ];
    const markdown = renderReference(rows);
    expect(markdown.startsWith('# CLI 레퍼런스\n')).toBe(true);
    expect(markdown).toContain('> ⛔ **이 문서는 «생성물»이다.** `bun scripts/gen-docs-cli-reference.ts` 가 실물 `--help` 에서 만든다.');
    expect(markdown).toContain('> 손으로 고치지 마라 — 다음 생성에서 지워진다.');
    expect(markdown).toContain('📏 최상위 **3** · 하위 **18** ⇒ 잎 명령 약 **21**');
    expect(markdown).toContain('## 하니스 — 골을 쏘고 런을 몬다');
    expect(markdown).toContain('| 명령 | 하위 | 무엇을 하나 |');
    expect(markdown).toContain('|---|---:|---|');
    expect(markdown).toContain('| `monad harness` | 18 | dev-harness worktree 수명 |');
    expect(markdown).toContain('| `monad dev` (`drive`) | — | drive alias |');
    expect(markdown).toContain('## 아직 절에 못 넣은 것');
    expect(markdown).toContain('> ⚠️ 이 목록이 비지 않으면 `SECTIONS` 가 실물보다 낡은 것이다 — 절을 늘려라.');
    expect(markdown).toContain('- `monad questions` — AskUserQuestion 대기');
    expect(SECTIONS.map((section) => section.names).flat()).toContain('harness');
    expect(SECTIONS.map((section) => section.names).flat()).not.toContain('questions');
  });
});

describe('runGenDocsCliReference --check-names', () => {
  test('on matching lists prints the description-blindness warning and exits 0 without per-command help', () => {
    const calls: string[][] = [];
    const output: string[] = [];
    const exits: number[] = [];
    const names = ['chat', 'dev'];

    runGenDocsCliReference({
      argv: ['--check-names'],
      run: (args) => {
        calls.push(args);
        return helpFor(names);
      },
      readDocument: () => storedDocument(names),
      out: { log: (line) => output.push(line) },
      setExitCode: (code) => exits.push(code),
    });

    expect(calls).toEqual([['--help']]);
    expect(output).toContain(COMMAND_LIST_DRIFT_WARNING);
    expect(output.some((line) => line.includes('설명 문면 변경은 이 검사가 못 본다'))).toBe(true);
    expect(output.some((line) => line.includes('성공이 문서 전체가 최신임을 뜻하지 않는다'))).toBe(true);
    expect(exits).toEqual([0]);
  });

  test('prints every drifted name and exits nonzero without entering subordinate-command generation', () => {
    const calls: string[][] = [];
    const output: string[] = [];
    const exits: number[] = [];

    runGenDocsCliReference({
      argv: ['--check-names'],
      run: (args) => {
        calls.push(args);
        return helpFor(['chat', 'newcmd']);
      },
      readDocument: () => storedDocument(['chat', 'gone']),
      out: { log: (line) => output.push(line) },
      setExitCode: (code) => exits.push(code),
    });

    expect(calls).toEqual([['--help']]);
    expect(calls.every((args) => args.length === 1 && args[0] === '--help')).toBe(true);
    expect(output).toContain('stored-only: gone');
    expect(output).toContain('live-only: newcmd');
    expect(exits).toEqual([1]);
  });

  test('no-argument generation still writes a reference and never takes the check-names path', () => {
    const calls: string[][] = [];
    const chunks: string[] = [];
    const names = ['harness', 'questions'];

    runGenDocsCliReference({
      argv: [],
      run: (args) => {
        calls.push(args);
        if (args.length === 1 && args[0] === '--help') return helpFor(names);
        if (args[0] === 'harness' && args[1] === '--help') return 'Usage: harness\n\nCommands:\n  add  add a worktree\n';
        if (args[0] === 'questions' && args[1] === '--help') return 'Usage: questions\n';
        throw new Error(`unexpected help probe: ${args.join(' ')}`);
      },
      stdout: { write: (chunk) => chunks.push(chunk) },
      out: { log: () => { throw new Error('check-names output must not run'); } },
      setExitCode: () => { throw new Error('generation must not set an exit code'); },
    });

    expect(calls[0]).toEqual(['--help']);
    expect(calls).toContainEqual(['harness', '--help']);
    expect(calls).toContainEqual(['questions', '--help']);
    const markdown = chunks.join('');
    expect(markdown.startsWith('# CLI 레퍼런스\n')).toBe(true);
    expect(markdown).toContain('| `monad harness` | 1 | description of harness |');
    expect(markdown).toContain('- `monad questions` — description of questions');
  });
});
