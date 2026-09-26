import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';

const backup = resolve(import.meta.dir, 'elanous-backup.sh');

async function runBackup(crontab: string, directories: string[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'elanous-backup-'));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  await mkdir(home, { recursive: true });
  await Promise.all(directories.map((directory) => mkdir(join(home, '.elanous', directory), { recursive: true })));
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'crontab'), crontab.startsWith('#!') ? crontab : `#!/bin/sh\nprintf '%s' '${crontab.replace(/'/g, "'\\\"'\\\"'")}'\n`);
  await writeFile(join(bin, 'gcloud'), '#!/bin/sh\necho "gcloud must not run" >&2\nexit 99\n');
  await chmod(join(bin, 'crontab'), 0o755);
  await chmod(join(bin, 'gcloud'), 0o755);

  try {
    const result = spawnSync('bash', [backup, '--dry-run'], {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        // Isolate source-tree discovery and ensure no production state is read or written.
        ELANOUS_STATE_DIR: join(root, 'state'),
      },
    });
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('elanous-backup crontab snapshot', () => {
  test('plans a local mirrors snapshot by its backup name', async () => {
    const { status, output } = await runBackup('#!/bin/sh\nexit 0\n', ['mirrors']);

    expect(status).toBe(0);
    expect(output).toContain('elanous-mirrors');
  });

  test('captures a non-empty local crontab and reconciles planned with staged', async () => {
    const { status, output } = await runBackup('# morning automation\n20 4 * * * /opt/elanous/run\n');

    expect(status).toBe(0);
    expect(output).toContain('machine-crontab');
    expect(output).toContain('crontab -l (');
    // 🔑⛔ 가짜 HOME 에는 다른 담을 것이 «없다» ⇒ 이 회차의 계획은 ***오직 crontab «하나»***다.
    //    ⛔ 「계획 == 담김」만 보면 ***빈 것을 계획·스테이징하는 잘못된 구현도 통과한다***(자기 리뷰 must-fix).
    expect(output).toContain('📋 계획 1 · 담김 1 · 실패 0');
    expect(output).toContain('[dry-run] 올리지 않았다');
  });

  test('counts an unreadable crontab as failure rather than an empty machine', async () => {
    const { status, output } = await runBackup('#!/bin/sh\necho denied >&2\nexit 1\n');

    expect(status).not.toBe(0);
    expect(output).toContain('crontab -l 실패: denied');
    expect(output).toMatch(/📋 계획 \d+ · 담김 \d+ · 실패 [1-9]\d*/);
    expect(output).toContain('⛔ 구멍이 있다');
  });

  /**
   * 🩸⛔⭐⭐ **「크론이 «없다»」는 rc=1 로 온다 — 「실패」와 «같은 종료 코드»다** (2026-09-02 · 43차 자기 검토)
   *
   * 📏 실측(둘 다 rc=1):  macOS `crontab: no crontab for root` · VM(Linux) `no crontab for root`
   * ⛔ 이 갈림이 없으면 ***크론이 없는 기계에서 백업이 영영 「구멍이 있다」***로 끝난다 —
   *    결손이 «아닌» 사실을 결손 칸에 넣는 것이고, 이 파일 머리말이 금지하는 바로 그 꼴이다.
   * ⭐ 그리고 «짝»으로 문다 — 바로 위 시험이 「진짜 실패(denied)」는 여전히 FAILED 로 센다.
   */
  test('treats \u300cno crontab for\u300d (rc=1) as a fact, not a hole', async () => {
    const { status, output } = await runBackup('#!/bin/sh\necho "crontab: no crontab for tester" >&2\nexit 1\n');

    expect(status).toBe(0);
    expect(output).toContain('이 기계엔 크론이 없다 — 건너뛴다');
    expect(output).toContain('no crontab for tester');
    // 🔑 ⛔ 「실패 0」 ⊕ 「계획 0」이 «둘 다» 이 시험의 값이다 —
    //    사실을 결손으로 세도 죽고, «없는 것»을 계획에 넣어도 죽는다
    expect(output).toContain('📋 계획 0 · 담김 0 · 실패 0');
    expect(output).not.toContain('⛔ 구멍이 있다');
  });

  /**
   * 🔒⛔⭐⭐ **자격이 실린 crontab 은 «안 담긴다»** (2026-09-02 · 43차 자기 리뷰 must-fix ①)
   *
   * 🔑 이 걸음은 crontab 전문을 «원격»으로 보내는 ***새 데이터 흐름***이다. 올라가면 되돌릴 수 없다.
   * ⛔ 그래서 「경고만 하고 담기」도 「가리고 담기」도 아니고 ***「안 담고 이름을 대기」***다.
   * ⭐ ***짝으로 문다*** — 자격처럼 «보이지 않는» 경로 값(`API_KEY_FILE=/path/...`)은 «통과해야» 한다.
   *    그러지 않으면 이 관문이 정상 크론을 영영 막는다.
   */
  test('refuses to stage a crontab that carries a credential — and never prints the value', async () => {
    const secret = 'AKIA' + 'ABCDEFGHIJKLMNOP';
    const { status, output } = await runBackup(`20 4 * * * AWS_ACCESS_KEY_ID=${secret} /opt/elanous/run\n`);

    expect(status).not.toBe(0);
    expect(output).toContain('자격처럼 보이는 값이 있어 «안 담았다»');
    expect(output).toContain('⛔ 구멍이 있다');
    // 🔑⛔ ***값이 산출에 «없어야» 한다*** — 이유를 보여 주려다 비밀을 흘리는 문을 막는다
    expect(output).not.toContain(secret);
  });

  /**
   * 🩸⛔⭐⭐⭐ **GOODHART — 내 첫 경로 시험이 «우연히» 통과했다** (2026-09-02 · 43차 자기 리뷰 2차)
   *
   * 🚨 첫 판은 `~/.config/keys.json` 을 썼다. 그 값은 ***둘째 `/` 가 16자 전에 나와***
   *    거짓 양성을 «가렸다». ⇒ 정규식이 틀렸는데 시험이 초록이었다.
   * ✅ 그래서 ***가장 얇은 값***으로 문다 — `/` 하나 뒤에 16자가 «이어지는» 절대 경로.
   *    ⛔ 이것이 걸리면 이 관문은 ***정상 크론을 영영 막는다***.
   */
  /**
   * 🩸⛔⭐⭐ **소문자 자격도 자격이다** (2026-09-02 · 43차 자기 리뷰 3차 must-fix)
   * 🚨 셸 환경 변수는 소문자로도 쓴다. 대소문자를 구별하는 자는 ***자기가 무엇을 놓치는지 말하지 않는다***.
   */
  test('a lowercase credential name is caught too — and never printed', async () => {
    const secret = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
    const { status, output } = await runBackup(`20 4 * * * aws_secret_access_key=${secret} /opt/elanous/run\n`);

    expect(status).not.toBe(0);
    expect(output).toContain('자격처럼 보이는 값이 있어 «안 담았다»');
    expect(output).not.toContain(secret);
  });

  test('an absolute path with a long first segment is NOT a credential (⛔ 첫 판이 여기서 «가려졌다»)', async () => {
    const { status, output } = await runBackup('20 4 * * * API_KEY_FILE=/abcdefghijklmnop /opt/elanous/run\n');

    expect(status).toBe(0);
    expect(output).not.toContain('자격처럼 보이는 값');
    expect(output).toContain('📋 계획 1 · 담김 1 · 실패 0');
  });

  test('a ~ / $ shaped value is NOT a credential either', async () => {
    const { status, output } = await runBackup('20 4 * * * SECRET_FILE=~/.config/elanous/abcdefghijklmnop TOKEN_REF=$ELANOUS_TOKEN_ABCDEFGH /opt/elanous/run\n');

    expect(status).toBe(0);
    expect(output).not.toContain('자격처럼 보이는 값');
    expect(output).toContain('📋 계획 1 · 담김 1 · 실패 0');
  });

  /**
   * 🩸⛔⭐⭐ **거짓 «음성»의 짝** — 진짜 AWS 비밀은 `/`·`+` 를 담는다.
   * 첫 판은 값 문자에서 `/` 를 빼는 방식이라 ***이것을 놓치고 GCS 로 올렸을*** 것이다.
   */
  test('a credential whose value contains / and + is caught — and never printed', async () => {
    const secret = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
    const { status, output } = await runBackup(`20 4 * * * AWS_SECRET_ACCESS_KEY=${secret} /opt/elanous/run\n`);

    expect(status).not.toBe(0);
    expect(output).toContain('자격처럼 보이는 값이 있어 «안 담았다»');
    expect(output).not.toContain(secret);
  });

  test('skips a zero-byte crontab without recording failure or a plan', async () => {
    const { status, output } = await runBackup('#!/bin/sh\nexit 0\n');

    expect(status).toBe(0);
    expect(output).toContain('machine-crontab');
    expect(output).toContain('이 기계엔 크론이 없다 — 건너뛴다');
    // ⛔ 「계획 == 담김」이 아니라 ***「계획이 0」***을 단언한다 — 빈 것을 계획에 넣으면 여기서 죽는다
    expect(output).toContain('📋 계획 0 · 담김 0 · 실패 0');
    expect(output).toContain('[dry-run] 올리지 않았다');
  });
});
