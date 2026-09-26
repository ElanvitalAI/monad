// 세션 출처 인스턴스 태깅 (2026-07-16) — 멀티 엘라누스(글로벌 데몬 + 폴더별 --test)에서
// "이 세션을 누가 만들었나"를 SessionMeta.originInstance 에 박제한다. LF7 로그 `instance`
// 컬럼과 동일 유도(instance-identity SSoT).
//
// ⚠️ 정체성 축 정정(2026-07-27) — 정체성은 **리졸브된 state 루트**이지 raw env 가 아니다.
//   3층(트리 파생 test) 스위치가 켜진 뒤 "env 미설정 = prod" 는 거짓이 됐다: 비-리더 트리는
//   env 없이도 리졸버가 `.elanous-test` 를 준다. 이름만 env 로 남겨두니 **test 스토어에 쓰면서
//   자기를 'prod' 로 스탬프**해 연합 조회에서 두 우주가 같은 태그로 뭉갰다.
//   ⇒ 아래 테스트는 "운영" 을 **env 미설정**이 아니라 **운영 루트 명시**로 표현한다.
//     env(2층)는 리졸버 안에서 트리 파생(3층)을 이기므로 결과가 머신의 리더/스위치 상태와
//     무관해진다(종전엔 이 파일이 실행 머신 상태에 의존했다).
//
// 저장 위치(ELANOUS_SESSION_ROOT)와 인스턴스 이름(state 루트)을 독립 제어 —
// SESSION_ROOT 가 저장은 이기고, state 루트가 이름을 준다.

import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

/** "운영 우주" 를 결정론적으로 표현 — 리졸버 2층(env)이 3층(트리 파생)을 이긴다. */
const PROD_ROOT = join(homedir(), '.elanous');

const ORIG_STATE = process.env.ELANOUS_STATE_DIR;
const ORIG_SESS = process.env.ELANOUS_SESSION_ROOT;
let tmp: string;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'sess-origin-'));
  process.env.ELANOUS_SESSION_ROOT = tmp;
  // 오버라이드 상태 초기화(다른 테스트가 setInstanceName 했을 수 있음).
  const { setInstanceName } = await import('../src/instance-identity.js');
  setInstanceName(undefined);
});
afterEach(async () => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  if (ORIG_STATE === undefined) delete process.env.ELANOUS_STATE_DIR; else process.env.ELANOUS_STATE_DIR = ORIG_STATE;
  if (ORIG_SESS === undefined) delete process.env.ELANOUS_SESSION_ROOT; else process.env.ELANOUS_SESSION_ROOT = ORIG_SESS;
  const { setInstanceName } = await import('../src/instance-identity.js');
  setInstanceName(undefined);
});

