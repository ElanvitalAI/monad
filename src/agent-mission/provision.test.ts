// P4 역량 프로비저닝 — 안전 spec 판정·매니저 감지·정책 게이트·설치 실행(격리·주입 run) 회귀 가드.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  isSafeSpec,
  detectManager,
  defaultProvisionPolicy,
  provisionCapability,
  buildMissionProvision,
  pkgDirName,
  isSafeCapabilityName,
  makeSelfProvisionPolicy,
  makeAllowlistResolver,
  denyAllArtifactResolver,
  buildSelfProvision,
  planSelfProvision,
  type ProvisionRequest,
  type ProvisionDeps,
} from './provision.js';
import { mkdtempSync, writeFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('isSafeSpec (주입 차단·순수)', () => {
  it('정상 패키지명·스코프·버전 허용', () => {
    for (const s of ['lodash', '@types/node', 'react@18.2.0', 'left-pad', 'numpy', 'foo.bar']) {
      expect(isSafeSpec(s)).toBe(true);
    }
  });
  it('셸 메타·공백·플래그·URL 거부', () => {
    for (const s of ['a; rm -rf /', 'a && b', 'a|b', '$(whoami)', '`id`', 'a b', '--registry=evil', '-g', 'http://evil/x.tgz', 'x://y', "a'b", 'a"b', '']) {
      expect(isSafeSpec(s)).toBe(false);
    }
  });
  it('128자 초과 거부', () => {
    expect(isSafeSpec('a'.repeat(129))).toBe(false);
  });
});

describe('detectManager / defaultProvisionPolicy', () => {
  let dir = '';
  beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'prov-'))); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('매니페스트로 매니저 감지(bun lockfile 우선 → npm 폴백)', () => {
    expect(detectManager(dir)).toBeNull(); // 빈 dir
    writeFileSync(join(dir, 'package.json'), '{}');
    expect(detectManager(dir)).toBe('npm');
    writeFileSync(join(dir, 'bun.lock'), '');
    expect(detectManager(dir)).toBe('bun'); // lockfile 우선
  });

  it('packageManager 필드 우선(lockfile 없어도 선언 존중·잘못된 npm 강제 방지)', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@8.6.0' }));
    expect(detectManager(dir)).toBe('pnpm');
  });

  it('packageManager 미지원(deno@)은 정직 감지 후 정책이 거부(npm 오폴백 없음·must-fix)', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'deno@1.0.0' }));
    expect(detectManager(dir)).toBe('deno');  // 정직 감지(무엇을 쓰나)
    const d = defaultProvisionPolicy({ layer: 'pkg', spec: 'lodash' }, dir);
    expect(d.allow).toBe(false);              // 지원 판단은 정책 → 미지원 거부(잘못된 npm 강제 아님)
    if (!d.allow) expect(d.reason).toContain('미지원');
  });

  it('yarn 감지 → 정책 거부(세대별 --ignore-scripts 차이로 미지원)', () => {
    writeFileSync(join(dir, 'yarn.lock'), '');
    expect(detectManager(dir)).toBe('yarn');
    const d = defaultProvisionPolicy({ layer: 'pkg', spec: 'lodash' }, dir);
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toContain('미지원');
  });

  it('pkg + 안전 spec + 감지 매니저 = allow(cmd/args + --ignore-scripts)', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    const d = defaultProvisionPolicy({ layer: 'pkg', spec: 'lodash' }, dir);
    expect(d.allow).toBe(true);
    // ★ --ignore-scripts = 설치시 lifecycle 임의코드(RCE) 차단(핵심 안전 불변식).
    if (d.allow && d.kind === 'pkg') { expect(d.manager).toBe('npm'); expect(d.cmd).toBe('npm'); expect(d.args).toEqual(['install', 'lodash', '--ignore-scripts']); }
  });

  it('layer≠pkg = deferred(거부) — known non-pkg·완전 무효 모두', () => {
    for (const layer of ['skill', 'app', 'mcp', 'garbage-xyz', '']) {
      const d = defaultProvisionPolicy({ layer, spec: 'omni-market' }, dir);
      expect(d.allow).toBe(false); // pkg 아니면(무효 포함) 전부 defer = pkg 오분류 우회 차단
    }
  });

  it('bun 매니저도 --ignore-scripts 안전 인자(RCE 차단·trustedDependencies 대비)', () => {
    writeFileSync(join(dir, 'bun.lock'), '');
    const d = defaultProvisionPolicy({ layer: 'pkg', spec: 'lodash' }, dir);
    expect(d.allow).toBe(true);
    if (d.allow && d.kind === 'pkg') { expect(d.manager).toBe('bun'); expect(d.args).toEqual(['add', 'lodash', '--ignore-scripts']); }
  });

  it('안전하지 않은 spec = 거부', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    const d = defaultProvisionPolicy({ layer: 'pkg', spec: '--registry=evil' }, dir);
    expect(d.allow).toBe(false);
  });

  it('매니페스트 없음 = 매니저 불명 거부', () => {
    const d = defaultProvisionPolicy({ layer: 'pkg', spec: 'lodash' }, dir);
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toContain('미감지');
  });
});

