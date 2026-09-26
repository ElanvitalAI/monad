// 🚧 gws 쓰기 관문 — ⛔ 「소스에 적혔나」가 아니라 ***「실제로 막나」***를 문다.
//    그래서 스크립트를 «진짜로 돌린다»(가짜 gws 를 PATH 로 물려서 네트워크를 안 탄다).
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(import.meta.dir, 'gws-safe.sh');

/**
 * 진짜 gws 대신 «스키마만 아는» 가짜를 쓴다.
 * ⛔ 흉내가 아니라 «계약»을 재현한다 — `schema` 는 httpMethod 를 내고, 실행은 표식을 낸다.
 */
function fakeGws(schemaMap: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'gws-fake-'));
  const bin = join(dir, 'gws');
  writeFileSync(bin, `#!/usr/bin/env bash
if [ "$1" = "schema" ]; then
  case "$2" in
${Object.entries(schemaMap).map(([k, v]) => `    ${k}) echo '{"httpMethod":"${v}"}' ;;`).join('\n')}
    *) echo '{}' ;;
  esac
  exit 0
fi
echo '{"ran":true}'
`, { mode: 0o755 });
  chmodSync(bin, 0o755);
  return bin;
}

const run = (bin: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { ...process.env, ELANOUS_GWS_BIN: bin, ...env } });

describe('gws 쓰기 관문', () => {
  const bin = fakeGws({
    'gmail.users.messages.list': 'GET',
    'gmail.users.messages.send': 'POST',
    'gmail.users.messages.delete': 'DELETE',
    'calendar.events.list': 'GET',
    'calendar.events.insert': 'POST',
  });

  test('읽기(GET)는 «그대로» 통과한다', () => {
    const r = run(bin, ['gmail', 'users', 'messages', 'list', '--params', '{}']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('"ran"');
  });

  /** ⭐ 이 시험이 요지다 — 규율이 아니라 «관문»인지. */
  test('⭐ 쓰기(POST)는 «막힌다» — 그리고 rc=4 로 «구분 가능»하다', () => {
    const r = run(bin, ['gmail', 'users', 'messages', 'send', '--json', '{}']);
    expect(r.status).toBe(4);
    expect(r.stdout).not.toContain('"ran"');   // ⛔ 실행이 «안 됐다»
    expect(r.stderr).toContain('쓰기');
  });

  test('삭제(DELETE)도 막힌다', () => {
    expect(run(bin, ['gmail', 'users', 'messages', 'delete', '--params', '{}']).status).toBe(4);
  });

  test('사람이 «명시로» 열면 통과한다 — 그리고 그때만', () => {
    const r = run(bin, ['calendar', 'events', 'insert', '--json', '{}'], { ELANOUS_GWS_ALLOW_WRITE: '1' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('"ran"');
  });

  test('⛔ 「1」이 «아닌» 값으로는 안 열린다 — 참 같은 문자열에 속지 않는다', () => {
    for (const v of ['0', 'true', 'yes', '']) {
      expect(run(bin, ['gmail', 'users', 'messages', 'send'], { ELANOUS_GWS_ALLOW_WRITE: v }).status).toBe(4);
    }
  });

  /** ⛔ 「모른다」를 「괜찮다」로 읽지 않는다 — 브라우저 축의 ClickKind 와 같은 규율. */
  test('⛔ httpMethod 를 «못 알아내면» 막는다', () => {
    const r = run(bin, ['unknown', 'thing', 'frobnicate']);
    expect(r.status).toBe(4);
    expect(r.stderr).toContain('못 알아냈다');
  });

  test('schema·auth 자체는 관문을 «안» 탄다 — 그것으로 판정하기 때문이다', () => {
    expect(run(bin, ['schema', 'gmail.users.messages.list']).status).toBe(0);
  });

  test('⛔ 인자가 없으면 «거절»하고 그 이유를 댄다', () => {
    const r = spawnSync('bash', [script], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('인자가 «없다»');
  });

  test('⛔ gws 가 «없으면» 「Google 이 안 된다」가 아니라 그렇게 말한다', () => {
    const r = run('/nonexistent/gws', ['gmail', 'users', 'messages', 'list']);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain('못 찾았다');
  });
});
