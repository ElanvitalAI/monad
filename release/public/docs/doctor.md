# Doctor

`monad doctor` tells you what this machine still needs. It never changes anything unless you ask it to.

```bash
monad doctor
```

## What it reports

1. **Credentials** — for each key monad can use (for example `OPENAI_API_KEY`, `XAI_API_KEY`, `TELEGRAM_BOT_TOKEN`): whether it resolves, where it came from, which capability needs it, and the free alternative if there is one (often a subscription login such as `monad login openai-codex`).
2. **Tools** — the external commands monad calls (`rg`, `git`, `python3`, `ssh`, …) and whether each is on `PATH`. See [External commands](external-commands.md).
3. **Readiness** — one line per check, each ending in `ok`, `manual`, or a problem, with the fix at the end of the line. Checks include:

| Check | What it looks at |
|---|---|
| `provider-decision` | Which LLM provider is configured |
| `gh-auth` | Whether `gh auth status` succeeds (needed for pull requests) |
| `harness-tools` | `rg`, `codex` and `node` on `PATH` |
| `install-path` | Whether you run an installed copy or a checkout |
| `service-version` | Whether the background service runs the same version as this copy |
| `bun-version` | Whether your Bun matches the tested version |
| `service-file` · `service-secrets` | The service definition uses a stable path and carries no provider keys |
| `build-toolchain` · `node-pty` | The compiler and the terminal library load |
| `python-env` | The Python environment and its required modules |
| `docker` · `kubernetes` · `memory` | Optional container runtime, cluster and available memory |

The last line counts what is left to do.

## Fixing things

```bash
monad doctor --fix              # show the repairs it would make (read-only)
monad doctor --fix --yes        # apply them
monad doctor --fix --yes --sudo # also run the planned sudo install lines (only where sudo works without a password)
```

| Option | What it does |
|---|---|
| `--fix` | Show reversible repairs; read-only on its own |
| `--yes` | Apply the planned repairs (with `--fix`) |
| `--sudo` | Also run the planned `sudo` install lines, only where `sudo -n true` works (with `--fix --yes`) |
| `--restart` | Restart the background service when it runs a different version than this copy, then verify it (with `--fix --yes`; interrupts bots, terminals and running turns) |
| `--json` | Structured output |

⚠️ Some headings and remedies are still printed in Korean. The check names and the `ok` / `manual` status are in English.

See also: [Install](install.md) · [Troubleshooting](troubleshooting.md).
