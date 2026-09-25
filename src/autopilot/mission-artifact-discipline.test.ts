// ── mission-artifact-discipline — 산출물 규율(artifact-first)·대표 2026-07-13 ──
import { describe, it, expect } from 'bun:test';
import { extractRequiredArtifacts, artifactFirstInstruction } from './mission-artifact-discipline.js';

describe('extractRequiredArtifacts', () => {
  it('백틱 감싼 .artifacts 경로를 추출한다', () => {
    const t = '결과는 `.artifacts/investment-deep-research.json`으로 한정하며 코드는 변경하지 않는다.';
    expect(extractRequiredArtifacts(t)).toEqual(['.artifacts/investment-deep-research.json']);
  });
  it('여러 경로를 등장 순서로·중복 제거해 추출한다', () => {
    const t = 'A는 .artifacts/a.json, B는 .artifacts/b.md 에. 다시 .artifacts/a.json 확인.';
    expect(extractRequiredArtifacts(t)).toEqual(['.artifacts/a.json', '.artifacts/b.md']);
  });
  it('확장자 화이트리스트 밖·비-.artifacts 경로는 무시한다', () => {
    const t = 'src/foo.ts 를 읽고 .artifacts/report.xyz 는 무시, .artifacts/ok.csv 만.';
    expect(extractRequiredArtifacts(t)).toEqual(['.artifacts/ok.csv']);
  });
  it('산출물 언급이 없으면 빈 배열', () => {
    expect(extractRequiredArtifacts('코어 코드를 조사만 하고 산출물은 없다.')).toEqual([]);
    expect(extractRequiredArtifacts('')).toEqual([]);
  });
  it('문장부호가 뒤따라도 확장자에서 끊어 정확히 추출한다', () => {
    expect(extractRequiredArtifacts('저장: .artifacts/x.json. 끝.')).toEqual(['.artifacts/x.json']);
  });
});

describe('artifactFirstInstruction', () => {
  it('필수 산출물이 없으면 빈 문자열(주입 없음)', () => {
    expect(artifactFirstInstruction([])).toBe('');
  });
  it('산출물이 있으면 규율 지시문에 경로와 순서 규칙을 담는다', () => {
    const s = artifactFirstInstruction(['.artifacts/x.json']);
    expect(s).toContain('.artifacts/x.json');
    expect(s).toContain('artifact-first');
    expect(s).toContain('먼저 저장');
    expect(s).toContain('VERDICT FAIL');
  });
  it('여러 산출물을 쉼표로 나열한다', () => {
    const s = artifactFirstInstruction(['.artifacts/a.json', '.artifacts/b.md']);
    expect(s).toContain('.artifacts/a.json, .artifacts/b.md');
  });
});
