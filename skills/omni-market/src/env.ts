import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = resolve(__dirname, '..');

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const raw of readFileSync(filePath, 'utf-8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

export function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`필수 환경변수 누락: ${key}`);
  return v;
}

export function env(key: string, fallback = ''): string {
  return process.env[key] || fallback;
}

export function hasEnv(key: string): boolean {
  return !!process.env[key];
}

export function initEnv(): void {
  // Load omni-market's own .env
  loadEnvFile(resolve(SKILL_DIR, '.env'));
  // (죽은 경로 제거·monad C 2026-07-22) 종전 `../eodhd/.env` 상속은 `~/.claude/skills/eodhd/` 가
  // 존재하지 않아 항상 no-op 였음(existsSync false). 제거.
}
