import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import blueprint from '../../src/mission-blueprints/req-v1-10a9d92906d400c4.js';
import { loadMissionBlueprint } from '../../src/mission-blueprints/loader.js';
import { capabilityProviders } from '../../src/mission-capabilities/registry.js';

function git(root: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function repo(withCommit: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'bp-landing-'));
  git(root, 'init', '-q');
  if (withCommit) {
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'user.name', 'test');
    writeFileSync(join(root, 'a.txt'), 'a\n');
    git(root, 'add', 'a.txt');
    git(root, 'commit', '-q', '-m', 'first');
  }
  return root;
}
const ctxFor = (root: string) => ({ authorityRoot: root, capabilities: new Map(capabilityProviders.map(p => [p.id, p])), signal: AbortSignal.timeout(30_000) });

describe('req:v1:10a9d92906d400c4 블루프린트', () => {
  test('요청 프론트매터의 requires 를 덮고 id 가 같다', () => {
    const source = readFileSync(resolve(import.meta.dir, '../../docs/mission-requests/req-v1-10a9d92906d400c4.md'), 'utf8');
    expect(source).toContain('id: req:v1:10a9d92906d400c4');
    expect(blueprint.id).toBe('req:v1:10a9d92906d400c4');
    expect(blueprint.requires.map(c => c.id)).toEqual(['report.landingcount']);
    expect(source).toContain('requires: [report.landingcount]');
  });

  test('로더가 «검증을 통과»시켜 ready 로 준다', async () => {
    // ⛔ 「이 저장소에 최근 커밋이 있다」를 전제하지 «않는다» — 시간·체크아웃에 따라 비결정적으로 빨개진다(리뷰 8R).
    //   ⇒ probe 를 «제어»해 로더의 검증 ⑴~⑸ 만 본다.
    const loaded = await loadMissionBlueprint({
      authorityRoot: resolve(import.meta.dir, '../..'),
      requestId: 'req:v1:10a9d92906d400c4',
      requestRequires: [{ id: 'report.landingcount' }],
      catalog: [{ id: 'report.landingcount', async probe() { return { ok: true } as const; } }],
    } as never);
    expect((loaded as { status: string }).status).toBe('ready');
  });

  test('착지가 있는 트리를 주면 «그 트리»의 수를 낸다', async () => {
    const root = repo(true);
    try {
      const out = await blueprint.run(ctxFor(root) as never);
      expect(out.ok).toBe(true);
      expect(out.measured.landed).toBe(1);
      expect(out.measured.root).toBe(root);
      expect(out.body).toContain('1건');
      // ⛔ 요청 intent 가 「한 줄로 보고」다.
      expect(out.body.split('\n')).toHaveLength(1);
      expect(out.body).not.toBe('');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('착지가 없는 트리를 주면 «판정 불가»를 내고 body 가 비지 않는다', async () => {
    const root = repo(false);
    try {
      const out = await blueprint.run(ctxFor(root) as never);
      expect(out.ok).toBe(false);
      expect(out.body).toContain('판정 불가');
      expect(out.body.length).toBeGreaterThan(0);
      expect(out.measured.landed).toBe('unmeasurable');
      // ⛔ 카탈로그 provider 는 «도는 트리»에 묶여 있어 ok 다 — 그런데도 리포트는 «준 트리»를 따른다.
      expect(out.body).toContain(root);
      expect(out.measured.root).toBe(root);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('git 저장소가 아닌 트리를 주면 던지지 않고 판정 불가로 낸다', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bp-nogit-'));
    mkdirSync(join(root, 'x'), { recursive: true });
    try {
      const out = await blueprint.run(ctxFor(root) as never);
      expect(out.ok).toBe(false);
      expect(out.body).toContain('판정 불가');
      expect(out.body.split('\n')).toHaveLength(1);
      // ⛔ 이 경로에도 「잰 트리」가 있어야 한다 — 한 경로라도 빠지면 그 실패가 조용하다.
      expect(out.body).toContain(root);
      expect(out.measured.root).toBe(root);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('«모든» 산출이 자기가 잰 트리를 담는다 — 성공·착지0·읽기실패 셋 다', async () => {
    const filled = repo(true); const empty = repo(false);
    const nogit = mkdtempSync(join(tmpdir(), 'bp-nogit2-'));
    try {
      for (const [root, ok] of [[filled, true], [empty, false], [nogit, false]] as const) {
        const out = await blueprint.run(ctxFor(root) as never);
        expect(out.ok).toBe(ok);
        expect(out.body).toContain(root);
        expect(out.measured.root).toBe(root);
        expect(out.body.split('\n')).toHaveLength(1);
      }
    } finally {
      for (const d of [filled, empty, nogit]) rmSync(d, { recursive: true, force: true });
    }
  });

  test('줄바꿈이 든 트리 이름에서도 «세 경로 모두» 한 줄이다', async () => {
    // ⛔ 1판은 «성공 경로만» 두 번 쳤다(하위 디렉토리가 상위 저장소를 상속했다) — 리뷰 10R 이 잡았다.
    //   ⇒ 성공 · 착지 0 · git 아님 «셋 다» 줄바꿈이 든 root 로 친다.
    // ⛔ LF «만» 치면 CR·U+2028·U+2029 정규화가 시험되지 않는다(리뷰 11R) ⇒ 경로마다 «다른» 구분자를 쓴다.
    const okRoot = join(mkdtempSync(join(tmpdir(), 'bp-nl-ok-')), 'a\nb');
    const emptyRoot = join(mkdtempSync(join(tmpdir(), 'bp-nl-empty-')), 'a\rb');
    const nogitRoot = join(mkdtempSync(join(tmpdir(), 'bp-nl-nogit-')), 'a\u2028b');
    mkdirSync(okRoot, { recursive: true }); mkdirSync(emptyRoot, { recursive: true }); mkdirSync(nogitRoot, { recursive: true });
    git(okRoot, 'init', '-q');
    git(okRoot, 'config', 'user.email', 'test@example.com');
    git(okRoot, 'config', 'user.name', 'test');
    writeFileSync(join(okRoot, 'a.txt'), 'a\n');
    git(okRoot, 'add', 'a.txt');
    git(okRoot, 'commit', '-q', '-m', 'first');
    git(emptyRoot, 'init', '-q');
    try {
      const outcomes = await Promise.all([okRoot, emptyRoot, nogitRoot].map(root => blueprint.run(ctxFor(root) as never)));
      expect(outcomes.map(o => o.ok)).toEqual([true, false, false]);
      for (const out of outcomes) expect(out.body.split('\n')).toHaveLength(1);
    } finally {
      for (const d of [okRoot, emptyRoot, nogitRoot]) rmSync(join(d, '..'), { recursive: true, force: true });
    }
  });
});