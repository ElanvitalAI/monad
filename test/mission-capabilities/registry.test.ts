import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  capabilityProviders,
  discoverCapabilityProviders,
  probeCapability,
  resolveCapabilityProvider,
} from '../../src/mission-capabilities/registry.js';

const registrySource = resolve(import.meta.dir, '../../src/mission-capabilities/registry.ts');
const capabilityRoot = resolve(import.meta.dir, '../../src/mission-capabilities');

// ⛔ 이 시험은 «실제 소스 트리»에 잠깐 파일을 놓는다 — 발견이 «디렉토리»에서 나는지를 보려면 그래야 한다(리뷰 지적).
//   ⇒ 이름을 한눈에 알아보게 접두를 붙이고, 각 시험의 finally ⊕ afterAll «둘 다»로 쓸어낸다.
//   ⚠️ 그래도 프로세스가 중간에 죽으면 남는다. 남으면 `git status` 에 `zz-probe-fixture-*` 로 «보인다».
// ⛔ 접두는 «id 규칙»(소문자로 시작 · [a-z0-9-])을 지켜야 한다 — 밑줄로 시작하면 레지스트리가 «옳게» 거부한다.
const FIXTURE_PREFIX = 'zz-probe-fixture-';
const fixtures = new Set<string>();
/** 픽스처 능력 파일을 놓는다 — ⛔ 여기서만 놓아야 afterAll 이 그것을 «안다». */
function makeFixture(domain: string, file: string, declaredId: string): string {
  const dir = resolve(capabilityRoot, domain);
  fixtures.add(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, file), [
    "import type { CapabilityProbeResult, CapabilityProvider } from '../registry.js';",
    'const provider: CapabilityProvider = {',
    `  id: '${declaredId}',`,
    '  async probe(): Promise<CapabilityProbeResult> { return { ok: true }; },',
    '};',
    'export default provider;',
    '',
  ].join('\n'));
  return dir;
}
afterAll(() => { for (const dir of fixtures) rmSync(dir, { recursive: true, force: true }); });

