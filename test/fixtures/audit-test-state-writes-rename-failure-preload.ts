import { mock } from 'bun:test';
import * as fs from 'node:fs';

mock.module('node:fs', () => ({
  ...fs,
  renameSync(): never {
    throw new Error('injected rename failure');
  },
}));
