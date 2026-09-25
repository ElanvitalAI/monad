import { homedir } from 'node:os';
import { join } from 'node:path';

export function promptBankDataDir(): string {
  const base = process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.trim()
    ? process.env.XDG_DATA_HOME
    : join(homedir(), '.local', 'share');
  return join(base, 'monad');
}

export function promptBankDbPath(): string {
  return join(promptBankDataDir(), 'prompt-bank.sqlite');
}
