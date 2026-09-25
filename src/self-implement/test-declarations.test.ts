import { describe, expect, test } from 'bun:test';
import { countTestDeclarations } from './test-declarations.js';

describe('countTestDeclarations', () => {
  test('줄 머리의 test/it 및 지원 변형만 센다', () => {
    expect(countTestDeclarations([
      "test('plain', () => {});",
      "it('plain', () => {});",
      "  test.only('only', () => {});",
      "it.skip('skip', () => {});",
      "test.todo('todo', () => {});",
      "it.if(true)('if', () => {});",
      "test.skipIf(true)('skipIf', () => {});",
      "it.todoIf(true)('todoIf', () => {});",
    ].join('\n'))).toBe(8);
  });

  test('줄 머리가 아니거나 지원하지 않는 형태는 세지 않는다', () => {
    expect(countTestDeclarations([
      "const nested = test('nested', () => {});",
      "contest('not-test', () => {});",
      "test.concurrent('unsupported', () => {});",
      "test ('space before call', () => {});",
    ].join('\n'))).toBe(1);
  });
});
