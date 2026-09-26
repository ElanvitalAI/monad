# Codex subscription (ChatGPT login)

Codex supports the official ChatGPT device-code flow (no API key needed —
uses your ChatGPT account):

```bash
elanous login openai-codex      # opens browser + waits for code entry
elanous login status            # list providers with tokens on file
elanous login logout openai-codex   # forget tokens
```

Flow: request user code → print `https://auth.openai.com/codex/device`
and a short code → you enter it in any browser → the CLI polls until
you finish (max 15min, Ctrl+C cancels) → tokens persist to
`~/.elanous/auth.json` (chmod 0o600) and mirror to
`~/.codex/auth.json` so the official Codex CLI stays in sync.

Access tokens auto-refresh when within 120s of expiry. Refresh tokens
rotate single-use per OpenAI's OAuth policy — elanous always writes the
new pair to both locations so no manual sync is needed.

When OAuth tokens are present, the provider uses
`https://chatgpt.com/backend-api/codex` as the base URL. When only an
`apiKey` is set (fallback mode), it uses `https://api.openai.com/v1`.
Both are recognized automatically.

## Subscription first

The primary path for LLM access is a **subscription**, not an API key:

```bash
elanous login openai-codex             # ChatGPT device-code flow — no API key needed
elanous config set llm.provider openai-codex   # optional — auto already prefers it
elanous login status                   # which providers have tokens on file
elanous usage                          # quota and subscription state per account
```

With `llm.provider = auto` (2026-09-24 decision) every selection path picks
the Codex subscription first; account rotation moves between signed-in Codex
accounts by remaining quota, and when none is left the fallback follows
`llm.fallbackChain` before any other keyed provider. The second line above is
optional — it pins Codex explicitly.

⚠️ `elanous usage` may report `unavailable (auth)` for codex even when login
succeeded and the harness runs fine — it queries the Codex CLI mirror
(`~/.codex/auth.json`), a different axis from the token elanous itself uses
(`~/.elanous/auth.json`). Do not read that line as "the credential does not work".

⚠️ The harness also shells out to `gh` for pull-request lookups. Without it,
base-branch selection degrades to the default branch and says so
(`base-selection=pr-lookup-failed`); nothing crashes, but install the GitHub
CLI if you want the harness to open and track pull requests.

⛔ **On Linux the harness additionally needs the Codex CLI itself.** `elanous
login openai-codex` stores a token for elanous's own LLM layer but prints, and
means, this:

> *Codex CLI mirror was not created because this login response lacked its
> required fields; run `codex login` once to initialize `~/.codex/auth.json`.*

Measured on 2026-09-20 on WSL2 Ubuntu with the token present and `codex`
absent: goal authoring, implement, gate and review all completed — and then
the run died with `codex app-server stdin drain timeout after 5000ms`
(`src/acp/codex-app-server-client.ts`), because the ACP delegate spawns the
Codex CLI's app-server. The postmortem then classified the abort as
`quota-exhausted`, since the Codex *rotation snapshot* is empty when the CLI
mirror does not exist — a correlation the code itself labels as such, but one
that reads as "you ran out of quota" when in fact the CLI was never installed.
