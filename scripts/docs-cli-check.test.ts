import { describe, expect, test } from 'bun:test';
import { checkCommands, extractMonadCommands, type HelpRunner } from './docs-cli-check.js';

const help: HelpRunner = (args) => {
  const key = args.join(' ');
  if (key === '') return { ok: true, out: 'Usage: monad\n\nCommands:\n  doctor [options]   check\n  harness            run goals\n  self-update        update\n' };
  if (key === 'doctor') return { ok: true, out: 'Usage: monad doctor [options]\n\nOptions:\n  --fix   repair\n  --yes   no prompt\n  --sudo  allow sudo\n' };
  if (key === 'harness') return { ok: true, out: 'Usage: monad harness\n\nCommands:\n  say <text>   one line\n  ask <file>   goal file\n' };
  if (key === 'harness say') return { ok: true, out: 'Usage: monad harness say [options] <text>\n\nOptions:\n  --dry-run  plan only\n' };
  return { ok: false, out: '' };
};

describe('docs-cli-check — 문서의 monad 호출을 실제 CLI 에 대조', () => {
  test('코드 블록·인라인 코드에서 뽑는다 · 자리표와 주석은 인자로 본다 · && 로 이어진 두 호출을 둘로', () => {
    const md = ['Run `monad doctor --fix --yes`.', '```bash', 'monad harness say "add a flag"   # one line', 'monad --version && monad doctor', '```', 'monad outside a fence is prose'].join('\n');
    const refs = extractMonadCommands('x.md', md);
    expect(refs.map((r) => [r.cmd, r.sub ?? null, r.flags])).toEqual([
      ['doctor', null, ['--fix', '--yes']],
      ['harness', 'say', []],
      ['doctor', null, []],
    ]);
  });

  test('없는 명령·하위 명령·플래그를 이름으로 댄다(양성) · 있는 것은 통과(음성)', () => {
    const md = ['```', 'monad doctor --fix --yes --sudo', 'monad harness say --dry-run "x"', 'monad nosuch run', 'monad harness tell "x"', 'monad doctor --nope', '```'].join('\n');
    const f = checkCommands(extractMonadCommands('x.md', md), help);
    expect(f.map((x) => [x.kind, x.detail])).toEqual([
      ['unknown-command', 'monad nosuch'],
      ['unknown-subcommand', 'monad harness tell'],
      ['unknown-flag', '--nope (monad doctor)'],
    ]);
  });

  test('--help 가 실패하면 «없다»가 아니라 «못 쟀다»', () => {
    const down: HelpRunner = () => ({ ok: false, out: '' });
    expect(checkCommands(extractMonadCommands('x.md', '`monad doctor`'), down).map((x) => x.kind)).toEqual(['unmeasured']);
  });
});
