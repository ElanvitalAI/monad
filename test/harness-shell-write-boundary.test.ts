import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalizeForBoundary } from '../src/harness/harness-write-boundary.js';
import { dispatchBash } from '../src/skills/tools/index.js';
import { dispatchRunShell } from '../src/skills/tools/shell.js';
import { dispatchPtyShellSend, dispatchPtyShellStart } from '../src/skills/tools/pty.js';
import { dispatchGitCommit } from '../src/tool-runtime/git-commit-runtime.js';
import { resetForTesting, setPtyAdapterForTesting } from '../src/pty-shell/registry.js';
import { HARNESS_BOUNDARY_ENV, HARNESS_BOUNDARY_REQUESTS_ENV, HARNESS_SPACE_ENV } from '../src/harness/harness-space.js';
import { debug } from '../src/debug/log.js';

const ENV_KEYS = [HARNESS_SPACE_ENV, HARNESS_BOUNDARY_ENV, HARNESS_BOUNDARY_REQUESTS_ENV] as const;
let savedEnv: Partial<NodeJS.ProcessEnv> = {};
let root = '';
let boundary = '';
let outside = '';
let ptyWrites = 0;
/** ⛔ 이 파일의 한 테스트가 `debug.enable()` 을 부른다 — 복구하지 않으면 **전역 미러 상태가
 *  뒤따르는 테스트로 샌다**(무인 리뷰 should-fix). 진입 시 값을 떠서 afterEach 에 되돌린다. */
let savedDebugMirror = false;

beforeEach(() => {
  savedDebugMirror = debug.isMirrorEnabled();
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  root = mkdtempSync(join(tmpdir(), 'harness-shell-boundary-'));
  boundary = join(root, 'isolated');
  outside = join(root, 'human-tree');
  mkdirSync(boundary);
  mkdirSync(outside);
  process.env[HARNESS_SPACE_ENV] = 'self-implement';
  process.env[HARNESS_BOUNDARY_ENV] = boundary;
  ptyWrites = 0;
  setPtyAdapterForTesting(() => ({
    pid: 1,
    write() { ptyWrites++; },
    kill() {},
    onData() { return { dispose() {} }; },
    onExit() { return { dispose() {} }; },
  }));
});

