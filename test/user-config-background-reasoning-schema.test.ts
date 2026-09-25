// W9e-FU U5 · user-config `background-reasoning.llm.*` parser.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUserConfig } from '../src/user-config';

let root: string;
let cfgPath: string;

function writeFile(json: unknown): void {
  writeFileSync(cfgPath, JSON.stringify(json));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'w9e-background-reasoning-'));
  cfgPath = join(root, 'config.json');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('background-reasoning.llm parser', () => {
  test('absent → backgroundReasoning undefined', () => {
    writeFile({});
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.backgroundReasoning).toBeUndefined();
  });

  test('full happy path → endpoint + model + apiKey all carried', () => {
    writeFile({
      backgroundReasoning: {
        llm: {
          endpoint: 'http://localhost:1234',
          entityModel: 'qwen-7b',
          embeddingModel: 'embed-mini',
          apiKey: 'sk-x',
        },
      },
    });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.backgroundReasoning?.llm).toEqual({
      endpoint: 'http://localhost:1234',
      entityModel: 'qwen-7b',
      embeddingModel: 'embed-mini',
      apiKey: 'sk-x',
    });
  });

  test('endpoint-only → other fields undefined', () => {
    writeFile({
      backgroundReasoning: { llm: { endpoint: 'http://localhost:1234' } },
    });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.backgroundReasoning?.llm).toEqual({ endpoint: 'http://localhost:1234' });
  });

  test('endpoint blank → backgroundReasoning undefined (sparse reject)', () => {
    writeFile({
      backgroundReasoning: { llm: { endpoint: '   ' } },
    });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.backgroundReasoning).toBeUndefined();
  });

  test('endpoint missing → backgroundReasoning undefined', () => {
    writeFile({
      backgroundReasoning: { llm: { entityModel: 'x' } },
    });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.backgroundReasoning).toBeUndefined();
  });

  test('endpoint string trimmed', () => {
    writeFile({
      backgroundReasoning: { llm: { endpoint: '  http://x  ' } },
    });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.backgroundReasoning?.llm.endpoint).toBe('http://x');
  });

  test('non-object llm field → backgroundReasoning undefined', () => {
    writeFile({
      backgroundReasoning: { llm: 'not-an-object' },
    });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.backgroundReasoning).toBeUndefined();
  });

  test('llm field is an array → backgroundReasoning undefined', () => {
    writeFile({
      backgroundReasoning: { llm: [] },
    });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.backgroundReasoning).toBeUndefined();
  });

  test('blank string fields dropped (model + apiKey optional)', () => {
    writeFile({
      backgroundReasoning: { llm: {
        endpoint: 'http://x',
        entityModel: '   ',
        embeddingModel: '',
        apiKey: '',
      } },
    });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.backgroundReasoning?.llm).toEqual({ endpoint: 'http://x' });
  });
});
