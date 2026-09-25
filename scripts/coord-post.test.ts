import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';

const script = resolve(import.meta.dir, 'coord-post.sh');

// ── 조율 채널 발신의 «신원 관문» ─────────────────────────────────────────────
//
// 🩸 계기(2026-09-02 · [S] 145차): 수신자를 신원 칸에 적어 `**[T]** 님께 …` 로 발신했다.
//   종전 검사는 `[STF]` 중 «아무거나» 통과시켜서 ***「접두가 있나」는 봤지만 「그 접두가 «나인가»」는
//   안 봤다.*** 감시자는 startswith 로 고르므로 상대는 그 글을 ***「자기가 쓴 글」로 보고 건너뛴다***
//   ⇒ 자료가 영영 안 닿는다(내 감시자에 «되울려» 와서야 잡혔다).
// ⛔ 그리고 같은 판에 둘째가 드러났다 — 마지막 줄이 `rm` 이라 ***발신 실패가 삼켜졌다***(늘 rc=0).
/** ⛔ 발신 경계(`bun bin/monad.mjs gh …`)를 PATH 스텁으로 «막는다» — 이 시험은 네트워크·자격에 기대지 않는다
 *  (같은 저장소의 `scripts/backup/monad-backup.test.ts` 가 쓰는 형태). `stubExit` 로 그 경계의 성패를 «고른다». */
async function runPost(
  body: string,
  env: Record<string, string> = {},
  stubExit = 1,
  args: string[] = [],
) {
  const dir = await mkdtemp(join(tmpdir(), 'coord-post-'));
  const file = join(dir, 'body.md');
  await writeFile(file, body);
  const bin = join(dir, 'bin');
  await mkdir(bin, { recursive: true });
  const stub = join(bin, 'bun');
  await writeFile(stub, `#!/bin/sh\necho "stub gh (exit ${stubExit})"\nexit ${stubExit}\n`);
  await chmod(stub, 0o755);
  return spawnSync('bash', [script, ...args, file], {
    encoding: 'utf8',
    env: { ...process.env, CH_PR: '99999999', PATH: `${bin}:${process.env.PATH ?? ''}`, ...env },
    cwd: resolve(import.meta.dir, '..'),
  });
}