afterEach(() => {
  if (savedDebugMirror) debug.enable(); else debug.disable();   // 전역 미러 상태 복구(위 주석)
  resetForTesting();
  setPtyAdapterForTesting(null);
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

describe('harness shell write boundary', () => {
  test('rejects Bash write bypasses and compound shell syntax before execution', async () => {
    const humanFile = join(outside, 'human.txt');
    const commands = [
      `echo blocked > ${humanFile}`,
      `dd of=${humanFile} if=/dev/zero count=0`,
      `sed -i s/x/y/ ${humanFile}`,
      `python3 -c "open('${humanFile}', 'w')"`,
      `/usr/bin/git -C ${outside} branch forbidden`,
      `git -C ${outside} update-ref refs/heads/forbidden HEAD`,
      `echo blocked | tee ${humanFile}`,
      `pwd; rm ${humanFile}`,
      `echo "$(python3 -c \"open('${humanFile}', 'w')\")"`,
      `find ${outside} -delete`,
      `find ${outside} -exec rm -f {} +`,
      `OUT=${humanFile}; echo blocked > "$OUT"`,
      `echo ~`,
    ];
    for (const command of commands) {
      const result = await dispatchBash({ command }, { cwd: boundary });
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('격리');
      expect(result.output).toContain(boundary);
    }
  });

  // ⛔ 회귀 고정 — 초판은 `bash`·`sh`·`zsh` 를 READ_ONLY 목록에 넣어 인터프리터 한 겹만 씌우면
  //    무엇이든 통과했다(무인 리뷰 should-fix). 판정은 인터프리터 이름이 아니라 payload 에 있다.
  test('classifies sh -c by its payload, not by the interpreter name', async () => {
    const humanFile = join(outside, 'human.txt');
    for (const command of [
      `sh -c 'echo blocked > ${humanFile}'`,
      `bash -c 'dd of=${humanFile} if=/dev/zero count=0'`,
      `zsh -c 'git -C ${outside} branch forbidden'`,
      `sh -c 'touch ${humanFile}'`,                       // 미결정 명령 → fail-closed
      `pwd\n touch ${humanFile}`,                         // ⛔ 개행도 구분자다 — 첫 명령만 보면 샌다
      // ⛔ 묶인 플래그 — `-c` 만 찾으면 `-lc` 가 "`-c` 없음"으로 읽혀 cwd 축으로 떨어진다.
      `bash -lc 'touch ${humanFile}'`,
      `sh -xc 'echo x > ${humanFile}'`,
    ]) {
      const result = await dispatchBash({ command }, { cwd: boundary });
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('격리');
    }
  });

  test('still allows a read-only payload behind an interpreter', async () => {
    const result = await dispatchBash({ command: `sh -c 'git -C ${outside} status'` }, { cwd: boundary });
    expect(result.output).not.toContain('격리 경계');
  });

  // `-c` 가 없으면 낼 명령을 못 보므로 **cwd 축**으로 판정한다 — 경계 안 셸은 살리고 밖은 막는다.
  test('judges an interpreter without -c by its cwd', async () => {
    const inside = await dispatchPtyShellStart({ cmd: 'sh', args: [], workdir: boundary, yield_time_ms: 1 });
    expect(inside.output).not.toContain('격리 경계');
    const outsideShell = await dispatchPtyShellStart({ cmd: 'sh', args: [], workdir: outside, yield_time_ms: 1 });
    expect(outsideShell.output).toContain('격리 경계');
  });

  // ⛔ 회귀 — `--git-dir` 은 refs 가 사는 곳이다. 무시하면 경계 안 cwd 로 판정돼 사람 트리 ref 를 고친다.
  test('honours --git-dir and a -C relative --work-tree as write targets', async () => {
    for (const command of [
      `git --git-dir=${outside}/.git branch forbidden`,
      `git --git-dir ${outside}/.git tag forbidden`,
      `git -C ${outside} --work-tree=. add .`,
      // ⛔ 분기마다 대상을 손으로 적으면 빠뜨린 분기가 남는다 — remote·worktree 도 같은 계산을 쓴다.
      `git --git-dir=${outside}/.git remote add origin https://example.invalid/x.git`,
      `git -C ${outside} worktree add sub`,
      // ⛔ 플래그 의미는 서브커맨드마다 다르다 — `-a` 는 branch 에서 조회, tag 에서 생성이다.
      `git -C ${outside} tag -a v1 -m note`,
      `git -C ${outside} tag -s v2`,
      // ⛔ 플래그 값이 첫 피연산자로 오는 형태 — 피연산자를 전부 경로로 봐야 걸린다.
      `git worktree add -b topic ${outside}/wt`,
      // ⛔ 「읽기 전용 명령」에도 결과를 파일로 내보내는 플래그가 있다 — 명령이 아니라 플래그로 잡는다.
      `diff --output=${outside}/out.txt a b`,
      `find . -fprint ${outside}/list.txt`,
      // ⛔ `sed -i` 는 피연산자를 여럿 받는다 — 마지막 하나만 보면 앞의 경계 밖 파일이 샌다.
      `sed -i s/x/y/ ${outside}/a.txt ${boundary}/b.txt`,
      // ⛔ 접두 실행기는 조회로 위장한다 — 벗기고 뒤의 진짜 명령으로 판정해야 한다.
      `env sed -i s/x/y/ ${outside}/a.txt ${outside}/b.txt`,
      `nice tee ${outside}/n.txt`,
      // ⛔ 조회 서브커맨드도 옵션으로 파일을 쓴다 — 서브커맨드 판정보다 먼저 걸려야 한다.
      `git diff --output=${outside}/patch.diff`,
    ]) {
      const result = await dispatchBash({ command }, { cwd: boundary });
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('격리 경계 밖 쓰기 거부');
    }
  });

  // ⛔ 회귀 — 수용 기준이 "읽기 명령은 막지 않는다" 이다. 이 저장소의 규율 자체가
  //    `git branch --show-current` 를 매 커밋 전에 부른다.
  test('does not block branch and tag query modes outside the boundary', async () => {
    for (const command of [
      `git -C ${outside} branch --show-current`,
      `git -C ${outside} branch --list`,
      `git -C ${outside} branch -a`,
      `git -C ${outside} tag -l`,
      `git -C ${outside} branch`,
      `git -C ${outside} tag --verify v1`,
      `git -C ${outside} tag -n`,
      `git -C ${outside} remote show`,
      // ⛔ 오탐 회귀 — `grep -o` 는 `--only-matching` 이지 출력 경로가 아니다.
      //    전역 플래그 집합을 쓰던 판이 이 읽기 명령을 쓰기로 오판했다.
      `grep -o pattern ${outside}/f.txt`,
      `ls -o ${outside}`,
      // ⛔ 미등록이 곧 거부면 하니스 자식이 못 돈다 — 명백한 조회는 실어야 한다.
      'wc -l /etc/hosts',
      'date',
      `git -C ${outside} ls-tree HEAD`,
      `git -C ${outside} cat-file -t HEAD`,
      // ⛔ 인용부 안의 리터럴은 셸 문법이 아니다.
      `grep 'a|b' ${outside}/f.txt`,
      "echo '~'",
    ]) {
      const result = await dispatchBash({ command }, { cwd: boundary });
      expect(result.output).not.toContain('격리 경계');
    }
  });

  test('allows read-only git -C outside the boundary but rejects mutations there', async () => {
    const read = await dispatchBash({ command: `git -C ${outside} status` }, { cwd: boundary });
    expect(read.exitCode).toBe(128);
    expect(read.output).not.toContain('격리 경계');
    const mutation = await dispatchBash({ command: `git -C ${outside} branch forbidden` }, { cwd: boundary });
    expect(mutation.exitCode).toBe(1);
    expect(mutation.output).toContain('격리 경계 밖 쓰기 거부');
  });

  test('records rejected shell writes with target, boundary, and entry point', async () => {
    debug.enable();
    debug.clear();
    const humanFile = join(outside, 'human.txt');
    const result = await dispatchBash({ command: `echo blocked > ${humanFile}` }, { cwd: boundary });
    expect(result.exitCode).toBe(1);
    const event = debug.events(10).find((candidate) => candidate.category === 'harness.boundary' && candidate.event === 'main-tree-reject');
    expect(event?.data).toMatchObject({ path: expect.any(String), boundary: canonicalizeForBoundary(boundary), via: 'bash' });
  });

  test('rejects RunShell git -C and direct file targets before execution', async () => {
    const humanFile = join(outside, 'human.txt');
    await expect(dispatchRunShell({ command: ['git', '-C', outside, 'branch', 'forbidden'], cwd: boundary }))
      .rejects.toThrow('격리 경계 밖 쓰기 거부');
    await expect(dispatchRunShell({ command: ['dd', `of=${humanFile}`, 'if=/dev/zero', 'count=0'], cwd: boundary }))
      .rejects.toThrow('격리 경계 밖 쓰기 거부');
  });

  test('rejects mutable git remote and worktree operands outside the boundary', async () => {
    const outsideWorktree = join(outside, 'new-worktree');
    await expect(dispatchRunShell({ command: ['git', '-C', outside, 'remote', 'add', 'origin', 'x'], cwd: boundary }))
      .rejects.toThrow('격리 경계 밖 쓰기 거부');
    await expect(dispatchRunShell({ command: ['git', '-C', boundary, 'worktree', 'add', outsideWorktree, 'HEAD'], cwd: boundary }))
      .rejects.toThrow('격리 경계 밖 쓰기 거부');
    expect(existsSync(outsideWorktree)).toBe(false);
  });

  test('rejects PTY start and send writes outside the isolated worktree', async () => {
    const start = await dispatchPtyShellStart({ cmd: 'git', args: ['-C', outside, 'branch', 'forbidden'], workdir: boundary, yield_time_ms: 1 });
    expect(start.output).toContain('격리 경계 밖 쓰기 거부');
    const pty = await dispatchPtyShellStart({ cmd: 'sh', args: [], workdir: boundary, yield_time_ms: 1 });
    const processId = pty.output.match(/process_id=([^\s]+)/)?.[1];
    expect(processId).toBeDefined();
    const sent = await dispatchPtyShellSend({ process_id: processId!, input: `echo blocked > ${join(outside, 'sent.txt')}\n`, yield_time_ms: 1 });
    expect(sent.output).toContain('격리');
    expect(ptyWrites).toBe(0);
    expect(existsSync(join(outside, 'sent.txt'))).toBe(false);
  });

  test('rejects structured GitCommit before the git runner executes', () => {
    let invoked = false;
    expect(() => dispatchGitCommit(
      { message: 'blocked', files: ['x.ts'] },
      { cwd: outside, runner: () => { invoked = true; return { stdout: '', stderr: '', status: 0 }; } },
    )).toThrow('격리 경계 밖 쓰기 거부');
    expect(invoked).toBe(false);
  });

  test('notifies the mailbox before an allowed Bash command runs without changing its result', async () => {
    const requestPath = join(root, 'requests.jsonl');
    process.env[HARNESS_BOUNDARY_REQUESTS_ENV] = requestPath;
    const command = 'printf allowed';
    const result = await dispatchBash({ command }, { cwd: boundary });
    const records = readFileSync(requestPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(result).toMatchObject({ exitCode: 0, output: 'allowed' });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ requestType: 'command-start', commandFirstToken: 'printf', commandChars: command.length, via: 'bash' });
    expect(JSON.stringify(records[0])).not.toContain(command);
  });

  test('allows read-only shell commands and writes inside the isolated worktree', async () => {
    const read = await dispatchBash({ command: 'pwd' }, { cwd: outside });
    const write = await dispatchBash({ command: 'echo allowed > x.txt' }, { cwd: boundary });
    expect(read.exitCode).toBe(0);
    expect(write.exitCode).toBe(0);
  });

  test('does not intervene outside a harness space', async () => {
    delete process.env[HARNESS_SPACE_ENV];
    const result = await dispatchBash({ command: 'echo allowed > x.txt' }, { cwd: outside });
    expect(result.exitCode).toBe(0);
  });

  // ⭐ 수용 기준 — 주변 격리(3층 트리 파생)는 거부 대상이 **아니다**. 이 판정은 격리 「층」이
  //    아니라 **하니스 마커**에 걸린다: 마커가 없으면 인스턴스 루트가 무엇이든 미개입이다.
  //    ⊕ 마커가 있어도 **경계를 못 구하면**(정본/standalone 부팅) 개입하지 않는다 — 정본을
  //      경계로 걸면 정본 쓰기를 축복하게 되므로(인시던트 근본 ②와 같은 형태).
  test('leaves ambient isolation and unresolved boundaries alone', async () => {
    delete process.env[HARNESS_SPACE_ENV];
    process.env[HARNESS_BOUNDARY_ENV] = boundary;   // 격리 루트만 있고 하니스 마커는 없음
    const ambient = await dispatchBash({ command: `echo allowed > ${join(outside, 'ambient.txt')}` }, { cwd: outside });
    expect(ambient.exitCode).toBe(0);

    process.env[HARNESS_SPACE_ENV] = 'self-implement';
    delete process.env[HARNESS_BOUNDARY_ENV];        // 마커는 있고 경계는 미상
    const unresolved = await dispatchBash({ command: `echo allowed > ${join(outside, 'unresolved.txt')}` }, { cwd: outside });
    expect(unresolved.exitCode).toBe(0);
  });
});
