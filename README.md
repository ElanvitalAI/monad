# MonadAgent

> Named after Leibniz's monad — a self-contained individual that mirrors
> the whole. The agent observes itself, reasons about what it sees, and
> repairs itself; a person is called only when it cannot (一約之觀).

**A self-healing coding harness where eyes, hands, and memory all turn on
one sentence — an agent that develops agents.**

You describe a change in one sentence. monad writes the goal document,
creates an isolated git worktree, runs a child agent inside it, gates the
result with tests, reviews it unattended, and merges. You are called when
the system cannot converge — not at every step.

```bash
monad harness say "add a --json flag to the status command"
```

## What makes it different

Most agents do one of these well. monad's claim is that **all three
engage on a single request**.

| | What it means | The real commands |
|---|---|---|
| **Eyes** | Read another process's screen, the web, a live browser — without owning them | `monad pty snapshot <ref>` · firecrawl · omni-crawl · aside · CDP |
| **Hands** | Actually type — into files, and into someone else's TUI | tool loop (Read/Edit/Write/Bash) · `monad pty text\|key <ref>` |
| **Memory** | What it went through is loaded into the next turn automatically | `monad memory` · `monad self recall` |

Two more properties follow from that:

- **Rigid *and* dynamic.** The contract — gates, unattended review, the
  run ledger — is fixed. The path taken through it is not.
  ⚠️ Today these are *two* runtimes (the harness pipeline and
  `monad wf`'s DAG); connecting them is open work.
- **The eyes are partly borrowed.** Web and browser sight leans on paid
  services (firecrawl, grok inside omni-crawl, aside, CDP). monad records
  *what stops working without each one* in `catalog/resources.yaml`.
  ⚠️ 20 of 27 credentialed entries have that field empty today.

> Lineage: `sync-skills` → `skillpad` → a 3-pane TUI chassis → **this**.
> The TUI still ships and still works, but it is one surface among
> several (CLI, NEXUS/PWA dashboard, MCP, chat channels), not the point
> of the project.

## Other surfaces

- **Skill execution with inline attachments** — paste a path in your
  question (`summarize ~/Q3.pdf`) and the file is extracted,
  tokenized as `[PDF #1]`, and inlined before the LLM call. Images go
  multimodal (OpenAI `image_url`, Anthropic `source.type=base64`) when
  the routed model is vision-capable.
- **Multi-LLM routing** — Grok / Anthropic / OpenAI / local
  OpenAI-compatible, auto-selected by model prefix or first-available.
- **TUI** — a 3-pane layout (skills / preview / chat) that is a real file
  manager, not a chat with a sidebar. Plugins can remap what lives in
  each pane.

## The harness — how a sentence becomes a merged change

`monad` carries a **self-implementation harness**. You describe a change
in one sentence or one file; the harness writes a goal document, creates
an isolated git worktree, runs a child agent inside it, gates the result
with the test suite, and opens a pull request.

```bash
monad harness say "add a --json flag to the status command"   # one sentence
monad harness ask 내부 문서 `MY-ASK`                        # a written goal
monad harness plan "..."                                      # write an RFC, do not execute
monad harness worktrees                                       # what worktrees exist, and who owns them
```

What each run leaves behind, so a failure can be read afterwards:

- a **goal document** under `docs/goals/`
- an isolated **worktree** and branch, owned by the run id
- a **run ledger** entry (`monad self run-ledger <id>`)
- structured logs (`monad logs --category <c>`)

⚠️ The harness currently assumes it is operating on *this* repository in
several places — notably the default integrity gate runs
`bun bin/monad.mjs --help`, which does not exist in a foreign project.
Running the harness against another repository is **not supported yet**.

## Roadmap

- [ ] **Skill market search** — discover skills from a registry, install
  into `~/.claude/skills/` from the TUI.
- [ ] **Plugin system** — third-party panes with their own preview and
  action handlers; pane remapping via config.
- [ ] **Context persistence** — keep attached files across sessions
  (currently in-memory only).
- [ ] **Real-time tokenization** — detect paths while typing instead of
  on submit.

See `내부 문서 `IMPLEMENTED_FEATURES`` for the current shipped feature list.
See `MANUAL.md` for the full command reference / config schema / troubleshooting.
See `내부 문서 `PROJECT_GUIDE`` for a first-time reader's full project map,
architecture overview, and usage path.

## Quick start

### Install

`monadagent` is **not published to a registry yet**. Until it is, install
from a tarball built out of this repository:

```bash
git clone https://github.com/ElanvitalAI/monad && cd monad-agent
bun install
bun pm pack                           # → monadagent-<version>.tgz  (12.4 MB, 4,350 files)

cd /path/to/your/project
bun add /path/to/monadagent-<version>.tgz
bun node_modules/monadagent/bin/monad.mjs --version
```

`bun pm pack` is used rather than `npm pack` because monad requires Bun and
**not** Node (see [Requirements](#requirements)) — a Bun-only machine has no
`npm` on `PATH`. Both produce an identical file list (measured 2026-09-20:
4,350 files, zero differences); use whichever you have.

`node-pty` is an **optional** dependency and is skipped on Linux, which
ships no `linux-x64` prebuild for it. Nothing breaks: monad uses Bun's
native PTY, so `ptyAvailable()` is still true with `node-pty` absent.

Measured end to end on 2026-09-20 on WSL2 Ubuntu (Bun 1.4.2, **no Node
installed at all**): `bun add <tarball>` exits 0 with no error output,
installs the `monad` and `mda` binaries, and `monad --version`, `where`,
`config get` and `usage` all run with **zero credentials configured**.
`monad doctor` exits 0 as well — it is a report, not a gate.

### Find out what you still need

```bash
monad doctor        # every credential the code reads: is it resolved, and from where
```

`monad doctor` is a **report, not a gate** — it exits 0 even when nothing
is configured, because **nothing is required to boot**. `monad --version`,
`monad where`, `monad config get` and `monad usage` all work with zero
credentials. Each key you add unlocks one capability; see
[`.env.example`](.env.example), which names all of them and says which
have a free fallback.

The primary path for LLM access is a **subscription**, not an API key:

```bash
monad login openai-codex             # ChatGPT device-code flow — no API key needed
monad config set llm.provider openai-codex   # optional — auto already prefers it
monad login status                   # which providers have tokens on file
monad usage                          # quota and subscription state per account
```

With `llm.provider = auto` (2026-09-24 decision) every selection path picks
the Codex subscription first; account rotation moves between signed-in Codex
accounts by remaining quota, and when none is left the fallback follows
`llm.fallbackChain` before any other keyed provider. The second line above is
optional — it pins Codex explicitly.

⚠️ `monad usage` may report `unavailable (auth)` for codex even when login
succeeded and the harness runs fine — it queries the Codex CLI mirror
(`~/.codex/auth.json`), a different axis from the token monad itself uses
(`~/.monad/auth.json`). Do not read that line as "the credential does not work".

⚠️ The harness also shells out to `gh` for pull-request lookups. Without it,
base-branch selection degrades to the default branch and says so
(`base-selection=pr-lookup-failed`); nothing crashes, but install the GitHub
CLI if you want the harness to open and track pull requests.

⛔ **On Linux the harness additionally needs the Codex CLI itself.** `monad
login openai-codex` stores a token for monad's own LLM layer but prints, and
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

### External commands

Beyond Bun and git, monad spawns these. None are needed to boot; each gates
one capability. Counted from `src/` and `scripts/` on 2026-09-20:

| command | used for |
|---|---|
| `git`, `bun` | everything (required) |
| `gh` | pull requests, harness base selection |
| `rg` (ripgrep) | code search — **the test suite needs it too** |
| `codex` | ACP delegate / harness implement on the codex backend |
| `curl`, `ssh`, `rsync`, `unzip` | fetching, remote nodes, installers |
| `crontab` | scheduled missions |
| `ffmpeg`, `magick`, `sox`, `tesseract`, `chafa` | media / ad pipeline, OCR, terminal images |
| `python3` | a few skills |
| `open`, `say`, `osascript` | macOS only, and guarded by `process.platform` |

📏 A fresh WSL2 Ubuntu had **none** of `rg`, `gh`, `ffmpeg`, `zsh`, `java`,
`jq`, `codex`, `node` or `npm`. A full test run there produced 47
`Executable not found in $PATH` lines: `rg` ×31, `ffmpeg` ×4, `zsh` ×3,
`grok` ×1 (plus `gh` and `java` failures reported differently).

### Develop on monad itself

```bash
bun install
bun run src/index.ts        # dashboard (TUI)
bun test                    # full suite (4,199 test files) — see AGENTS.md for the gate discipline
```

Link the CLI so `monad` works anywhere:
```bash
bun link                    # in this repo
bun link monadagent         # in any other project (or just globally)
monad                       # launches the dashboard (interactive TUI)
monad nexus run             # launches the NEXUS daemon (PWA + meta-api · headless)
```

Or run the first-run wizard (persists to `~/.monad/config.json`):
```bash
monad setup
```

## Configuration

`~/.monad/config.json` holds user-level settings beyond env vars.
(Older builds wrote `~/.config/monad/config.json`; that path still appears in
the source but the live config directory is `~/.monad` — check yours with
`monad where`.)

| Section     | Purpose                                                                  |
|-------------|--------------------------------------------------------------------------|
| `llm`       | provider (`auto`/`grok`/`openai`/`anthropic`/`local`/`openai-codex`),    |
|             | `apiKey`, `model`, `baseUrl` (for local / codex proxies)                 |
| `skills`    | `activeSet` preset + `dirs[]` — scan multiple SKILL.md roots at once     |
| `obsidian`  | `vault` (absolute path)                                                  |
| `telegram`  | `enabled`, `botToken`, `allowedUsers[]`, `homeChannel`                   |
| `onboarding`| `completed`, `completedAt`, `version`                                    |

**Skill dir presets** — `claudecode` (`~/.claude/skills`), `opencode`
(`~/.config/opencode/skills`, default), `codex` (`~/.codex/skills`),
`hermes` (`~/.hermes/skills`), `openclaw` (`~/.openclaw/workspace/skills`),
or `custom` for your own paths. Multiple dirs can be scanned
simultaneously (first-dir-wins on name collisions).

Re-run the wizard any time: `monad setup`.

### OpenAI Codex OAuth

Codex supports the official ChatGPT device-code flow (no API key needed —
uses your ChatGPT account):

```bash
monad login openai-codex      # opens browser + waits for code entry
monad login status            # list providers with tokens on file
monad login logout openai-codex   # forget tokens
```

Flow: request user code → print `https://auth.openai.com/codex/device`
and a short code → you enter it in any browser → the CLI polls until
you finish (max 15min, Ctrl+C cancels) → tokens persist to
`~/.monad/auth.json` (chmod 0o600) and mirror to
`~/.codex/auth.json` so the official Codex CLI stays in sync.

Access tokens auto-refresh when within 120s of expiry. Refresh tokens
rotate single-use per OpenAI's OAuth policy — monad always writes the
new pair to both locations so no manual sync is needed.

When OAuth tokens are present, the provider uses
`https://chatgpt.com/backend-api/codex` as the base URL. When only an
`apiKey` is set (fallback mode), it uses `https://api.openai.com/v1`.
Both are recognized automatically.

## Sessions

Conversation history persists to `~/.local/share/monad/sessions/` as
append-only JSONL (one file per session), with an index at
`index.json`. The "active" session lives at
`~/.local/state/monad/active`.

```bash
monad session list                   # recent sessions (newest first)
monad session new                    # start a fresh one, mark active
monad session resume <idPrefix>      # resume by full id or short prefix
monad session show [idPrefix]        # print transcript of active / given session
monad session delete <idPrefix>      # remove a session

monad chat "hello world"             # one-shot turn in active session
monad chat --new "fresh topic"       # force a new session
```

`monad chat` streams the provider response to stdout and persists both
sides of the turn. Token budget is estimated (rough `chars/4` heuristic)
and surfaced in the footer line.

## Telegram

Set up in the wizard (step 4) or edit `config.json` directly:
```json
"telegram": {
  "enabled": true,
  "botToken": "123456:ABC...",         // from @BotFather
  "allowedUsers": [42, 100],           // from @userinfobot — first = owner
  "homeChannel": -1001234567890        // optional; for cron deliveries
}
```

Run the bot daemon (long-polling, Ctrl+C to exit):
```bash
monad telegram
```

Every incoming chat+thread maps to a per-conversation session. Messages
persist to the same session store as CLI chats; you can `monad session
list --source telegram` to audit. Replies chunk automatically at 4000
chars; `parameters.retry_after` on 429 is respected.

Unknown user IDs (not in `allowedUsers`) get a polite refusal and
nothing else. Empty allowlist = fail-open (solo-dev convenience).

## Discord voice channel

Discord now has two different voice-capable surfaces:

- text channel / DM voice attachments
- live voice channel round-trip

The live voice-channel path is configured from `voice.discord.voiceChannel`
in `~/.config/monad/config.json`:

```json
{
  "voice": {
    "discord": {
      "voiceChannel": {
        "enabled": true,
        "listenFilter": "caller",
        "leaveOnEmpty": true
      }
    }
  }
}
```

Recommended behavior:

- `enabled = true` enables the live voice-channel surface
- `listenFilter = "caller"` keeps the showroom flow single-speaker by default
- `leaveOnEmpty = true` auto-leaves when the caller exits

Run the bot:

```bash
monad discord run
```

In Discord:

1. Join a voice channel.
2. In a text channel on the same server, send `/voice-join <voice-channel-id>`.
3. Speak normally.
4. Use `/voice-leave` to exit.

Notes:

- The command channel becomes the transcript mirror target.
- Recent attachment-bearing messages in that same command channel become the sticky context source for subsequent voice turns.
- Discord keeps text output load-bearing: `👂 Listening…`, `🎙️ User: ...`, `🤖 ...`
- Voice turns are tagged before entering the ACP runner so the shared chat history keeps `guild / voice channel / speaker / filter` context.
- `MONAD_DISCORD_VOICE_CHANNEL`, `MONAD_DISCORD_VOICE_LISTEN_FILTER`, and `MONAD_DISCORD_VOICE_LEAVE_ON_EMPTY` still work as backward-compatible fallbacks, but user-config is preferred.

## Attachments

Drop a path inline in your question; the dashboard tokenizes, extracts,
and attaches it automatically:

| Extension | Kind  | Extractor                              | Byte cap      |
|-----------|-------|----------------------------------------|---------------|
| `.txt`    | text  | UTF-8 readFile                         | 20 KB         |
| `.md`     | md    | UTF-8 readFile                         | 20 KB         |
| `.pdf`    | pdf   | `pdf-parse` v2 (`PDFParse.getText`)    | 20 KB         |
| `.docx`   | docx  | `mammoth.extractRawText`               | 20 KB         |
| `.xlsx`   | xlsx  | `xlsx` → all sheets, first 100 rows ea | 20 KB         |
| `.png`    | image | sharp resize (1568×1568, JPEG ladder)  | 3 MB encoded  |
| `.jpg` `.jpeg` | image | same                              | 3 MB encoded  |
| `.gif`    | image | same (static frame)                    | 3 MB encoded  |
| `.webp`   | image | same                                   | 3 MB encoded  |

Text-kind attachments are prepended as labeled code-fenced sections
ahead of your question. Images ride as multimodal ContentBlocks when the
routed model is vision-capable (see `isLikelyVisionModel()`).

Paths accepted: absolute (`/path/to/f.pdf`), home-relative (`~/doc.pdf`),
`./` or `../`, and quoted (`"name with space.pdf"`). URLs are skipped.
Symlinks resolve to their canonical target (two links → one attachment).

## Slash commands

| Command | Alias | Purpose |
|---------|-------|---------|
| `/run-skill <name> [args]` | `/rs`, `/run` | Execute a SKILL.md |
| `/provider` | `/p` | List providers + availability |
| `/summarize-skill` | `/ss`, `/sum` | AI summary of the focused skill |
| `/context` | `/ctx` | Table of attached files |
| `/context clear [big]` | | Drop all attachments (or ≥100KB ones) |
| `/context drop <id>` | | Drop a single attachment |
| `/paste` | `/v` | Attach clipboard image (macOS) |
| `/sync` | `/s` | Enter sync mode |
| `/plugin list\|activate\|deactivate\|reload` | `/p`, `/plugins` | Manage plugins |
| `/clear` | `/cls` | Clear log pane (keeps attachments) |
| `/help` | `/?` | Keybinding overlay |
| `/quit` | `/q`, `/exit` | Exit |

### Argument autocomplete

After typing a command name and a space, Tab / Up / Down navigate
argument suggestions. Enter on an empty current arg accepts the
selection and submits. Prefix filter is live: `/plugin activate s` + Tab
completes to `sync` without scrolling.

- `/plugin <subcmd>` → list, activate, deactivate, reload
- `/plugin activate <name>` → every discovered plugin (built-in + user)
- `/context drop <id>` → attachment ids currently in the registry
- `/run-skill <name>` → skill directory names under `~/.claude/skills/`

### Log pane clipboard copy

With the log pane focused (backtick `` ` `` or Tab-cycle):

| Key / mouse | Action |
|---|---|
| `y` | Copy the most recent output block to the system clipboard |
| `Y` | Copy the entire log buffer |
| Right-click inside log pane | Copy the block under the mouse cursor |

Blocks are delimited by the blank separator lines the dashboard inserts
between prompts / responses. ANSI codes are stripped before writing so
the pasted text is plain.

### Terminal compatibility

MonadAgent uses SGR mouse reporting (`CSI ?1000h` + `?1006h`). Most
modern terminals forward mouse events to the app when this is enabled.

| Terminal | Mouse / right-click | Notes |
|---|---|---|
| **Ghostty** (macOS, Linux) | Works out of the box | SGR mouse is forwarded. If a terminal-level context menu ever intercepts, hold `Option` to bypass it for that click. |
| **Kitty** | Works out of the box | Best experience — native CSI-u keyboard protocol supported too. |
| **WezTerm** | Works; may need `enable_kitty_keyboard = true` | For the Ctrl+Shift+V paste chord in particular. |
| **iTerm2** | Works after enabling "Applications in terminal may access clipboard" + "Report mouse events" | Defaults are usually fine for normal right-click. |
| **Apple Terminal.app** | Right-click opens macOS menu | Fall back to the `y` / `Y` keystrokes. Clipboard write via `pbcopy` still works. |
| **VS Code integrated terminal** | Right-click copies selection by default | Use `y` / `Y` or set "terminal.integrated.rightClickBehavior" to `default`. |

If right-click doesn't feel right on your terminal, `y` / `Y` keystrokes
do the same thing and work everywhere.

Anything that doesn't start with `/` goes to the LLM Q&A path. Inline
file paths are tokenized before submit so you can mix them freely:

```
summarize Q3 findings: ~/Q3.pdf and ~/chart.png
```

## Architecture

`src/` is ~4,400 files. The map below is the entry layer only — it is not
the whole tree, and anything not listed here lives under a subdirectory.

```
bin/monad.mjs       — distribution entry. imports src/index.ts (bun only; node cannot run it)
src/
  index.ts          — CLI command registration (commander)
  dashboard/        — 3-pane TUI + slash dispatch
  self-implement/   — goal authoring, the implementation loop, run ledger
  self-dev/         — launch preflight, decomposition, gate scoping
  harness/          — worktree lifecycle, plan/ask entry points
  git-fs/           — worktree creation, retry/lock discipline
  autopilot/build/  — the integrity gate (test · cli-smoke)
  registry/         — provider + model catalog loading (catalog/*.yaml)
  web-search/       — tavily · grok · firecrawl adapters
  llm.ts            — provider adapters + message assembly
  tui.ts render.ts context.ts extractors.ts — terminal, rendering, attachments
```

## Requirements

- **bun** `>=1.3.5`. Two reasons for that floor:
  - `bin/monad.mjs` imports TypeScript directly, so **node cannot run it**
    — `node bin/monad.mjs` fails with `ERR_MODULE_NOT_FOUND`.
  - Bun gained a native PTY in 1.3.5. Below that version monad falls back
    to `node-pty`, which delivers **zero bytes** under Bun (upstream
    closed both reports as WONTFIX), so every terminal surface goes dark
    without saying so. See `src/pty-shell/bun-native-pty.ts`.
- **macOS** is the primary target.
- **Linux** — exercised 2026-09-20 on Ubuntu (kernel 6.17, x86_64, bun
  1.4.0): install, `--version`, `--help`, `where`, `harness --help`,
  `config get`, `doctor` and the Bun-native PTY all work.
  `node-pty` is an `optionalDependency`, so the fact that it ships no
  `linux-x64` prebuild no longer surfaces as an install error.
- **WSL2** — exercised 2026-09-20 on Ubuntu 26.04.1 (kernel 6.18.33.2, bun
  1.4.2): install, all five commands, the Bun-native PTY, `git-fs` worktree
  creation and the integrity gate all behave exactly as on macOS and Linux.
  Three things to know before you start:
  - **`bun`'s official installer fails on a fresh WSL Ubuntu** — it needs
    `unzip`, which the image does not ship:
    `error: unzip is required to install bun`. Run
    `sudo apt install unzip` first (or extract the release zip with
    `python3 -m zipfile -e`, which needs no sudo).
  - **Keep the repository on the Linux filesystem (`~/…`), not on
    `/mnt/c`.** Measured on that machine: creating 2,000 files took
    **30 ms** on ext4 and **2,577 ms** on `/mnt/c` (9p) — 86× slower, and
    135× slower to delete. This is the single biggest WSL performance
    decision.
  - Docker is **not required** by monad. If you want it inside WSL, enable
    Docker Desktop → Settings → Resources → WSL Integration for that
    distro; `/mnt/wsl/docker-desktop/cli-tools` stays empty until you do.

## Enterprise LLM endpoints

Bedrock and Vertex are **not supported today** — they are deliberately
blocked. The agent driver scrubs `CLAUDE_CODE_USE_BEDROCK` and
`CLAUDE_CODE_USE_VERTEX` from the child environment so that child agents
run on subscription OAuth rather than on metered API credentials.

## License

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