describe('mission capability registry — 규칙이 곧 조회다', () => {
  test('registry.ts 에 능력 id 를 «손으로 나열한» 목록이 없다', () => {
    const source = readFileSync(registrySource, 'utf8');
    // ⛔ 카탈로그에 실재하는 id 가 registry 소스에 «문자열로» 박혀 있으면 그것이 매핑 테이블이다.
    //   (RFC: "매핑 테이블을 두지 않는다 — 그 테이블이 또 늙는다")
    const hardcoded = capabilityProviders.map(p => p.id).filter(id => source.includes(id));
    expect(hardcoded).toEqual([]);
    // 능력 파일을 개별 import 하는 줄도 없다.
    expect(source).not.toMatch(/^import \w+Provider from '\.\//m);
  });

  test('디렉토리에 «새로 놓인» 능력을 등록 절차 없이 찾는다', async () => {
    const domain = `${FIXTURE_PREFIX}discovery`;
    const dir = makeFixture(domain, 'sample.ts', `${domain}.sample`);
    try {
      const found = await discoverCapabilityProviders();
      expect(found.map(p => p.id)).toContain(`${domain}.sample`);
      // ⭐ registry.ts 를 «한 글자도» 안 고쳤는데 조회된다 — 그것이 이 설계의 요점이다.
      expect(readFileSync(registrySource, 'utf8')).not.toContain(FIXTURE_PREFIX);
      expect(await probeCapability(`${domain}.sample`)).toEqual({ ok: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('«.js 만» 있는 능력도 찾는다 — 열거와 조회의 확장자가 어긋나지 않는다', async () => {
    const domain = `${FIXTURE_PREFIX}jsonly`;
    const dir = resolve(capabilityRoot, domain);
    fixtures.add(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'sample.js'), [
      'const provider = {',
      `  id: '${domain}.sample',`,
      '  async probe() { return { ok: true }; },',
      '};',
      'export default provider;',
      '',
    ].join('\n'));
    try {
      const found = await discoverCapabilityProviders();
      expect(found.map(p => p.id)).toContain(`${domain}.sample`);
      // ⭐ 열거만이 아니라 «조회 경로»까지 이어지는지 본다(리뷰 3R should-fix).
      expect(await probeCapability(`${domain}.sample`)).toEqual({ ok: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('있는데 «못 읽은» 능력은 undefined 로 삼키지 않고 «올린다»', async () => {
    const domain = `${FIXTURE_PREFIX}broken`;
    const dir = resolve(capabilityRoot, domain);
    fixtures.add(dir);
    mkdirSync(dir, { recursive: true });
    // ⛔ `throw` 를 맨 위에 두면 bun 이 «export 바인딩» 오류로 바꿔 원 메시지가 사라진다(실측).
    //   ⇒ default 를 «평가할 때» 던지게 두면 그 모듈 자신의 메시지가 그대로 올라온다.
    writeFileSync(resolve(dir, 'sample.ts'), "export default (() => { throw new Error('FIXTURE-INIT-BOOM'); })();\n");
    try {
      // ⛔ 「없다」로 조용히 바뀌면 운영 오류가 영영 안 보인다 — 그래서 던져야 한다.
      await expect(resolveCapabilityProvider(`${domain}.sample`)).rejects.toThrow('FIXTURE-INIT-BOOM');
      // ⚠️ 실패한 모듈 import 는 «캐시»된다 — 두 번째 시도는 원 메시지가 아니라
      //   "Cannot access 'default' before initialization." 로 온다(실측). 그래서 여기선 «던지는가»만 본다.
      //   ⛔ 요점은 그대로다: 「없다(undefined)」로 조용히 바뀌지 «않는다».
      await expect(discoverCapabilityProviders()).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('같은 능력이 .ts 와 .js 로 «둘 다» 있어도 한 번만 발견된다', async () => {
    const domain = `${FIXTURE_PREFIX}bothext`;
    const dir = makeFixture(domain, 'sample.ts', `${domain}.sample`);
    writeFileSync(resolve(dir, 'sample.js'), [
      'const provider = {',
      `  id: '${domain}.sample',`,
      '  async probe() { return { ok: true }; },',
      '};',
      'export default provider;',
      '',
    ].join('\n'));
    try {
      const found = await discoverCapabilityProviders();
      expect(found.filter(p => p.id === `${domain}.sample`)).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('기동 시 채워진 카탈로그가 «지금» 디렉토리에 있는 것과 같다', async () => {
    const discovered = await discoverCapabilityProviders();
    expect(capabilityProviders.map(p => p.id).sort()).toEqual(discovered.map(p => p.id).sort());
    expect(capabilityProviders.length).toBeGreaterThan(0);
  });

  // ⛔ 옛 판은 'analysis.__none__' 를 썼는데 밑줄 때문에 «정규식에서» 먼저 걸려
  //   ***동적 import 의 모듈 부재 처리를 한 번도 안 탔다***(리뷰 4R must-fix · 내 시험의 Goodhart).
  test('이름 규칙은 맞는데 «파일이 없는» id 는 undefined 다 — 던지지 않는다', async () => {
    expect(await resolveCapabilityProvider('analysis.nonexistent')).toBeUndefined();
    expect(await probeCapability('analysis.nonexistent')).toBeUndefined();
  });

  test('provider 는 «있는데» 그 안의 의존성이 없으면 «없다»로 삼키지 않고 올린다', async () => {
    const domain = `${FIXTURE_PREFIX}missingdep`;
    const dir = resolve(capabilityRoot, domain);
    fixtures.add(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'sample.ts'), [
      "import './definitely-missing-dep.js';",
      `export default { id: '${domain}.sample', async probe() { return { ok: true }; } };`,
      '',
    ].join('\n'));
    try {
      // ⛔ 이것도 ERR_MODULE_NOT_FOUND 다 — 그러나 «내가 물은 모듈»이 아니라 그 «의존성»이 없는 것이다.
      await expect(resolveCapabilityProvider(`${domain}.sample`)).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('이름 규칙을 어긴 id 는 «경로를 조립하기 전에» 거부한다', async () => {
    for (const bad of ['../../etc/passwd', 'analysis/valuechain', 'analysis..valuechain', 'Analysis.Valuechain', 'novertdot', '']) {
      expect(await resolveCapabilityProvider(bad)).toBeUndefined();
    }
  });

  test('id 와 default export 의 id 가 다르면 받아들이지 않는다', async () => {
    const domain = `${FIXTURE_PREFIX}mismatch`;
    const dir = makeFixture(domain, 'sample.ts', `${domain}.OTHER`);
    try {
      expect(await resolveCapabilityProvider(`${domain}.sample`)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('probeCapability 가 «찾아낸 그 provider 의 probe» 를 실제로 부른다', async () => {
    const registered = await resolveCapabilityProvider('report.trafficlight');
    if (!registered) throw new Error('report.trafficlight 를 규칙으로 «못 찾았다».');
    const sentinel = { ok: false, reason: 'sentinel', repairHint: { paths: ['sentinel'], what: 'sentinel' } } as const;
    const spy = spyOn(registered, 'probe').mockResolvedValue(sentinel);
    try {
      expect(await probeCapability('report.trafficlight')).toEqual(sentinel);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
