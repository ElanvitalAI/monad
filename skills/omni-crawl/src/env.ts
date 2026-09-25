import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
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
  const v = process.env[key]; if (!v) throw new Error(`필수 환경변수 누락: ${key}`); return v;
}

export function env(key: string, fallback = ''): string { return process.env[key] || fallback; }

// ── 1안: 키의 SSOT 는 «파일», env 는 «캐시» ────────────────────────────────
//
// ⛔⭐⭐ **왜 env 를 덮어쓰나** (2026-08-06 실측):
//   장수 프로세스(Claude Code 세션·nexus 데몬·launchd)는 **기동 시점의 env** 를 들고 산다.
//   `~/.config/api-key-setup/api-keys.zsh` 가 캐시 우선으로 이미 고쳐져 있어도 그것은
//   **새 셸에만** 먹고, 이미 뜬 프로세스엔 영영 안 닿는다.
//   ⇒ 실제로 8/4 에 뜬 세션이 **소진된 팀의 XAI 키**를 들고 403 을 받았고,
//     캐시·`.env` 의 키는 **200** 이었다. 같은 사건이 4일 전에도 났다(그 zsh 파일 주석).
//   ⇒ 그래서 `loadEnvFile` 의 «env 가 이기는» 규칙을 캐시 파일에는 **적용하지 않는다.**
//
// ⛔ 셸 파일과 **같은 규약**을 쓴다 — 둘이 갈리면 어느 쪽이 이겼는지 아무도 모른다:
//   ⓐ 캐시가 없거나 **비어 있으면 건드리지 않는다**(살아 있는 키를 지우지 않기 위해)
//   ⓑ `MONAD_KEEP_ENV_KEYS=1` 이면 env 를 그대로 둔다(임시로 다른 키를 쓰는 탈출구)
const KEY_CACHE_DIR = resolve(homedir(), '.cache');

/** 캐시 파일이 있는 키. 파일명 규약 = 환경변수명 소문자(`XAI_API_KEY` → `xai_api_key`). */
const CACHED_KEYS = [
  'GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY',
  'FIRECRAWL_API_KEY', 'SUPADATA_API_KEY', 'YOUTUBE_API_KEY', 'UPSTAGE_API_KEY',
  'BRAVE_API_KEY', 'ELEVENLABS_API_KEY', 'APIFY_TOKEN', 'EODHD_API_KEY',
] as const;

function readKeyCache(name: string): string | null {
  const path = resolve(KEY_CACHE_DIR, name.toLowerCase());
  if (!existsSync(path)) return null;
  try {
    const v = readFileSync(path, 'utf-8').trim().replace(/^["']|["']$/g, '');
    return v || null;
  } catch { return null; }
}

/** 캐시 파일 → `process.env` 로 **덮어쓴다**. 바뀐 키 이름만 돌려준다(호출부가 관측에 쓴다).
 *  ⭐ 한 키만 새로 읽고 싶으면 `only` 를 준다(2안의 재시도 경로가 이것을 쓴다). */
export function refreshKeysFromCache(only?: string): string[] {
  if (process.env.MONAD_KEEP_ENV_KEYS) return [];
  const targets = only ? [only] : [...CACHED_KEYS];
  const changed: string[] = [];
  for (const name of targets) {
    const cached = readKeyCache(name);
    if (cached === null) continue;              // ⓐ 없거나 비면 그대로 둔다
    if (process.env[name] === cached) continue;
    process.env[name] = cached;
    changed.push(name);
  }
  return changed;
}

export function initEnv(): void {
  loadEnvFile(resolve(SKILL_DIR, '.env'));
  loadEnvFile(resolve(SKILL_DIR, '..', 'grok', '.env'));
  loadEnvFile(resolve(SKILL_DIR, '..', 'omni-digest', '.env'));
  // ⭐ **맨 마지막**에 돈다 — 캐시가 `.env` 보다도 최신이다(둘 다 파일이지만 SSOT 는 캐시).
  const refreshed = refreshKeysFromCache();
  if (refreshed.length) console.log(`  [env] 캐시에서 키 갱신: ${refreshed.join(', ')} (낡은 셸 env 를 덮어씀)`);
}
