import { describe, expect, test } from 'bun:test';
import { childInstanceScope } from './child-scope.js';

/**
 * ⛔⭐⭐ 자식은 `ELANOUS_STATE_DIR` «문자열 하나»만 받는다 — 그래서 「사람이 말한 격리」와
 * 「부모가 트리에서 «파생»해 준 것」을 구분할 수 없었다. 그 결과 바깥 계정의 상태(쿼터 신호)를
 * 갱신 안 되는 우주에서 읽고 ***회전이 100% 계정을 골라*** 429 가 «네 번» 났다.
 */
describe('childInstanceScope — 파생 우주에 «출처»를 붙인다', () => {
  const base = {
    prodRoot: () => '/prod',
    childInstanceMode: () => 'derive' as never,
    log: () => {},
    cwd: () => '/tree',
  };

  test('⭐ 운영 부모가 파생 우주를 줄 때 «파생»이라고 말한다', () => {
    const scope = childInstanceScope({
      ...base,
      effectiveRoot: () => '/prod',
      derivedRoot: () => '/tree/.elanous-test',
    });
    expect(scope.stateDir).toBe('/tree/.elanous-test');
    expect(scope.stateDirSource).toBe('derived');
  });

  test('⛔ 부모 우주를 «물려줄» 때는 딱지를 안 붙인다 — 부모 것이 env 상속으로 간다', () => {
    const scope = childInstanceScope({
      ...base,
      effectiveRoot: () => '/some/other-universe',
      derivedRoot: () => '/tree/.elanous-test',
    });
    expect(scope.stateDir).toBe('/some/other-universe');
    expect(scope.stateDirSource).toBeUndefined();
  });

  test('⛔ 부모 우주 상속 모드에서는 stateDir 자체가 없다', () => {
    const scope = childInstanceScope({
      ...base,
      effectiveRoot: () => '/prod',
      childInstanceMode: () => 'inherit' as never,
    });
    expect(scope.stateDir).toBeUndefined();
    expect(scope.stateDirSource).toBeUndefined();
  });
});
