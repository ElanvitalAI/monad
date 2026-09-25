import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gateAnswer } from './jev.js';
import { decideByRecipe, missingStateKeys, parseRecipe, RecipeError } from './recipe.js';

const RECIPE_DIR = join(import.meta.dir, '..', '..', 'recipes');
const R = (extra: Record<string, unknown> = {}) => parseRecipe(JSON.stringify({
  name: 'r', description: 'd', requiredStateKeys: ['cmd'],
  questions: { q: { type: 'noul', instructions: 'i' } }, ...extra,
}));

describe('recipe — ⛔ 「Claude 없이 도는 결정」의 장치', () => {
  test('⭐ 저장소의 레시피가 «전부» 파싱된다 — 지어낸 픽스처가 아니라 실물을 문다', () => {
    const files = readdirSync(RECIPE_DIR).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) {
      const r = parseRecipe(readFileSync(join(RECIPE_DIR, f), 'utf8'), f.replace('.json', ''));
      expect(Object.keys(r.questions).length).toBeGreaterThan(0);
      expect(r.description).not.toBe('');           // 사람이 읽을 한 줄이 있어야 한다
      expect(r.requiredStateKeys.length).toBeGreaterThan(0); // ⛔ 필수 칸 없는 레시피는 state 를 안 검사한다
    }
  });

  test('⛔ options/levels 를 레시피 단계에서 막는다', () => {
    expect(() => R({ questions: { q: { type: 'choice', instructions: 'i', options: ['a'] } } }))
      .toThrow(/options\/levels/);
  });

  test('⛔ 틀린 type 을 «질문 이름»과 함께 거부한다', () => {
    expect(() => R({ questions: { bad: { type: 'boolean', instructions: 'i' } } }))
      .toThrow(/r\.questions\.bad\.type 이 'boolean'/);
  });

  test('⭐ 필수 칸이 비면 «이름으로» 돌려준다 — 모른다를 접지 않는다', () => {
    const r = R();
    expect(missingStateKeys(r, { cmd: 'ls' })).toEqual([]);
    expect(missingStateKeys(r, { cmd: '' })).toEqual(['cmd']);
    expect(missingStateKeys(r, {})).toEqual(['cmd']);
    expect(missingStateKeys(r, 'just a string')).toEqual(['cmd']);   // 구조화 안 된 state
  });

  test('⭐⭐ 레시피가 «이름으로» 지정한 위험 답이 임계보다 «먼저» 사유가 된다', () => {
    const r = R({ gate: { escalateWhenNoulAbove: { q: 0.4 } } });
    const d = decideByRecipe(r, { q: { type: 'noul', noul: 0.55 } }, gateAnswer as never);
    expect(d.verdict).toBe('escalate');
    expect(d.reasons[0]).toContain('레시피가 위험으로 지정한 답');   // ⛔ 첫 사유가 구체적이어야 한다
  });

  test('위험 답이 임계 밑이면 일반 임계로만 판정한다', () => {
    const r = R({ gate: { escalateWhenNoulAbove: { q: 0.4 } } });
    expect(decideByRecipe(r, { q: { type: 'noul', noul: 0.02 } }, gateAnswer as never).verdict).toBe('act');
    // 0.5 부근은 «어느 쪽도 아니다» ⇒ 일반 임계가 잡는다
    expect(decideByRecipe(r, { q: { type: 'noul', noul: 0.35 } }, gateAnswer as never).verdict).toBe('escalate');
  });

  test('한 질문이라도 갈리면 전체가 escalate 다', () => {
    const r = R({ questions: { a: { type: 'noul', instructions: 'i' }, b: { type: 'noul', instructions: 'i' } } });
    const d = decideByRecipe(r, { a: { type: 'noul', noul: 0.01 }, b: { type: 'noul', noul: 0.5 } }, gateAnswer as never);
    expect(d.verdict).toBe('escalate');
    expect(d.reasons.some((x) => x.startsWith('b:'))).toBe(true);
  });

  test('name 이 없으면 파일명을 쓴다', () => {
    const r = parseRecipe('{"questions":{"q":{"type":"noul","instructions":"i"}}}', 'from-file');
    expect(r.name).toBe('from-file');
    expect(() => parseRecipe('{"questions":{"q":{"type":"noul","instructions":"i"}}}')).toThrow(RecipeError);
  });
});