describe('provisionCapability (실행·주입 run)', () => {
  let dir = '';
  beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'prov-'))); writeFileSync(join(dir, 'package.json'), '{}'); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('허용 → run 호출(worktree cwd·--ignore-scripts 안전구성·정확 명령) → installed detail', async () => {
    let captured: { cmd: string; args: string[]; cwd: string } | null = null;
    const res = await provisionCapability({ layer: 'pkg', spec: 'lodash' }, {
      cwd: dir,
      run: async (cmd, args, cwd) => { captured = { cmd, args: [...args], cwd }; return { status: 0, out: 'added 1 package' }; },
      resolved: () => true, // 모듈 해석 성공(주입 run 은 실제 node_modules 를 안 만드므로)
    });
    expect(res.ok).toBe(true);
    expect(res.action).toBe('installed');
    expect(res.detail).toContain('설치했다');
    expect(captured).not.toBeNull();
    expect(captured!.cmd).toBe('npm');           // 감지 매니저
    expect(captured!.args).toEqual(['install', 'lodash', '--ignore-scripts']); // ★ lifecycle RCE 차단 플래그 필수
    expect(captured!.cwd).toBe(dir);             // worktree-local(node_modules) cwd 로 실행
  });

  it('정책 거부 → run 미호출 + denied detail(진행 안내)', async () => {
    let called = false;
    const res = await provisionCapability({ layer: 'app', spec: 'postgres' }, {
      cwd: dir,
      run: async () => { called = true; return { status: 0, out: '' }; },
    });
    expect(res.action).toBe('denied');
    expect(called).toBe(false); // 거부는 실행 안 함
    expect(res.detail).toContain('다른 방법으로 진행');
  });

  it('설치 실패(exit≠0) → error detail', async () => {
    const res = await provisionCapability({ layer: 'pkg', spec: 'nonexistent-xyz' }, {
      cwd: dir,
      run: async () => ({ status: 1, out: 'E404 Not Found' }),
    });
    expect(res.ok).toBe(false);
    expect(res.action).toBe('error');
    expect(res.detail).toContain('설치 실패');
  });

  it('exit 0 이나 모듈 미해석(no-op/부분) → 성공으로 오판 안 하고 error(리뷰)', async () => {
    const res = await provisionCapability({ layer: 'pkg', spec: 'lodash' }, {
      cwd: dir,
      run: async () => ({ status: 0, out: 'up to date' }), // exit 0 이지만
      resolved: () => false,                                // 모듈 해석 실패(no-op)
    });
    expect(res.ok).toBe(false);
    expect(res.action).toBe('error');
    expect(res.detail).toContain('확인되지 않았다');
  });

  it('detail 은 PTY 재주입 안전화 — 매니저 출력의 제어문자/ANSI/개행 제거(인젝션 차단)', async () => {
    const res = await provisionCapability({ layer: 'pkg', spec: 'lodash' }, {
      cwd: dir,
      run: async () => ({ status: 1, out: 'error\n\x1b[31mred\x1b[0m\r\n\x07evil\ninjected line' }),
    });
    // 개행/캐리지리턴/제어문자/ANSI 가 detail 에 남으면 PTY 로 추가 라인·시퀀스가 주입된다 → 전부 제거돼야.
    expect(res.detail).not.toMatch(/[\x00-\x1f\x7f]/);
    expect(res.detail).not.toContain('\x1b');
  });

  it('buildMissionProvision 배선(DI behavior) — worktree 경로를 provisioner 의 cwd 로 전달', async () => {
    // runAgentMission 이 이 팩토리로 배선(provision: buildMissionProvision(wt.path)). 주입 provisioner 로
    //   "wt.path → cwd" 를 소스 문자열이 아닌 **행동**으로 검증(리뷰 must-fix·Goodhart tripwire 대체).
    let gotDeps: ProvisionDeps | null = null;
    const cb = buildMissionProvision('/wt/branch-x', async (_req, deps) => { gotDeps = deps; return { ok: true, layer: 'pkg', spec: 'lodash', action: 'installed', detail: 'ok' }; });
    await cb({ layer: 'pkg', spec: 'lodash' });
    expect(gotDeps).not.toBeNull();
    expect(gotDeps!.cwd).toBe('/wt/branch-x'); // worktree 경로가 cwd 로 배선됨
  });

  it('cwd 라우팅 — 설치(주입 run 의 write)는 전달된 cwd(worktree)에만 반영·다른 트리 무변경', async () => {
    // ⚠️ 완전 sandbox 검증이 아니라 provisionCapability 가 cwd 를 정확히 전달하는지 실증(주입 run·실 npm 아님).
    const other = realpathSync(mkdtempSync(join(tmpdir(), 'prov-other-')));
    try {
      const res = await provisionCapability({ layer: 'pkg', spec: 'lodash' }, {
        cwd: dir,
        run: async (_cmd, _args, cwd) => { writeFileSync(join(cwd, 'installed-marker'), 'x'); return { status: 0, out: 'ok' }; },
        resolved: () => true,
      });
      expect(res.ok).toBe(true);
      expect(existsSync(join(dir, 'installed-marker'))).toBe(true);    // worktree(cwd)에 생김
      expect(existsSync(join(other, 'installed-marker'))).toBe(false); // 다른 트리는 무변경
    } finally { rmSync(other, { recursive: true, force: true }); }
  });
});

