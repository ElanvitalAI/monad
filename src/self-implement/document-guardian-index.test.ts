import { describe, expect, test } from 'bun:test';
import { buildDocumentGuardianIndex, formatDocumentGuardians } from './document-guardian-index.js';

const build = (files: Record<string, string>, docs: readonly string[]) =>
  buildDocumentGuardianIndex('/repo', Object.keys(files), docs, (path) => {
    const key = path.replace('/repo/', '');
    if (!(key in files)) throw new Error('ENOENT');
    return files[key]!;
  });

describe('buildDocumentGuardianIndex — 「유도」가 아니라 «스캔»이다', () => {
  test('⭐ 이름이 «안 닮아도» 찾는다 — AGENTS.md ← rules-contract.test.ts', () => {
    const index = build({
      'test/rules-contract.test.ts': "readFileSync(join(REPO, 'AGENTS.md'), 'utf8');",
    }, ['AGENTS.md']);

    expect(index.guardiansByDocument.get('AGENTS.md')).toEqual(['test/rules-contract.test.ts']);
    expect(index.unreadableTests).toBe(0);
  });

  test('⛔ 「읽지 않는」 시험은 지킴이가 «아니다» — 단순 언급은 안 센다', () => {
    const index = build({
      'test/mentions.test.ts': "// 이 시험은 AGENTS.md 를 설명만 한다\nconst note = 'AGENTS.md';",
    }, ['AGENTS.md']);

    expect(index.guardiansByDocument.get('AGENTS.md')).toBeUndefined();
  });

  // 📏 실측: basename 으로 세면 문서 75개가 «같은 13개» 시험에 걸렸다.
  test('🚨⭐ basename 이 «같아도» 다른 경로면 안 센다 — README 함정', () => {
    const index = build({
      'test/scaffold.test.ts': "readFileSync('/repo/README.md', 'utf8'); const seed = 'README.md';",
    }, ['apps/pwa/README.md']);

    expect(index.guardiansByDocument.get('apps/pwa/README.md')).toBeUndefined();
  });

  test('한 문서에 지킴이가 «여럿»이면 다 싣는다', () => {
    const index = build({
      'test/a.test.ts': "readFileSync('DESIGN.md');",
      'test/b.test.ts': "readFileSync('DESIGN.md');",
    }, ['DESIGN.md']);

    expect(index.guardiansByDocument.get('DESIGN.md')).toEqual(['test/a.test.ts', 'test/b.test.ts']);
  });

  test('⛔ 바뀐 문서가 없으면 시험을 «안 훑는다» — 헛일을 안 한다', () => {
    let reads = 0;
    const index = buildDocumentGuardianIndex('/repo', ['test/a.test.ts'], [], () => { reads += 1; return ''; });
    expect(reads).toBe(0);
    expect(index.guardiansByDocument.size).toBe(0);
  });

  test('🚨⭐ 못 읽은 시험을 «값으로» 센다 — 「지킴이 없음」과 섞지 않는다', () => {
    const index = buildDocumentGuardianIndex('/repo', ['test/gone.test.ts'], ['AGENTS.md'], () => {
      throw new Error('ENOENT');
    });

    expect(index.guardiansByDocument.get('AGENTS.md')).toBeUndefined();
    expect(index.unreadableTests).toBe(1); // ⛔ 0 이 아니면 빈칸을 「없다」로 읽으면 안 된다
  });
});

describe('formatDocumentGuardians — ⛔ 「막는 문면」이 아니라 «보고 문면»', () => {
  test('지킴이가 있으면 이름을 댄다', () => {
    const index = build({ 'test/rules.test.ts': "readFileSync('AGENTS.md');" }, ['AGENTS.md']);
    expect(formatDocumentGuardians(index, ['AGENTS.md']))
      .toBe('document guardians: 1/1 (AGENTS.md ← test/rules.test.ts)');
  });

  test('없으면 «없다고» 말한다 — ⛔ 침묵하지 않는다', () => {
    const index = build({ 'test/other.test.ts': "readFileSync('X.md');" }, ['docs/orphan.md']);
    expect(formatDocumentGuardians(index, ['docs/orphan.md']))
      .toBe('document guardians: 0/1; without: docs/orphan.md');
  });

  test('문서 변경이 없으면 그렇게 말한다', () => {
    const index = build({}, []);
    expect(formatDocumentGuardians(index, [])).toBe('document guardians: (no documents changed)');
  });

  test('🚨⭐ 못 읽은 시험이 있으면 «같이» 낸다 — 빈칸을 오독하지 못하게', () => {
    const index = buildDocumentGuardianIndex('/repo', ['test/gone.test.ts'], ['docs/x.md'], () => {
      throw new Error('ENOENT');
    });
    expect(formatDocumentGuardians(index, ['docs/x.md']))
      .toBe('document guardians: 0/1; without: docs/x.md; unreadable tests: 1');
  });
});