describe('coord-post.sh — 신원 관문', () => {
  test('⛔ 남의 신원으로는 «발신하지 않는다» (rc=5)', async () => {
    const r = await runPost('**[T]** 님께 — 남의 신원\n{{TS}}\n');
    expect(r.status).toBe(5);
    expect(r.stderr).toContain('내 것이 아니다');
    expect(r.stderr).toContain('자기 글');   // ⛔ 「왜 위험한가」를 말해야 다음 사람이 안 밟는다
  });

  test('⛔ 신원 접두가 «없으면» 발신하지 않는다 (rc=5)', async () => {
    const r = await runPost('신원 없음\n{{TS}}\n');
    expect(r.status).toBe(5);
  });

  test('⛔ COORD_ID 가 S·T·F·O 가 아니면 거부한다 (rc=4)', async () => {
    const r = await runPost('**[S]** 내 신원\n{{TS}}\n', { COORD_ID: 'X' });
    expect(r.status).toBe(4);
  });

  test('✅ 내 신원이면 관문을 «통과»한다 — 다른 트랙은 COORD_ID 로 바꾼다', async () => {
    const r = await runPost('**[T]** 내 신원\n{{TS}}\n', { COORD_ID: 'T' }, 0);
    expect(r.status).toBe(0);                       // 관문을 지나 발신 경계까지 갔고 그 경계가 성공했다
    expect(r.stderr).toContain('[coord-post] 채널');  // ⛔ 이 줄이 곧 「관문을 통과했다」의 증거
    // ⛔ COORD_ID 기본이 S 다 ⇒ T·F 가 그것을 «안 주면» 남의 신원으로 나가는데, 접두가 «마침 달라야»
    //    위 관문이 잡는다. ⇒ 산출이 「누구로 보냈나」를 «항상» 말해야 그 조용한 오발신이 보인다.
    expect(r.stderr).toContain('신원 [T]');
  });

  // 🅞 = Obsidian·문서화 세션(2026-09-23 지정). 관문이 [STF] 로 닫혀 있어 «발신 자체가» 안 됐다.
  test('✅ O 트랙도 자기 신원으로 통과한다 (2026-09-23 · 🅞 신설)', async () => {
    const r = await runPost('**[O]** 내 신원\n{{TS}}\n', { COORD_ID: 'O' }, 0);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('신원 [O]');
  });

  test('✅ 트랙 정본(coord-tracks.json)의 신원은 «전부» 자기 신원으로 통과한다 — 목록을 스크립트에 박지 않는다', async () => {
    const registry = JSON.parse(await readFile(resolve(import.meta.dir, 'coord-tracks.json'), 'utf8')) as {
      tracks: { id: string }[];
    };
    expect(registry.tracks.length).toBeGreaterThan(0);
    for (const { id } of registry.tracks) {
      const r = await runPost(`**[${id}]** 내 신원\n{{TS}}\n`, { COORD_ID: id }, 0);
      expect({ id, status: r.status }).toEqual({ id, status: 0 });
      expect(r.stderr).toContain(`신원 [${id}]`);
    }
    const source = await readFile(script, 'utf8');
    expect(source).not.toMatch(/\[S?T?F?O?\]\)/);           // 옛 `[STF]) ;;` 꼴의 하드코딩 목록
    expect(source).toContain('coord-tracks.json');
  });

  test('⛔ 트랙 정본에 «없는» 신원은 거부한다 (rc=4)', async () => {
    const r = await runPost('**[Q]** 없는 트랙\n{{TS}}\n', { COORD_ID: 'Q' });
    expect(r.status).toBe(4);
    expect(r.stderr).toContain('트랙 정본');
  });

  test('⛔ O 가 남의 접두(S)로 쓰면 «발신하지 않는다» (rc=5)', async () => {
    const r = await runPost('**[S]** 님께\n{{TS}}\n', { COORD_ID: 'O' });
    expect(r.status).toBe(5);
    expect(r.stderr).toContain('내 것이 아니다');
  });

  test('⛔ 발신이 «실패하면» 그 실패가 전파된다 — 「보냈다」로 읽히지 않는다', async () => {
    const r = await runPost('**[S]** 내 신원\n{{TS}}\n', {}, 1);
    // 발신 경계가 실패한 판. ⛔ 종전엔 마지막 `rm` 이 0 을 내어 그 실패를 «삼켰다».
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('발신 실패');
  });

  test('✅ GNU와 BSD mktemp 모두가 받는 TMPDIR 템플릿 세 개를 쓴다', async () => {
    const source = await readFile(script, 'utf8');
    expect(source).not.toContain('mktemp -t');
    expect(source).toContain('mktemp "${TMPDIR:-/tmp}/coord-post.XXXXXX"');
    expect(source).toContain('mktemp "${TMPDIR:-/tmp}/coord-post-data.XXXXXX"');
    expect(source).toContain('mktemp "${TMPDIR:-/tmp}/coord-post-out.XXXXXX"');
  });

  test('✅ 발신 출력과 같은 경로의 보호 파일은 cleanup이 삭제하지 않는다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coord-post-protected-'));
    const file = join(dir, 'body.md');
    const protectedFile = join(dir, 'protected-output');
    const bin = join(dir, 'bin');
    await writeFile(file, '**[S]** 내 신원\n{{TS}}\n');
    await writeFile(protectedFile, 'preserve me');
    await mkdir(bin, { recursive: true });
    const stub = join(bin, 'bun');
    await writeFile(stub, `#!/bin/sh\nprintf '%s\\n' '${protectedFile}'\nexit 0\n`);
    await chmod(stub, 0o755);

    const r = spawnSync('bash', [script, file], {
      encoding: 'utf8',
      env: { ...process.env, CH_PR: '99999999', PATH: `${bin}:${process.env.PATH ?? ''}` },
      cwd: resolve(import.meta.dir, '..'),
    });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain(protectedFile);
    expect(await readFile(protectedFile, 'utf8')).toBe('preserve me');
  });

  test('⛔ {{TS}} 자리표시가 «치환되지 않으면» 발신하지 않는다', async () => {
    const r = await runPost('**[S]** 내 신원\n시각을 손으로 적었다\n');
    // 자리표시가 없으면 경고만 내고 진행한다(계약) — 그러나 발신 자체는 gh 에서 실패한다.
    expect(r.stderr).toContain('{{TS}}');
  });

  test('✅ 반복 가능한 --set 이 모든 해당 자리표시를 문자 그대로 치환한다', async () => {
    const literal = 'a/b&$d`cmd`$(run)\nnext';
    const r = await runPost(
      '**[S]** {{NAME}} {{NAME}}\n{{DETAIL}}\n{{TS}}\n',
      { COORD_DRY_RUN: '1' },
      1,
      ['--set', 'NAME=coord', '--set', `DETAIL=${literal}`],
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('**[S]** coord coord');
    expect(r.stdout).toContain(literal);
    expect(r.stdout).not.toContain('{{');
    expect(r.stdout).not.toContain('stub gh');
  });

  test('✅ 한 글자 KEY와 값 안의 등호를 문자 그대로 치환한다', async () => {
    const r = await runPost(
      '**[S]** {{X}}\n{{TS}}\n',
      { COORD_DRY_RUN: '1' },
      1,
      ['--set', 'X=left=right'],
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('**[S]** left=right');
  });

  test('⛔ 잘못된 --set KEY를 거부한다', async () => {
    const r = await runPost('**[S]** {{AB-}}\n{{TS}}\n', {}, 1, ['--set', 'AB-=value']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('KEY 는 영문자 또는 밑줄로 시작하고 영문자·숫자·밑줄만');
  });

  test('⛔ --set에 없는 상속 환경변수는 치환하거나 발신하지 않는다', async () => {
    const r = await runPost(
      '**[S]** {{X}} {{HOME}}\n{{TS}}\n',
      { COORD_DRY_RUN: '1', HOME: '/private/home' },
      1,
      ['--set', 'X=allowed'],
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('{{HOME}}');
    expect(r.stdout).not.toContain('/private/home');
    expect(r.stdout).not.toContain('stub gh');
  });

  test('✅ PATH와 Perl 설정 이름도 실행 환경이 아닌 리터럴 값으로 치환한다', async () => {
    const r = await runPost(
      '**[S]** {{PATH}} {{PERL5OPT}} {{PERL5LIB}}\n{{TS}}\n',
      { COORD_DRY_RUN: '1' },
      1,
      ['--set', 'PATH=/nonexistent', '--set', 'PERL5OPT=-Mstrict', '--set', 'PERL5LIB=/not/a/library'],
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('/nonexistent -Mstrict /not/a/library');
  });

  test('✅ 삽입값의 자리표시자는 후속 --set으로 재치환하지 않는다', async () => {
    for (const args of [
      ['--set', 'NAME={{OTHER}}', '--set', 'OTHER=value'],
      ['--set', 'OTHER=value', '--set', 'NAME={{OTHER}}'],
    ]) {
      const r = await runPost('**[S]** {{NAME}}\n{{TS}}\n', { COORD_DRY_RUN: '1' }, 1, args);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('{{OTHER}}');
      expect(r.stdout).not.toContain('value');
    }
  });

  test('⛔ 남은 자리표시자는 이름을 내고 발신하지 않는다', async () => {
    const r = await runPost('**[S]** {{MISSING}}\n{{TS}}\n', { COORD_DRY_RUN: '1' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('{{MISSING}}');
    expect(r.stdout).not.toContain('stub gh');
  });

  test('⛔ 여러 줄에 걸친 남은 자리표시자도 발신하지 않는다', async () => {
    const r = await runPost('**[S]** {{MISSING\nNAME}}\n{{TS}}\n', { COORD_DRY_RUN: '1' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('{{MISSING\nNAME}}');
    expect(r.stdout).not.toContain('stub gh');
  });

  test('⛔ 내부 중괄호를 가진 남은 자리표시자는 비건조 경로에서도 발신하지 않는다', async () => {
    const r = await runPost('**[S]** {{A{B}}\n{{TS}}\n', {}, 0);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('{{A{B}}');
    expect(r.stdout).not.toContain('stub gh');
    expect(r.stderr).not.toContain('발신 성공');
  });

  test('✅ --set 없이 {{TS}}만 있는 기존 본문은 건조 출력에서 자동 치환한다', async () => {
    const r = await runPost('**[S]** 기존 본문\n{{TS}}\n', { COORD_DRY_RUN: '1' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('**[S]** 기존 본문');
    expect(r.stdout).not.toContain('{{TS}}');
    expect(r.stdout).not.toContain('stub gh');
  });
});