describe('pkgDirName (node_modules 디렉토리명·순수)', () => {
  it('버전 제거·스코프 보존', () => {
    expect(pkgDirName('lodash')).toBe('lodash');
    expect(pkgDirName('react@18.2.0')).toBe('react');
    expect(pkgDirName('@types/node')).toBe('@types/node');
    expect(pkgDirName('@types/node@20.1.0')).toBe('@types/node');
  });
});

// ── L3 self 역량 프로비저닝 (#7-5 · 2026-07-26) ──────────────────────────────────────────────
describe('isSafeCapabilityName (path traversal·주입 차단·순수)', () => {
  it('단순 슬러그 허용', () => {
    for (const n of ['omni-market', 'value_investor', 'skill.v2', 'a1']) expect(isSafeCapabilityName(n)).toBe(true);
  });
  it('traversal·구분자·셸메타·빈값·초과 거부', () => {
    for (const n of ['../etc', 'a/b', 'a\\b', '..', '', 'a'.repeat(65), 'a b', 'a;b', '-flag']) {
      expect(isSafeCapabilityName(n)).toBe(false);
    }
  });
});

describe('makeSelfProvisionPolicy (self 대상·pkg+skill/subagent·allowlist)', () => {
  let dir = '';
  beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'prov-self-'))); writeFileSync(join(dir, 'package.json'), '{}'); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('pkg = defaultProvisionPolicy 재사용(kind:pkg·argv)', () => {
    const policy = makeSelfProvisionPolicy(denyAllArtifactResolver);
    const d = policy({ layer: 'pkg', spec: 'lodash' }, dir);
    expect(d.allow).toBe(true);
    if (d.allow) { expect(d.kind).toBe('pkg'); if (d.kind === 'pkg') expect(d.cmd).toBe('npm'); }
  });

  it('allowlist 등록된 skill = allow(kind:registry·sourcePath)', () => {
    const policy = makeSelfProvisionPolicy(makeAllowlistResolver([{ layer: 'skill', name: 'omni-market', sourcePath: '/src/omni-market' }]));
    const d = policy({ layer: 'skill', spec: 'omni-market' }, dir);
    expect(d.allow).toBe(true);
    if (d.allow) { expect(d.kind).toBe('registry'); if (d.kind === 'registry') { expect(d.regLayer).toBe('skill'); expect(d.sourcePath).toBe('/src/omni-market'); } }
  });

  it('⚠️ deny-all 기본 = 미allowlist skill/subagent 전부 거부(실행권 확대 안전 기본값)', () => {
    const policy = makeSelfProvisionPolicy(denyAllArtifactResolver);
    for (const layer of ['skill', 'subagent'] as const) {
      const d = policy({ layer, spec: 'anything' }, dir);
      expect(d.allow).toBe(false);
      if (!d.allow) expect(d.reason).toContain('allowlist 밖');
    }
  });

  it('안전하지 않은 역량명 = 거부(resolver 도달 전)', () => {
    let resolverCalled = false;
    const policy = makeSelfProvisionPolicy(() => { resolverCalled = true; return '/x'; });
    const d = policy({ layer: 'skill', spec: '../evil' }, dir);
    expect(d.allow).toBe(false);
    expect(resolverCalled).toBe(false); // 이름 게이트가 먼저
  });

  it('mcp 등 나머지 계층 = 미지원 defer', () => {
    const policy = makeSelfProvisionPolicy(makeAllowlistResolver([]));
    const d = policy({ layer: 'mcp', spec: 'some-server' }, dir);
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toContain('후속');
  });
});

