import { describe, expect, it } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathProbe } from './probe-path.js';

const dir = mkdtempSync(join(tmpdir(), 'probe-path-'));

describe('pathProbe — 「있다」와 「쓸 수 있다」를 «다른 값»으로 낸다', () => {
  it('없는 경로는 missing 이다', () => {
    expect(pathProbe(join(dir, '없다'))).toBe('missing');
  });

  it('⭐ 지어낸 음성 — 파일이 «있는데» 실행 권한이 없으면 not-executable 이다', () => {
    // 🩸 이것이 수리 «전» 코드에서 `true`(있다)로 나오던 입력이다.
    const p = join(dir, 'aerender');
    writeFileSync(p, '#!/bin/sh\necho hi\n');
    chmodSync(p, 0o644);
    expect(pathProbe(p)).toBe('not-executable');
  });

  it('실행 권한이 붙으면 같은 파일이 ok 가 된다 (처방이 chmod +x 임을 시험이 말한다)', () => {
    const p = join(dir, 'aerender2');
    writeFileSync(p, '#!/bin/sh\necho hi\n');
    chmodSync(p, 0o755);
    expect(pathProbe(p)).toBe('ok');
  });

  it('⛔ `.app` 번들(폴더)은 존재만 묻는다 — 도는지는 drive 축이 답한다', () => {
    const p = join(dir, 'Some.app');
    mkdirSync(p, { recursive: true });
    expect(pathProbe(p)).toBe('ok');
  });

  it('⛔ 못 쓰는 파일을 ok 로도 missing 으로도 «접지 않는다»', () => {
    // 🩸 종전 판의 이 시험은 «헛돌았다» — 수리 전 코드도 'ok' ≠ 'missing' 이라 통과했다.
    //   ⇒ 「둘이 다르다」가 아니라 ***「셋째 값이다」***를 물어야 결함을 문다.
    const p = join(dir, 'aerender3');
    writeFileSync(p, 'x'); chmodSync(p, 0o600);
    const r = pathProbe(p);
    expect(r).not.toBe('ok');        // 수리 전 코드는 여기서 죽는다
    expect(r).not.toBe('missing');   // 「없다」로 접어도 죽는다
  });
});
