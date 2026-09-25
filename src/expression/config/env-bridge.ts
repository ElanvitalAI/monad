// Env var → wizard answer fragment. Layer 4 of the 5-layer merge.
// Maps a small, curated set of `MONAD_*` env vars to the partial
// `UserConfig` shape so CI / Docker setups can run
// `MONAD_LLM_PROVIDER=openai MONAD_LLM_API_KEY=sk-... monad setup
// --non-interactive` and get a fully-configured machine without an
// answer file.
//
// The mapping is deliberately narrow — only the fields that benefit
// from environment-injection (provider keys, vault path). Larger
// shapes (skill-dir lists, telegram allowlists) belong in the answer
// file because env vars don't compose well for arrays.
//
// Empty / unset env vars produce no override; the field passes
// through from lower layers.

export interface EnvBridgeOptions {
  /** Override `process.env` — useful for tests. */
  env?: NodeJS.ProcessEnv;
}

/** Build a partial wizard answer from environment variables. Returns
 *  an empty object when no relevant vars are set. */
export function buildEnvOverrides(opts: EnvBridgeOptions = {}): Record<string, unknown> {
  const env = opts.env ?? process.env;
  const out: Record<string, unknown> = {};

  // ── LLM ─────────────────────────────────────────────────────────
  const llm: Record<string, unknown> = {};
  if (env.MONAD_LLM_PROVIDER) llm.provider = env.MONAD_LLM_PROVIDER;
  if (env.MONAD_LLM_API_KEY) llm.apiKey = env.MONAD_LLM_API_KEY;
  if (env.MONAD_LLM_MODEL) llm.model = env.MONAD_LLM_MODEL;
  if (env.MONAD_LLM_BASE_URL) llm.baseUrl = env.MONAD_LLM_BASE_URL;
  if (Object.keys(llm).length > 0) out.llm = llm;

  // ── Obsidian ────────────────────────────────────────────────────
  if (env.OBSIDIAN_VAULT) {
    out.obsidian = { vault: env.OBSIDIAN_VAULT };
  } else if (env.MONAD_OBSIDIAN_VAULT) {
    out.obsidian = { vault: env.MONAD_OBSIDIAN_VAULT };
  }

  // ── Telegram ────────────────────────────────────────────────────
  const telegram: Record<string, unknown> = {};
  if (env.MONAD_TELEGRAM_BOT_TOKEN) telegram.botToken = env.MONAD_TELEGRAM_BOT_TOKEN;
  if (env.MONAD_TELEGRAM_ENABLED === '1') telegram.enabled = true;
  if (env.MONAD_TELEGRAM_ENABLED === '0') telegram.enabled = false;
  if (Object.keys(telegram).length > 0) out.telegram = telegram;

  // ── Discord ─────────────────────────────────────────────────────
  const discord: Record<string, unknown> = {};
  if (env.MONAD_DISCORD_BOT_TOKEN) discord.botToken = env.MONAD_DISCORD_BOT_TOKEN;
  if (env.MONAD_DISCORD_ENABLED === '1') discord.enabled = true;
  if (env.MONAD_DISCORD_ENABLED === '0') discord.enabled = false;
  if (Object.keys(discord).length > 0) out.discord = discord;

  return out;
}