describe('provisionCapability registry 분기 (self skill/subagent·install seam)', () => {
  let dir = '';
  beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'prov-reg-'))); writeFileSync(join(dir, 'package.json'), '{}'); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('registry 허용 → installRegistry 호출(argv run 미호출) → installed detail', async () => {
    let installed: { regLayer: string; name: string; sourcePath: string } | null = null;
    let ranArgv = false;
    const res = await provisionCapability({ layer: 'skill', spec: 'omni-market' }, {
      cwd: dir,
      policy: makeSelfProvisionPolicy(makeAllowlistResolver([{ layer: 'skill', name: 'omni-market', sourcePath: '/src/omni-market' }])),
      run: async () => { ranArgv = true; return { status: 0, out: '' }; },
      installRegistry: async (regLayer, name, sourcePath) => { installed = { regLayer, name, sourcePath }; return { ok: true, detail: 'skill 설치·리로드. 다시 시도하라.' }; },
    });
    expect(res.ok).toBe(true);
    expect(res.action).toBe('installed');
    expect(ranArgv).toBe(false);                              // 레지스트리 경로 = argv 실행 안 함
    expect(installed).not.toBeNull();
    expect(installed!).toMatchObject({ regLayer: 'skill', name: 'omni-market', sourcePath: '/src/omni-market' });
  });

  it('registry 설치 실패 → error + 진행 안내', async () => {
    const res = await provisionCapability({ layer: 'subagent', spec: 'critic' }, {
      cwd: dir,
      policy: makeSelfProvisionPolicy(makeAllowlistResolver([{ layer: 'subagent', name: 'critic', sourcePath: '/src/critic.md' }])),
      installRegistry: async () => ({ ok: false, detail: '설치 소스 미존재' }),
    });
    expect(res.ok).toBe(false);
    expect(res.action).toBe('error');
    expect(res.detail).toContain('다른 방법으로 진행');
  });

  it('registry detail 도 PTY 재주입 sanitize(제어문자/ANSI 제거)', async () => {
    const res = await provisionCapability({ layer: 'skill', spec: 'omni-market' }, {
      cwd: dir,
      policy: makeSelfProvisionPolicy(makeAllowlistResolver([{ layer: 'skill', name: 'omni-market', sourcePath: '/x' }])),
      installRegistry: async () => ({ ok: true, detail: 'done\n\x1b[31mred\x1b[0m\r\ninjected' }),
    });
    expect(res.detail).not.toMatch(/[\x00-\x1f\x7f]/);
    expect(res.detail).not.toContain('\x1b');
  });

  it('deny-all 기본 정책(resolve 미주입) → registry 거부·install 미호출', async () => {
    let installCalled = false;
    const res = await provisionCapability({ layer: 'skill', spec: 'omni-market' }, {
      cwd: dir,
      policy: makeSelfProvisionPolicy(denyAllArtifactResolver),
      installRegistry: async () => { installCalled = true; return { ok: true, detail: 'x' }; },
    });
    expect(res.action).toBe('denied');
    expect(installCalled).toBe(false);
  });
});

