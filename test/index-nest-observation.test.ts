import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('CLI main은 store sink 등록 전 nest boot 관측을 발화하지 않는다', () => {
  const source = readFileSync(join(process.cwd(), 'src/index.ts'), 'utf8');
  expect(source).not.toContain('observeNestAtBoot');
});
