// W9d-FU Z15.b — source-grep guards for the nexus/index.ts boot wire.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = resolve(HERE, '..', '..', 'src', 'nexus', 'index.ts');
const SOURCE = readFileSync(INDEX_PATH, 'utf8');

describe('nexus/index.ts · devices-boot wire (W9d-FU Z15.b)', () => {
  test('imports buildDevicesSubstrate + stopDevicesSubstrate + DevicesSubstrate', () => {
    expect(SOURCE).toMatch(/import\s*\{\s*buildDevicesSubstrate[\s\S]*?stopDevicesSubstrate[\s\S]*?type\s+DevicesSubstrate[\s\S]*?\}\s*from\s*'\.\.\/mission-templates\/devices-boot\.js'/);
  });

  test('declares function-level devicesSubstrateHandle', () => {
    expect(SOURCE).toMatch(/let\s+devicesSubstrateHandle\s*:\s*DevicesSubstrate\s*\|\s*undefined/);
  });

  test('boot path forwards outboundSubstrate.router into buildDevicesSubstrate', () => {
    expect(SOURCE).toMatch(/buildDevicesSubstrate\(\{[\s\S]*?outboundSubstrate\?\.router[\s\S]*?\}\)/);
  });

  test('shutdown path invokes stopDevicesSubstrate before httpServer.stop()', () => {
    const match = SOURCE.match(/stopDevicesSubstrate\(devicesSubstrateHandle\)[\s\S]*?httpServer\?\.stop\(\)/);
    expect(match).not.toBeNull();
  });

  test('boot path surfaces skipReason via console.warn', () => {
    expect(SOURCE).toMatch(/console\.warn\(`\[nexus\] devices cron skipped/);
  });

  test('boot path surfaces success via console.info', () => {
    expect(SOURCE).toMatch(/console\.info\('\[nexus\] devices fleet cron started/);
  });
});
