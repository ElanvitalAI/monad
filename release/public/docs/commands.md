# Commands you will use

`monad --help` lists everything; `monad <command> --help` shows the options of one command. This page covers the ones a user needs day to day.

## Getting set up

| Command | What it does |
|---|---|
| `monad doctor` | Report which credentials resolve and from where, plus a readiness section (provider, `gh` sign-in, `PATH`, background service version, Linux `TMPDIR`) — `--json` for machines |
| `monad doctor --fix` / `--fix --yes` | Show / apply the reversible repairs (the `PATH` block, key-cache permissions, the Linux `TMPDIR` block); startup files are backed up first |
| `monad setup` | Walk through missing setup steps (`--non-interactive` only reports) |
| `monad login openai-codex` | Sign in with a ChatGPT subscription |
| `monad login status` / `monad login logout <provider>` | List / forget stored sign-ins |
| `monad usage` | How much each account has left (subscription and credit are shown separately) |
| `monad where` | Which instance this process uses, and why |

## Getting work done

| Command | What it does |
|---|---|
| `monad harness say "<sentence>"` | Turn one sentence into a change: goal → worktree → tests → review → PR or branch |
| `monad harness ask <goal.md>` | Same, from a goal document you wrote |
| `monad harness plan "<sentence>"` | Write the plan (an RFC) without running it |
| `monad ask "<question>"` | One question, one answer, new session |
| `monad chat "<message>"` | One message in the current session |
| `monad agent "<task>"` | One turn with file and shell tools |
| `monad repl` | Multi-turn session in the shell |
| `monad` | The terminal UI |

Useful `harness say` / `harness ask` options: `--dry-run` (plan only), `--no-auto-merge` (leave the PR for you), `--target <dir>` (work on another directory), `--child-llm-provider <id> --child-llm-model <id>` (pick the model that writes the code).

## Keeping an eye on it

| Command | What it does |
|---|---|
| `monad logs --since 30m` | Logs from every surface; filter with `--category`, `--event`, `--grep` |
| `monad harness worktrees` | Worktrees the harness made, and whether each is safe to remove |
| `monad harness clean` | Remove finished harness worktrees (dry run unless `--yes`; open PRs are always kept) |
| `monad ops status` | What the autonomous parts are doing right now |

## Settings and models

| Command | What it does |
|---|---|
| `monad config get [path]` / `monad config set <path> <value>` | Read / change settings (secrets are hidden) |
| `monad config path` | Which config file is active |
| `monad provider` | The active model provider, model and sign-in state |
| `monad tier` | Which model each tier (budget … best) maps to per provider |

## The background service

| Command | What it does |
|---|---|
| `monad nexus run` | Start the service (web app, chat bots, remote control) |
| `monad nexus status` / `monad nexus stop` | Check / stop it |
| `monad nexus install --launchd` (macOS) · `--systemd-user` (Linux) | Run it at login; API keys are read from the key cache, not written into the service file |
| `monad nexus build` | Build the web app (from a checkout — see [install](install.md#known-limits)) |
| `monad nexus restart-needed` | Say whether the running service needs a restart, only a web-app build, or nothing (exit 0 none · 10 build · 11 restart · 2 unknown) |
| `monad self-update [--restart]` | Install the current checkout, then restart the service only if it is needed and you passed `--restart` |