describe('buildSelfProvision 배선(DI behavior)', () => {
  it('repoRoot → cwd·self 정책 배선·installRegistry 전달', async () => {
    let gotDeps: ProvisionDeps | null = null;
    const cb = buildSelfProvision({
      repoRoot: '/elanous/repo',
      resolve: makeAllowlistResolver([{ layer: 'skill', name: 'x', sourcePath: '/s/x' }]),
      provisioner: async (_req, deps) => { gotDeps = deps; return { ok: true, layer: 'skill', spec: 'x', action: 'installed', detail: 'ok' }; },
      installRegistry: async () => ({ ok: true, detail: 'ok' }),
    });
    await cb({ layer: 'skill', spec: 'x' });
    expect(gotDeps).not.toBeNull();
    expect(gotDeps!.cwd).toBe('/elanous/repo');           // repoRoot 가 cwd 로 배선
    expect(gotDeps!.policy).toBeDefined();               // self 정책 배선
    expect(gotDeps!.installRegistry).toBeDefined();      // install seam 전달
  });

  it('resolve 미주입 → deny-all(skill/subagent 자율설치 전면차단·안전기본값)', async () => {
    const cb = buildSelfProvision({ repoRoot: '/elanous/repo' }); // resolve 없음
    const res = await cb({ layer: 'skill', spec: 'anything' });
    expect(res.action).toBe('denied');
  });
});

describe('planSelfProvision (CLI dry-run 계획·순수·exit code)', () => {
  let dir = '';
  beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'prov-plan-'))); writeFileSync(join(dir, 'package.json'), '{}'); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('skill + source → 허용(kind:registry)·exitCode 0', () => {
    const p = planSelfProvision('skill', 'mytool', '/src/mytool', dir);
    expect(p.decision.allow).toBe(true);
    if (p.decision.allow) expect(p.decision.kind).toBe('registry');
    expect(p.exitCode).toBe(0);
  });

  it('⚠️ skill source 없음 → deny-all 거부·exitCode 1(자동화가 성공 오인 방지·must-fix)', () => {
    const p = planSelfProvision('skill', 'mytool', undefined, dir);
    expect(p.decision.allow).toBe(false);
    expect(p.exitCode).toBe(1);   // ★ 거부는 반드시 non-zero
  });

  it('pkg → 매니저 감지 허용(kind:pkg)·exitCode 0·source 무관', () => {
    const p = planSelfProvision('pkg', 'lodash', undefined, dir);
    expect(p.decision.allow).toBe(true);
    if (p.decision.allow) expect(p.decision.kind).toBe('pkg');
    expect(p.exitCode).toBe(0);
  });

  it('pkg + 매니페스트 없는 루트 → 거부·exitCode 1', () => {
    const empty = realpathSync(mkdtempSync(join(tmpdir(), 'prov-empty-')));
    try {
      const p = planSelfProvision('pkg', 'lodash', empty, empty);
      expect(p.decision.allow).toBe(false); // 매니저 미감지
      expect(p.exitCode).toBe(1);
    } finally { rmSync(empty, { recursive: true, force: true }); }
  });

  it('pkg 는 source 로 allowlist 안 열림(pkg 는 defaultProvisionPolicy 경로) — deny-all resolve 여도 허용', () => {
    // source 는 skill/subagent 전용 — pkg 에 source 를 줘도 resolve 는 deny-all 이지만 pkg 는 resolve 무관 허용.
    const p = planSelfProvision('pkg', 'lodash', '/irrelevant', dir);
    expect(p.decision.allow).toBe(true);
  });
});