describe('resolveInstanceName — 격리 경계 = 리졸브된 state 루트', () => {
  test('운영 루트 → prod (글로벌 데몬·크론 은 전부 공유 = prod)', async () => {
    process.env.ELANOUS_STATE_DIR = PROD_ROOT;
    const { resolveInstanceName } = await import('../src/instance-identity.js');
    expect(resolveInstanceName()).toBe('prod');
  });

  test('★후행 슬래시가 붙어도 운영 루트는 prod (경로 정규화 경유)', async () => {
    process.env.ELANOUS_STATE_DIR = `${PROD_ROOT}/`;
    const { resolveInstanceName } = await import('../src/instance-identity.js');
    expect(resolveInstanceName()).toBe('prod');
  });

  test('<repo>/.elanous-test → test:<repo>', async () => {
    process.env.ELANOUS_STATE_DIR = '/Users/x/source/axon/monad-agent/.elanous-test';
    const { resolveInstanceName } = await import('../src/instance-identity.js');
    expect(resolveInstanceName()).toBe('test:monad-agent');
  });

  test('그 외 stateDir → test:<dir 이름> (예: telegram-test)', async () => {
    process.env.ELANOUS_STATE_DIR = '/Users/x/.elanous/telegram-test';
    const { resolveInstanceName } = await import('../src/instance-identity.js');
    expect(resolveInstanceName()).toBe('test:telegram-test');
  });

  test('setInstanceName 오버라이드가 최우선(config logs.instanceName 경로)', async () => {
    process.env.ELANOUS_STATE_DIR = '/Users/x/foo/.elanous-test';
    const { resolveInstanceName, setInstanceName } = await import('../src/instance-identity.js');
    setInstanceName('prod-main');
    expect(resolveInstanceName()).toBe('prod-main');
    setInstanceName('  ');           // 공백 = 무시
    expect(resolveInstanceName()).toBe('test:foo');
  });

  // ★이 트랙의 근본 가드 — env 가 **없어도** 이름이 경로와 같은 우주를 가리켜야 한다.
  //
  // 실측 사건(2026-07-27): 3층 스위치 ON + 비-리더 트리에서 경로는 `.elanous-test` 인데 이름만
  // 'prod' 로 남아, `elanous logs` 연합 뷰가 내 우주와 운영을 **둘 다 ⟨prod⟩** 로 찍었다.
  // 이 테스트가 뒤집히면 그 마스킹이 되살아난 것이다.
  //
  // ⚠️ 반드시 서브프로세스여야 한다 — Bun 의 `os.homedir()` 는 in-process HOME 변경을 무시하고
  //   프로세스 시작 시점 값을 본다(같은 프로세스 안에서는 HOME 격리 불가·subprocess 는 통함).
  test('★env 없이 3층 파생 → 이름도 test 로 간다 (경로·이름 축 일원화)', () => {
    const home = mkdtempSync(join(tmpdir(), 'ident-home-'));
    try {
      mkdirSync(join(home, '.elanous'));
      writeFileSync(join(home, '.elanous', 'config.json'), JSON.stringify({ instance: { treeDerivedTest: true } }));
      // 리더를 남의 트리로 못박아 이 트리를 비-리더로 만든다(3층 파생 조건).
      writeFileSync(join(home, '.elanous', 'leader.json'), JSON.stringify({ tree: '/some/other/leader', promotedAt: 'x' }));
      const script = `
        const {resolveInstanceName}=require('${process.cwd()}/src/instance-identity.ts');
        const {effectiveInstanceRoot}=require('${process.cwd()}/src/instance/resolve.ts');
        console.log(JSON.stringify({n:resolveInstanceName(),r:effectiveInstanceRoot()}));
      `;
      const r = spawnSync('bun', ['-e', script], {
        encoding: 'utf8', timeout: 60_000, cwd: process.cwd(),
        // ⚠️ 리졸버의 **상위 층 전부**를 비운다(리뷰 must-fix) — 하나라도 호스트 env 가 새어
        //   들어오면 3층 파생이 안 일어나 이 테스트가 무엇을 쟀는지 알 수 없게 된다.
        //   이 테스트의 전제는 "명시 우주가 하나도 없다" 이다.
        env: {
          ...process.env, HOME: home,
          ELANOUS_STATE_DIR: '', ELANOUS_CONFIG_DIR: '', ELANOUS_NEXUS_DIR: '', ELANOUS_SESSION_ROOT: '',
        },
      });
      const out = JSON.parse((r.stdout ?? '').trim().split('\n').pop() ?? '{}') as { n?: string; r?: string };
      expect(out.r?.endsWith('.elanous-test')).toBe(true);   // 경로는 격리로 갔고
      expect(out.n).not.toBe('prod');                      // ★이름이 운영을 사칭하지 않는다
      // ⚠️ 체크아웃 폴더명을 하드코딩하지 않는다 — worktree·CI 작업경로에서 이름이 달라도
      //   정상 구현이 실패하면 안 된다(리뷰 지적). 리졸브된 루트에서 기대값을 유도한다.
      //   경로 조작은 `basename(dirname())` 으로 — `split('/')` 는 플랫폼 의존이다.
      const expected = `test:${basename(dirname(out.r!))}`;
      expect(out.n).toBe(expected);                        //  그리고 트리 이름을 정확히 가리킨다
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 90_000);
});

describe('createSession stamps originInstance + listSessions filters', () => {
  test('운영 루트 → 세션이 prod 로 태깅', async () => {
    process.env.ELANOUS_STATE_DIR = PROD_ROOT;
    const { createSession, loadSession } = await import('../src/session/index.js');
    const meta = createSession({ source: 'cli' }, tmp);
    expect(meta.originInstance).toBe('prod');
    // 재로드해도 보존.
    expect(loadSession(meta.id, tmp)!.meta.originInstance).toBe('prod');
  });

  test('ELANOUS_STATE_DIR 격리 → test:<repo> 로 태깅(저장은 SESSION_ROOT)', async () => {
    process.env.ELANOUS_STATE_DIR = '/Users/x/source/foo/.elanous-test';
    const { createSession } = await import('../src/session/index.js');
    const meta = createSession({ source: 'cli' }, tmp);
    expect(meta.originInstance).toBe('test:foo');
  });

  test('listSessions({originInstance}) 로 출처 필터 — 공유 스토어에서 prod/test 분리', async () => {
    const { createSession, listSessions } = await import('../src/session/index.js');
    process.env.ELANOUS_STATE_DIR = PROD_ROOT;
    const p = createSession({ source: 'cli', title: 'prod-one' }, tmp);
    process.env.ELANOUS_STATE_DIR = '/Users/x/source/foo/.elanous-test';
    const t = createSession({ source: 'cli', title: 'test-one' }, tmp);

    const prodOnly = listSessions({ originInstance: 'prod' }, tmp);
    expect(prodOnly.map(m => m.id)).toContain(p.id);
    expect(prodOnly.map(m => m.id)).not.toContain(t.id);

    const testOnly = listSessions({ originInstance: 'test:foo' }, tmp);
    expect(testOnly.map(m => m.id)).toContain(t.id);
    expect(testOnly.map(m => m.id)).not.toContain(p.id);
  });

  test('구 세션(originInstance 부재)은 인스턴스 필터에 비매치(tolerant)', async () => {
    const { listSessions } = await import('../src/session/index.js');
    // index.json 에 originInstance 없는 레코드를 직접 심는다.
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(tmp, 'index.json'), JSON.stringify([
      { id: 'old-1', title: 'legacy', source: 'cli', createdAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-01T00:00:00Z', provider: 'auto', model: '', messageCount: 0 },
    ]));
    expect(listSessions({}, tmp).map(m => m.id)).toContain('old-1');       // 필터 없으면 보임
    expect(listSessions({ originInstance: 'prod' }, tmp).map(m => m.id)).not.toContain('old-1');
  });
});

describe('dispatchSessionQuery — instance 필터(list)', () => {
  test('list action 이 instance 로 필터', async () => {
    const { createSession, appendMessage } = await import('../src/session/index.js');
    const { dispatchSessionQuery } = await import('../src/domains/session-query-tool.js');
    delete process.env.ELANOUS_STATE_DIR;
    const p = createSession({ source: 'cli', title: 'prod-x' }, tmp);
    appendMessage(p.id, { role: 'user', content: 'hi prod' }, tmp);   // 비어있지 않게(hideEmpty 기본)
    process.env.ELANOUS_STATE_DIR = '/Users/x/source/bar/.elanous-test';
    const t = createSession({ source: 'cli', title: 'test-x' }, tmp);
    appendMessage(t.id, { role: 'user', content: 'hi test' }, tmp);

    const res = await dispatchSessionQuery({ action: 'list', instance: 'test:bar' }, { root: tmp }) as {
      sessions: Array<{ title: string; originInstance?: string }>;
    };
    expect(res.sessions.length).toBe(1);
    expect(res.sessions[0].title).toBe('test-x');
    expect(res.sessions[0].originInstance).toBe('test:bar');
  });
});
