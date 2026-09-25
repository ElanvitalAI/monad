import { describe, expect, test } from 'bun:test';

import { SLASH_COMMANDS } from '../src/chat/index.js';

describe('/tablet command registration', () => {
  test('SLASH_COMMANDS exposes browser-preview modal subcommands', () => {
    const cmd = SLASH_COMMANDS.find(c => c.name === 'tablet');
    expect(cmd).toBeDefined();
    expect(cmd!.subcommands).toContain('browser-preview');
    expect(cmd!.subcommands).toContain('bp');
  });
});
