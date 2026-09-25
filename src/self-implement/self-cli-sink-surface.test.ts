import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { selfCliSinkSurface } from './self-cli-sink-surface.js';

describe('selfCliSinkSurface', () => {
  test('기본은 harness — 표에 없는 하위 커맨드도 반드시 sink 를 얻는다', () => {
    // ⚠️ census 의 미등록 9개를 **전부** 센다(리뷰 should-fix — `capabilities` 가 빠져 있었다).
    for (const sub of ['implement', 'typecheck', 'screen', 'run', 'log', 'provision', 'recall', 'capability', 'capabilities']) {
      expect(selfCliSinkSurface(sub)).toBe('harness');
    }
  });

  test('기존 surface 를 보존한다 (attribution 계약 불변)', () => {
    expect(selfCliSinkSurface('utterance')).toBe('utterance');
  });

  // ⛔ review 는 자기 seam 이 이미 등록하고 그것이 테스트로 잠겨 있다. 훅이 또 붙이면 싱크가 둘.
  test('review 는 훅이 비켜 준다 (중복 싱크 방지)', () => {
    expect(selfCliSinkSurface('review')).toBeNull();
  });
});

// ⭐⭐ 구조 불변식 — *"빼먹을 수 없게"* 가 이 트랙의 요구였다(2026-07-30 T 제안).
// 훅이 있는데 액션이 **또** 부르면 싱크가 둘이 되어 같은 줄이 두 번 적재된다.
describe('self 액션은 sink 를 직접 등록하지 않는다 (훅이 소유)', () => {
  test('selfCmd 블록 안에 registerStandaloneLogSink 직접 호출이 없다', () => {
    const src = readFileSync(new URL('../index.ts', import.meta.url), 'utf8').split('\n');
    const start = src.findIndex((l) => l.startsWith('const selfCmd'));
    expect(start).toBeGreaterThan(0);
    // selfCmd 체인이 끝나는 지점 = 다음 최상위 `const <x>Cmd = program.command(`
    let end = src.length;
    for (let i = start + 1; i < src.length; i++) {
      if (/^const \w+Cmd = program\.command\(/.test(src[i]!)) { end = i; break; }
    }
    const block = src.slice(start, end);
    // ⛔ 줄 단위로만 보면 `registerStandaloneLogSink(\n  'harness')` 처럼 **줄바꿈된 호출**을
    //    놓친다(리뷰 should-fix). 블록을 한 덩어리로 보고 **호출과 그 첫 인자 사이의 공백/개행을
    //    허용하는** 정규식으로 잡는다. 줄 번호는 매치 위치에서 역산한다.
    const joined = block.join('\n');
    const blockOffenders: string[] = [];
    for (const m of joined.matchAll(/registerStandaloneLogSink\(\s*['`"]/g)) {
      const line = start + joined.slice(0, m.index).split('\n').length;
      blockOffenders.push(`${line}: ${m[0]}`);
    }
    expect(blockOffenders).toEqual([]);

    const offenders = block
      .map((l, i) => ({ l, n: start + i + 1 }))
      .filter(({ l }) => l.includes('registerStandaloneLogSink('))
      // ⭐ 판별자는 **리터럴 인자 자체**다(리뷰 should-fix) — `registerStandaloneLogSink('…')`
      //    처럼 따옴표 인자를 넘기면 액션이 직접 부른 것 = 금지. 훅은 변수(`surface`)를 넘긴다.
      //    ⛔ `registerSink:` 같은 **줄 단위 예외**를 두지 않는다 — 같은 줄에 리터럴 등록이
      //    숨어 있어도 통과시켜 버린다.
      .filter(({ l }) => /registerStandaloneLogSink\(\s*['\`"]/.test(l));
    expect(offenders.map((o) => `${o.n}: ${o.l.trim().slice(0, 70)}`)).toEqual([]);
  });
});
