import { describe, expect, test } from 'bun:test';
import { checkCommands, extractElanousCommands, type HelpRunner } from './docs-cli-check.js';

const help: HelpRunner = (args) => {
  const key = args.join(' ');
  if (key === '') return { ok: true, out: 'Usage: elanous\n\nCommands:\n  doctor [options]   check\n  harness            run goals\n  self-update        update\n' };
  if (key === 'doctor') return { ok: true, out: 'Usage: elanous doctor [options]\n\nOptions:\n  --fix   repair\n  --yes   no prompt\n  --sudo  allow sudo\n' };
  if (key === 'harness') return { ok: true, out: 'Usage: elanous harness\n\nCommands:\n  say <text>   one line\n  ask <file>   goal file\n' };
  if (key === 'harness say') return { ok: true, out: 'Usage: elanous harness say [options] <text>\n\nOptions:\n  --dry-run  plan only\n' };
  return { ok: false, out: '' };
};

describe('docs-cli-check — 문서의 elanous 호출을 실제 CLI 에 대조', () => {
  test('코드 블록·인라인 코드에서 뽑는다 · 자리표와 주석은 인자로 본다 · && 로 이어진 두 호출을 둘로', () => {
    const md = ['Run `elanous doctor --fix --yes`.', '```bash', 'elanous harness say "add a flag"   # one line', 'elanous --version && elanous doctor', '```', 'elanous outside a fence is prose'].join('\n');
    const refs = extractElanousCommands('x.md', md);
    expect(refs.map((r) => [r.cmd, r.sub ?? null, r.flags])).toEqual([
      ['doctor', null, ['--fix', '--yes']],
      ['harness', 'say', []],
      ['doctor', null, []],
    ]);
  });

  test('없는 명령·하위 명령·플래그를 이름으로 댄다(양성) · 있는 것은 통과(음성)', () => {
    const md = ['```', 'elanous doctor --fix --yes --sudo', 'elanous harness say --dry-run "x"', 'elanous nosuch run', 'elanous harness tell "x"', 'elanous doctor --nope', '```'].join('\n');
    const f = checkCommands(extractElanousCommands('x.md', md), help);
    expect(f.map((x) => [x.kind, x.detail])).toEqual([
      ['unknown-command', 'elanous nosuch'],
      ['unknown-subcommand', 'elanous harness tell'],
      ['unknown-flag', '--nope (elanous doctor)'],
    ]);
  });

  test('--help 가 실패하면 «없다»가 아니라 «못 쟀다»', () => {
    const down: HelpRunner = () => ({ ok: false, out: '' });
    expect(checkCommands(extractElanousCommands('x.md', '`elanous doctor`'), down).map((x) => x.kind)).toEqual(['unmeasured']);
  });
});

// 09-26: 도움말은 별칭을 `self-update|update [options]` 로 찍는다 — 문서의 `elanous update` 를 «없는 명령»으로 잡았다.
describe('docs-cli-check — 별칭도 명령이다', () => {
  test('primary|alias 줄에서 별칭으로 쓴 호출이 어긋남이 아니다', () => {
    const help: HelpRunner = (args) => args.length === 0
      ? { ok: true, out: 'Usage: elanous\n\nCommands:\n  self-update|update [options]  갱신\n  doctor [options]  진단\n' }
      : { ok: true, out: `Usage: elanous ${args[0]}\n\nOptions:\n  --auto <x>\n  -h, --help\n` };
    const f = checkCommands(extractElanousCommands('x.md', '`elanous update --auto on` · `elanous self-update` · `elanous updat`'), help);
    expect(f.filter((x) => x.kind === 'unknown-command').map((x) => x.detail)).toEqual(['elanous updat']);
  });
});
