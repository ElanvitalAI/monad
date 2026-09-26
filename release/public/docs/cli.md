# CLI reference

Generated from `elanous <command> --help` for the 31 commands this manual uses. Every command also answers `--help`; `elanous --help` lists all of them, including maintainer tools not covered here.

## `elanous acp`

Agent Client Protocol — spawn ACP agents (claude-code, codex, gemini)

```text
elanous acp [options] [command]
```

| Subcommand | Description |
|---|---|
| `login [options] <backend>` | Start a subscription OAuth login (grok = SuperGrok/X Premium · codex = ChatGPT). Opens a browser; for remote/headless use --device-auth |
| `usage [options] [backend]` | Show subscription usage (grok only for now — needs a subscription OAuth credential) |
| `test [options]` | One-shot ACP smoke test: spawn a backend, send one prompt, print the streamed response |
| `list` | List the ACP backends this build knows about |

## `elanous agent`

Single-turn agent — same as `chat` but with the tool loop on by default (Read/Grep/Glob/ListDir/Edit/Write + Bash). Use this when the LLM needs to inspect files / run commands / debug itself.

```text
elanous agent [options] [command] [text...]
```

| Option | Description |
|---|---|
| `--new` | Force a new session instead of using the active one |
| `--session <id>` | Continue an explicit session (id or unique prefix). Overrides --new and active session. |
| `--json` | Emit a single JSON line {sessionId, provider, model, reply, logPath, budget} instead of streaming text + ui.info trailer. Stable shape for LLM self-spawn. |
| `--no-tools` | Disable the tool loop and fall back to text-only chat (for benchmarking / parity with `chat`). |

| Subcommand | Description |
|---|---|
| `dispatch [options] <subagent_type> <prompt...>` | Spawn one sub-agent from the terminal and print its final message. Observe with `elanous logs --category agent.spawn` / `--category agent.done` — the printed cid pairs the two. |

## `elanous ask`

Alias for `elanous chat --new`: send one query and print the reply

```text
elanous ask [options] <text...>
```

| Option | Description |
|---|---|
| `--reuse` | Reuse the active CLI session instead of creating a new one |
| `--session <id>` | Continue an explicit session (id or unique prefix). Overrides --reuse and active session. |
| `--json` | Emit a single JSON line {sessionId, provider, model, reply, logPath, budget} instead of streaming text + ui.info trailer. Stable shape for LLM self-spawn. |

## `elanous attach`

ACP client for the running elanous daemon. Three modes: handshake-only (default), one-shot (--message), interactive REPL (--interactive). Local (unix socket) or remote (--host / --url) over Tailscale.

```text
elanous attach [options]
```

| Option | Description |
|---|---|
| `--socket <path>` | Override the unix socket path (default: ~/.elanous/elanous.sock) |
| `--host <hostport>` | Remote daemon host:port (e.g. mbp.tailnet:31415). Coerced to ws://&lt;hostport&gt;/v1/acp. |
| `--url <wsurl>` | Remote daemon WS URL (e.g. ws://host:31415/v1/acp). Overrides --host. |
| `-r, --remote [name]` | Bookmark name (`-r` alone = default). Fills host/token-file; explicit --url/--host/--token/--token-file win. |
| `--token <token>` | Bearer token for remote auth. Overrides --token-file and ELANOUS_TOKEN. |
| `--token-file <path>` | Read bearer token from this file (e.g. ~/.elanous/acp-token scp'd from the daemon). |
| `--no-auth` | Skip token handshake (Tailscale-only mode; daemon must run with --no-http-auth). |
| `--label <name>` | Best-effort client label sent in the auth handshake (debug log only). |
| `--session <id>` | M2.3 — attach to an EXISTING session id (loaded via ACP session/load) instead of minting a new one. Daemon must know the id (use /list on a prior session to discover). |
| `--message <text>` | Send this user message and print the streamed response |
| `--assert-text-contains <text...>` | Assert: final assistant text MUST include this substring (repeatable; one-shot only) |
| `--assert-tool-min <spec...>` | Assert: daemon tool fired ≥N times. Format: ToolName=N (one-shot only) |
| `--assert-tool-max <spec...>` | Assert: daemon tool fired ≤N times. Format: ToolName=N (one-shot only) |
| `-i, --interactive` | Start an interactive REPL — type messages, get streamed responses (slash commands: /quit /new /list /help) |
| `--cwd <path>` | Working directory reported in newSession() (default: "&lt;current directory&gt;") |

## `elanous chat`

Send one message in the active session (or a new one) and print the reply

```text
elanous chat [options] <text...>
```

| Option | Description |
|---|---|
| `--new` | Force a new session instead of using the active one |
| `--session <id>` | Continue an explicit session (id or unique prefix). Overrides --new and active session. |
| `--json` | Emit a single JSON line {sessionId, provider, model, reply, logPath, budget} instead of streaming text + ui.info trailer. Stable shape for LLM self-spawn. |
| `--tools` | Enable the tool-loop path (Read/Grep/Glob/ListDir/Edit/Write + Bash). Default off — chat is text-only by default for backward compatibility. `elanous agent` is a thin wrapper that flips this on. |
| `--goal-loop` | Arm the across-turn goal loop (runGoalLoop): wrap the tool-loop so the model keeps iterating until the goal is complete (GOAL-COMPLETE evidence gate) or maxIterations. Requires --tools. Same engine as ACP/dashboard. Config `llm.goalLoop.enabled` also arms it. |
| `--implement` | Bypass the harness goal-loop guard for the legacy implementation child entrypoint |

## `elanous config`

Inspect and edit ~/.config/elanous/config.json

```text
elanous config [options] [command]
```

| Subcommand | Description |
|---|---|
| `path` | Print the active config path |
| `get [options] [path]` | Print all config or one dotted path, e.g. llm.provider (secrets redacted by default) |
| `set [options] <path> <value>` | Set a dotted config path. Value is parsed as JSON when possible. |
| `unset [options] <path>` | Remove a dotted config path (the inverse of set · array indexes supported). No-op if already absent. |
| `sync-test [options]` | Materialize the production config, converted to be test-safe, into the isolated root (+ copies side files · default &lt;repo&gt;/.elanous-test) |
| `promote [options] <path...>` | Propagate field(s) from the test config to production (per-field raw patch · multiple paths · dry-run by default · --yes to apply) |
| `mission` | Inspect or edit llm.missionRouting (mission → provider table) |

## `elanous discord-test`

Standalone TEST discord session (SAME app/token, scoped to discord.testChannel.channelId) with ISOLATED state, WITHOUT touching the production daemon. Restart THIS process to test code changes; the live daemon stays up.

```text
elanous discord-test [options]
```

| Option | Description |
|---|---|
| `--token <token>` | override the token (default: discord.testChannel.botToken → discord.botToken) |
| `--channel <id>` | override the test channel snowflake (default: discord.testChannel.channelId) |
| `--state-dir <dir>` | isolated state dir (default ~/.elanous/discord-test) |
| `--allow <ids>` | comma-separated allowed discord user ids (default: testChannel.allowedUsers or main allowlist) |
| `--reset` | wipe the isolated state dir before starting (fresh test) |

## `elanous doctor`

Reports whether credentials resolve and where each resolution comes from

```text
elanous doctor [options]
```

| Option | Description |
|---|---|
| `--json` | structured output |
| `--fix` | show reversible repairs (read-only unless --yes) |
| `--yes` | apply planned doctor repairs (requires --fix) |
| `--sudo` | also run the planned sudo install lines — only where `sudo -n true` works (requires --fix --yes) |
| `--restart` | restart the nexus service when it runs a different version than this installed copy, then verify it (requires --fix --yes · interrupts bots, terminals and running turns) |

## `elanous harness`

Harness worktree lifecycle — create (worktree add), list (worktrees), clean (clean), inspect processes (processes)

```text
elanous harness [options] [command]
```

| Subcommand | Description |
|---|---|
| `deliverable-verify [options] <goal-path>` | Observe the addresses a goal document declares as Port. By default only looks at what is already running — with --launch it starts the deliverable, checks it, and always stops it. |
| `processes` | Classify, read-only, the OS processes this repository started: heavy resource users vs long-lived ones. Kills nothing. |
| `ask [options] <goal-path>` | Run from a goal document path |
| `say [options] <sentence...>` | Run from a sentence |
| `plan [options] <sentence...>` | Write an RFC without executing it |
| `mission [options] <mission-ids...>` | Solve one or more existing missions with the harness |
| `clean [options]` | Clean harness disposable worktrees + branches (default prefix comes from the creator's constant). ⚠️ Worktrees with an open PR are always kept. Dry-run by default (plan only · --yes to remove). |
| `worktree` | Create a harness worktree. |
| `worktrees [options]` | Judge every registered worktree, read-only, by PR · dirty state · output · session ownership. Never removes anything by default. |
| `terminals-purge [options]` | Purge dead rows left in the PTY registry (/v1/terminals) — entries with alive=0 that the owner-pid reaper missed. Live rows (alive=1) are untouched. |
| `browser-type [options] <url> <selector> <text>` | ⌨️ Judge a typing request with decideTypeAction. ⛔ Sends no keys and submits nothing — execution is a separate step. |
| `browser-act [options] <url> <target>` | Click the target selector on an attached CDP page, only once and only when explicitly armed (--armed). ⛔ Who armed it is decided by observation attribution (person · bot routine · run). |
| `trajectory [options]` | 🎬 Read existing browser-act observations back as a trajectory (recording). ⛔ Creates no new record format. |
| `replay [options]` | ▶️ Replay a recorded trajectory in the same order (reproduction). ⛔ Does not guarantee the same result — reports where it diverged. |
| `verify-url [options] <url>` | Open a deployed/local URL with the cdp (default) or aside backend and verify the render (screenshot + body/title diagnostics). CDP reuses an attached browser on port 9222; skips if no backend is available. |
| `map [options]` | Harness self-description — prints the stage pipeline (order · role), execution spaces and terminal states (no side effects). |
| `orchestrate [options] <goals...>` | Parallel self-dev — run several goals at once, each as an isolated-worktree self-implement subprocess, with a concurrency cap. |

## `elanous local`

Local OpenAI-compatible LLM — ping, list, test, setup

```text
elanous local [options] [command]
```

| Subcommand | Description |
|---|---|
| `ping [options]` | Check endpoint reachability (GET /v1/models) |
| `models [options]` | List models served by the endpoint (GET /v1/models) |
| `pick [options]` | Fleet-policy auto-pick — choose a local model by MLX-first · Q4 · speed · node RAM budget (reused by observation and missions) |
| `bench [options] [models...]` | Local model benchmark — 100-point rubric (coding 50 · reasoning 30 · RAG 10 · format 10) · graded by really running Python · temperature 0, sequential. Concurrency cap 2 (one load per machine). |
| `scores|map [options]` | Combined map — benchmark scores (speed tok/s × 100-point use score × RAM × node × tier) in one table. Reads ~/.elanous/llm-bench.jsonl and joins inventory RAM. The basis for fleet routing. |
| `inventory|inv [options]` | Auto-discover LLM resources on every node (local + SSH fleet) — quad-probe (lmstudio/ollama/mlx/docker). Exposes the manager inventory on the CLI. |
| `test [options]` | Run the compatibility matrix against the endpoint |
| `chat [options] <prompt...>` | One-shot chat through the full elanous provider stack (integration smoke) |
| `setup [options]` | Save endpoint + model to ~/.config/elanous/config.json (provider=local) |

## `elanous login`

Authenticate to an LLM provider via OAuth

```text
elanous login [options] [command]
```

| Subcommand | Description |
|---|---|
| `openai-codex` | Sign in to OpenAI Codex via the ChatGPT device-code flow |
| `status` | List providers that have OAuth tokens on file |
| `logout <provider>` | Forget OAuth tokens for a provider |

## `elanous logs`

Query or live-tail logs from every surface (like adb logcat) — level/surface/category/grep filters

```text
elanous logs [options] [command]
```

| Option | Description |
|---|---|
| `-f, --follow` | Live follow (like tail -f · Ctrl-C to stop) |
| `--level <lvl>` | Only this level and above (trace\|debug\|info\|warn\|error\|critical) |
| `--surface <s>` | Surface filter, CSV (nexus,pwa,telegram,discord,…) |
| `--space <v>` | Harness space filter (self-implement\|dev-harness\|solve-mission = by kind · anything else = isolated lookup by run id/branch slug) |
| `--category <c>` | Category prefix filter, CSV (voice,webterm.tabs,…) |
| `--exact-category <c>` | Exact category filter, CSV (excludes child categories) |
| `--list-categories` | List every category that actually appeared in these stores, with counts (ignores filters) |
| `--list-events` | List the events that actually appeared in these stores, with counts (respects the category filter) |
| `--axis <name>` | Query an axis name as its exact set of categories (dev\|pty) |
| `--explain` | Without an axis, discover axes and categories; with --axis, explain the mapping, unclassified categories and zero-count categories in the recent window |
| `--event <e>` | Exact event filter, CSV |
| `--grep <q>` | Substring match on event/data/category |
| `--rework-recurrence-disagreement <true|false>` | Filter by rework-budget data.recurrenceDisagreement |
| `--since <t>` | Only a recent window (30s/15m/2h/7d or ISO/epoch) |
| `--until <t>` | End time — symmetric with --since (relative 30s\|15m\|2h\|7d or ISO/epoch) |
| `--before <cursor>` | ⭐ Page cursor — a row id, or the nextCursors JSON object from federated --json metadata |
| `--session <id>` | Filter by session_id |
| `--limit <n>` | Maximum rows (default 100 · local reads are not capped at 1000 — that cap moved to the HTTP boundary) |
| `--json` | JSON output |
| `--json-data` | Emit JSON data as parsed values in --json output |
| `--test` | Read the logs of the isolated test instance (.elanous-test/) of the repo in the current directory |
| `--instance <name>` | Target a registered instance (prod\|test:&lt;repo&gt;\|…) |
| `--all` | Federated query across all instances — read-only merge · ⟨instance⟩ tag |
| `--include-test` | Include isolated test instances in the --all federation (excluded by default) |
| `-r` | query logs on the default remote bookmark (does not take a value) |
| `--remote <name>` | query logs on a named remote bookmark via GET /v1/logs |

| Subcommand | Description |
|---|---|
| `instances [options]` | List the log instance registry — name · state dir · liveness · whether a store exists |
| `level [options] [lvl]` | Show or change the daemon log level at runtime (off\|trail\|diag\|normal\|verbose\|detail\|keytrace · changes persist per instance). --render on\|off mutes render logs (independent of the level) |
| `timeline [options]` | Render a session/drive as a human-readable narrative — render noise removed · turn/tool-call/reasoning/edit timeline (for diagnosing autonomous drives) |
| `durations [options]` | Per-tool duration distribution (count · median · p90 · max), separating the chat surface from the headless core path |
| `degenerate [options]` | Judge numeric log fields for degeneration — always-same / all-zero / too few samples — as NDJSON (default sample 50) |
| `fields [options]` | For every top-level data field: rows where it exists · total rows for the event · observed period, as NDJSON |
| `unclosed [options]` | Work that started but never finished, oldest first — hang candidates. ⛔ Sets no threshold (the reader picks the cut with --older-than) |
| `abandoned-draft-prs [options]` | Count and name abandoned draft PRs that have no salvage verdict yet (read-only · no closing/labels/comments) |

## `elanous mcp`

MCP (Model Context Protocol) server / client integration

```text
elanous mcp [options] [command]
```

| Subcommand | Description |
|---|---|
| `serve` | Run a stdio MCP server exposing the configured mcp.servers as proxy tools (used by `claude mcp add elanous -- elanous mcp serve`) |
| `login [options] <serverId>` | Acquire and persist OAuth credentials for one configured HTTP MCP server. |
| `reload [options]` | Re-read user-config and rebuild the running daemon's MCP clients — no daemon restart. Use after editing mcp.servers[] or `elanous mcp login`. |
| `diagnose [options] [serverId]` | Probe one (or every enabled) MCP server: spawn + initialize + tools/list, verbose. When `xcrun mcpbridge` hangs daemon-side, this reproduces under your shell env so you can diff. |
| `call [options] <tool>` | Call one MCP tool on this machine's daemon (or a bookmarked remote) via POST /v1/mcp |
| `list [options]` | List MCP tools from this machine's daemon (or a bookmarked remote) via POST /v1/mcp tools/list |

## `elanous memory`

Persistent memories injected into every chat turn (user / feedback / project / reference)

```text
elanous memory [options] [command]
```

| Subcommand | Description |
|---|---|
| `list [options] [type]` | List memories (optionally filtered by type) |
| `add <type> <name> [description...]` | Create a memory (type: user\|feedback\|project\|reference). Body piped via stdin if available. |
| `pin [options] <idPrefix>` | Pin a memory so it is ALWAYS injected (bypass keyword gate). Optionally set priority. |
| `unpin <idPrefix>` | Un-pin a memory (back to keyword-gated recall). |
| `priority <idPrefix> <n>` | Set a memory's injection priority boost (0 = default). Added to match score. |
| `status` | Unified memory overview — ① curated file-memory + ② self-log (surface_events) |
| `show <idPrefix>` | Print full memory body |
| `search [options] <query...>` | Keyword search across all memories |
| `delete <idPrefix>` | Delete a memory |
| `index` | Print MEMORY.md index verbatim |
| `where` | Show the memory storage path |

## `elanous nexus`

NEXUS — unified TUI shell + supervisor + meta-api (Phase N-1, opt-in)

```text
elanous nexus [options] [command]
```

| Subcommand | Description |
|---|---|
| `run [options]` | Boot the NEXUS daemon. Default = headless + PWA-ready. Lifecycle auto-detected from TTY (fork+detach when interactive, inline blocking under launchd / systemd / Docker / nohup). Stop with `nexus pwa stop`. |
| `status` | Print NEXUS lock + runtime sidecar state. Same as `elanous nexus --status`. |
| `stop` | Send SIGINT to the local NEXUS lock holder. Same as `elanous nexus --stop`. |
| `ios-bind [options]` | Inject NEXUS host/port + bearer token to the booted iOS simulator (L2 helper). |
| `config` | Read/write the UserConfig at ~/.elanous/config.json. |
| `build [options]` | Build the PWA static export at apps/pwa/out (one-time · ~30s). Required before `nexus run` (static mode). |
| `dist` | Stage B remote-install — publish ad-hoc IPA so iPad Safari can install it over Tailscale. |
| `pwa` | PWA operational helpers — stop / show / global / share / restart / dev. (start/test/build are deprecated → use `nexus run` / `nexus run --test` / `nexus build`.) |
| `show [options]` | Show this project's daemon — alive flag · ports · PWA UI / REST API / SSE links (loopback + tailnet). |
| `restart-needed [options]` | Say whether the running daemon needs a restart, a PWA build, or nothing, from the path diff between its commit and --to (default HEAD). Read-only. |
| `channel-bot` | NEXUS-native channel bot setup helpers. |
| `setup-firecrawl [options]` | Configure Firecrawl-backed model discovery (CLI detection + API key entry). |
| `connect [options] <host>` | Bookmark a remote NEXUS host so `elanous` (no-arg) auto-attaches. Pulls metadata from /v1/nexus/connect-info. |
| `list|ls [options]` | List bookmarked remotes. Shows default + addedAt + (optional) health ping. |
| `switch <name>` | Set &lt;name&gt; as the default remote (used by `elanous` no-arg). |
| `remove|rm <name>` | Remove a bookmark + delete its token file. Does not stop the remote NEXUS. |
| `install [options]` | Install nexus as an OS-supervised service (launchd / systemd) |
| `uninstall [options]` | Remove the launchd LaunchAgent / systemd-user unit installed by `nexus install` |

## `elanous ops`

Operations observation (READ-ONLY) — current state, anomalies and transitions of missions · tasks · contract loops · orchestrators. --json for scripts.

```text
elanous ops [options] [command]
```

| Subcommand | Description |
|---|---|
| `status [options]` | Overall current state (missions · tasks · loops · orchestration · schedules) · --all-instances for the whole fleet · -r/--remote to assemble from a remote GET |
| `health [options]` | Anomalies only (blocked · errored · stale) |
| `timeline [options]` | State transitions, newest first, merged |
| `mission [options] <id>` | One mission in detail — content + per-phase diagnosis (failClass · recommended heal) + related tasks/schedules/autonomous actions + transitions |
| `mission-log [options] <id>` | Tail a mission's run log (run.log) — the evidence behind the diagnosis (survives reboot) |
| `build [options] [buildId]` | Observe/control isolated builds — list when no id, snapshot with a buildId. --follow streams like tail -f, --stop stops a running build |

## `elanous provider`

Show the currently active LLM provider + model + auth status

```text
elanous provider|providers [options] [command]
```

| Subcommand | Description |
|---|---|
| `codex` | Codex — view and use usage, limits and reset credits |

## `elanous pty`

PTY control — <ref> is an id, nickname, or unique prefix (see 'pty list')

```text
elanous pty [options] [command]
```

| Subcommand | Description |
|---|---|
| `list [options]` | List PTY ids available to other PTY commands |
| `reap [options]` | Preview dead-owner manifest rows across roots; --yes removes only confirmed dead-owner rows |
| `lineage [options] <key>` | Show PTY lineage from the local or federated manifest and lifecycle ledger |
| `find [options] <key>` | Find local manifest rows by PTY pid, owner pid, PTY id, or run id |
| `retire [options] <ref>` | Prove whether a manifest row is removable; --all reads foreign roots but never removes their rows |
| `takeover <ref>` | Request human write ownership through the PTY arbiter |
| `auto [options] <ref>` | Drive an existing agent-owned PTY without spawning a terminal |
| `release <ref>` | Return human-owned PTY control to its prior mode |
| `state [options] <ref>` | Classify the current PTY screen state |
| `wait [options] <ref>` | Wait until the classified PTY screen reaches a state |
| `snapshot [options] <ref>` | Render the current PTY screen without requesting write ownership |
| `text [options] <ref> <text>` | Inject literal text — no newline unless --enter |
| `key [options] <ref> <key>` | Inject a named special key (enter/esc/tab/up/… · see 'pty list' for &lt;ref&gt;) |
| `resize [options] <ref> <cols> <rows>` | Resize the PTY (gated by the same access matrix as input) |

## `elanous registry`

Observe the model catalog (catalog/ is the source of truth) — audit routing-map drift

```text
elanous registry [options] [command]
```

| Subcommand | Description |
|---|---|
| `drift [options]` | Audit whether routing pins (alias · tier-map · mission-router) match the catalog's active ids — proposes changes for a human (never applies them) |
| `discover [options]` | Run the chosen discovery sources and merge into the existing snapshot — dry-run by default · --write to record · no S3 push |

## `elanous release`

One public release — prepare (local) → publish (--yes) → verify

```text
elanous release [options] [command]
```

| Subcommand | Description |
|---|---|
| `prepare [options]` | Clean source → public copy → commit on top of the public repository's history → PWA → bundle and checksums → local end-to-end (no network writes) |
| `yank [options]` | Pull a release — demote it to pre-release and point Latest at the previous stable version (assets are kept · --undo reverts). Without --yes it only shows the plan |
| `publish [options]` | ⛔ Cannot be undone — pushes to the public repository and creates the GitHub release. Without --yes it only shows the plan |
| `verify [options]` | End to end from the public URL — in a clean temporary home: install → --version → self-update → uninstall |
| `notes [options]` | Draft a changelog from the landings between two refs (edit it before publishing) |

## `elanous repl`

Sticky multi-turn REPL — same session across turns, no per-turn process boot. Drives chat / agent / scenario from one shell. Uses --new for a fresh session, --session <id> to resume, --scenario <yaml> for a scripted run, JSONL on stdin for piped automation.

```text
elanous repl [options]
```

| Option | Description |
|---|---|
| `--new` | Force a new session at boot instead of resuming the active one |
| `--session <id>` | Resume an explicit session (id or unique prefix) |
| `--scenario <path>` | Run a YAML multi-turn scenario before handing back to interactive (or exit) |
| `--replay <session-id>` | Re-execute the user prompts from a previous session in a fresh REPL run (BACKLOG #5). User prompts are extracted in order and fed through the same dispatcher as --scenario; assistant/tool messages and attachments are dropped. Mutually exclusive with --scenario. |
| `--exit-after-scenario` | Exit after the scenario / replay completes (default true when stdin is not a TTY) |
| `--no-exit-after-scenario` | Stay in the interactive prompt after the scenario / replay completes (TTY default) |
| `--json` | Emit one JSON line per turn (sessionId/provider/model/reply/...) instead of streaming text |
| `--no-tools` | Disable the tool loop and run a text-only chat REPL (parity with telegram/discord callers) |
| `--stdin-jsonl` | Force JSONL-on-stdin mode even when stdin is a TTY (useful for testing automation paths) |

## `elanous self entrances`

Print the list of Commander CLI entrances currently assembled

```text
elanous self entrances [options]
```

| Option | Description |
|---|---|
| `--json` | Output as structured JSON |

## `elanous self orchestrate`

Parallel self-dev — run several goals at once, each as an isolated-worktree self-implement subprocess, with a concurrency cap. Separate goals with `;;` (or one goal per argument). --concurrency sets how many jobs run at once (default 2).

```text
elanous self orchestrate [options] [goals...]
```

| Option | Description |
|---|---|
| `--concurrency <n>` | Jobs to run at once (default 2) |
| `--auto-merge` | Each job: merge automatically when the review is clean (passes --auto-merge to each self-implement, through the review node) |
| `--auto-review` | Label each job's PR for opt-in auto-review (passes --auto-review to each self-implement · each job judges its own eligibility · fail-safe). Labelled PRs are finished unattended by the review poller. |
| `--open-pr` | Each job: open a draft PR when the gate and review pass (passes --open-pr to each self-implement · promotion goes through the review node) |
| `--base <branch>` | Base branch for each job's PR |
| `--decompose` | Split one goal with an LLM into a dependency sub-DAG (parallel by topology, hot files serialized), then run it |
| `--pod-skill-env` | pod: pass the keys (.env) of required skills (config pod-skills.txt) to this run as a Secret — explicit opt-in (paid credits) · never baked into the image |
| `--pod-pool <spec>` | pod pool — context[@ssh-host][:cap], comma-separated, first wins (e.g. pool-a@host-a:12,pool-b@host-b:3) · otherwise ELANOUS_POD_POOL · otherwise the current context alone |
| `--reduce` | At the end, gather the pieces that opened PRs into one integration branch (one gate run) and one PR — pairs with `--open-pr` · cannot be combined with `--auto-merge` (elanous self reduce) |
| `--substrate <kind>` | Where to run: local (default · isolated worktree) \| pod (Kubernetes Job · docker/harness image) |
| `--pod-account <name>` | pod: codex account (~/.elanous/auth.json openai-codex:&lt;name&gt; · a copy without the refresh token) · if omitted, a broker hands each Job the account with the most remaining quota |
| `--no-pod-rebuild` | pod: do not rebuild the image even if its version (elanous.commit) differs from HEAD — the measurement then measures the image's version |
| `--pod-pass-env <keys>` | pod: keys to pass from the host environment into the Pod (comma-separated) — e.g. OPENROUTER_API_KEY,ANTHROPIC_API_KEY (benchmark billing path) |
| `--bench-arms <spec>` | pod benchmark: clone one goal per arm, differing only in a single label line, and run them at once — "id=provider[:model][@KEY+KEY];…" (e.g. codex=openai-codex;or-kimi=openrouter:openrouter/moonshotai/kimi-k3@OPENROUTER_API_KEY) · refuses --auto-merge |
| `--help-all` | Show every orchestrate option |

## `elanous self parked`

Backlog of goals blocked (failed/cancelled) in the unattended self-dev loop, for batch decisions. Mark handled with --resolve <runId> --reason <reason>. --json for structured output.

```text
elanous self parked [options]
```

| Option | Description |
|---|---|
| `--json` | Structured output {parked, counts, displayLimit, omittedCount, population, stores, limitation} · each parked item = [{feature, status, stage?, error?, runId, branch?, updatedAt, source}] |
| `--limit <count>` | Maximum parked items to show |
| `--resolve <runId>` | Mark a parked run as handled by a person |
| `--reason <reason>` | Short reason for marking it handled |

## `elanous self recall`

Recall elanous's self-cognition memory — "what did I implement recently" (surface_events domain=elanous)

```text
elanous self recall [options] <query...>
```

| Option | Description |
|---|---|
| `-n, --limit <n>` | Number of results (default: "8") |
| `--since-hours <n>` | Lookup period in hours (default: "720") |
| `--all-instances` | Federated recall across every registered elanous instance (fleet · read-only union) |
| `--include-test` | Include isolated test instances in the federation (excluded by default) |
| `--include-observer-output` | Include output generated by observers in the recall (excluded by default) |

## `elanous self reduce`

Fleet reduce — merge the open piece PRs one by one onto the base with merge --no-ff → on conflict, stop and name the piece and files → change-scope gate → one integration PR (piece PRs are not closed)

```text
elanous self reduce [options]
```

| Option | Description |
|---|---|
| `--prs <numbers>` | Open PR numbers to combine (comma-separated · merged in the order given) |
| `--base <branch>` | Base branch (default: "main") |
| `--branch <name>` | Integration branch name (default reduce/&lt;time&gt;) |
| `--title <text>` | Integration PR title |
| `--dry-run` | Merge and gate only — no push, PR or comments |
| `--skip-gate` | Skip the gate (not recommended) |

## `elanous self repair-signals`

Cluster parked failures into patterns (system repair candidates vs single-goal issues). Observation → system repair.

```text
elanous self repair-signals [options]
```

| Option | Description |
|---|---|
| `--json` | Structured output [{pattern, count, runCount, kind, hypothesis, affectedFeatures}] |
| `--json-envelope` | Structured output {signals, scanned, windowExcluded}; --json alone keeps the raw-array contract |
| `--since <t>` | Only a recent window (30s/15m/2h/7d or ISO/epoch) |

## `elanous self run-ledger`

Print the JSONL observation ledger of a self-implement run

```text
elanous self run-ledger [options] <runId>
```

| Option | Description |
|---|---|
| `--json` | Re-serialize one entry per line (original whitespace and blank lines are not preserved) |
| `--all` | Federated ledger lookup across all instances, like logs |
| `--include-test` | Include isolated test instances in the --all federation |

## `elanous self-update`

Update an installed copy from a release, a checkout from a clean checkout; restart the nexus when approved · same as `elanous update` · with `--auto on`, runs every day

```text
elanous self-update|update [options]
```

| Option | Description |
|---|---|
| `--from <checkout>` | Checkout to install (default: releases for an installed copy, the current checkout for a checkout) |
| `--version <version>` | Install this release version on an installed copy (default: latest) |
| `--restart` | Approve restarting the nexus |
| `--json` | Print the result as JSON |
| `--keep <n>` | Recent versions to keep after install (installed copy: current and previous; checkout: current and the daemon's version are protected · 0 = no cleanup) (default: "3") |
| `--alert` | Also send failures (exit≠0) as an alert — for unattended cron runs |
| `--auto <on|off|status>` | Automatic updates — a macOS launchd agent or Linux systemd timer runs `self-update --restart --alert` every day at 04:17 (not turned on if a cron entry already runs it) |

## `elanous session`

Manage conversation sessions

```text
elanous session [options] [command]
```

| Subcommand | Description |
|---|---|
| `list [options]` | List recent sessions (empty 0msg sessions hidden by default — active kept) |
| `new` | Create a fresh session and mark it active |
| `resume <prefix>` | Load a session by full id or unique id prefix and mark it active |
| `show [options] [prefix]` | Print the messages of a session (default: active) |
| `compact [options] [prefix]` | Force-compact a session history NOW — bypasses the auto token-ratio gate and runs the full pipeline incl. Layer3 LLM summarize. External on-demand trigger (default: active session · forced by default). |
| `watch [options] [prefix]` | Live-tail a session — render new messages as they arrive (default: the most recently active session) |
| `delete <prefix>` | Delete a session (by id or prefix) |
| `purge [options]` | Bulk-delete sessions by filter (DRY-RUN by default · --apply to delete · destructive, cannot be undone) |
| `export [options] [prefix]` | Export a session transcript to a markdown file (default: active · ~/temp/elanous-transcript-&lt;stamp&gt;.md) |
| `fork [options] <prefix>` | Fork a session (copies history · records forkedFromId lineage) |
| `search [options] <query>` | Search conversation CONTENT across sessions (source / instance / telegram filters) |
| `subscribe [options] <prefix>` | Subscribe a surface to a session (concurrent multi-surface viewing) |
| `unsubscribe [options] <prefix>` | Leave a session (removes only this subscriber · other subscribers stay) |
| `subscribers [options] <prefix>` | List who is currently subscribed to a session (presence) |
| `turn <prefix>` | Show current session turn holder and FIFO wait queue (full id or unique prefix) |
| `takeover [options] <prefix>` | Request human write ownership through the session turn arbiter (full id or unique prefix) |
| `release [options] <prefix>` | Return CLI-owned session turn control to the next waiter or free state (full id or unique prefix) |
| `context <prefix>` | Deterministic self-cognition context — who is watching / where reachable (grounded) |
| `link <prefix>` | Emit a shareable @session:&lt;id&gt; deep link for cross-surface reference |
| `open <token>` | Open an @session:&lt;id&gt; deep link — resolves + shows who is watching (grounded) |

## `elanous setup`

Check OpenAI Codex setup and guide each missing credential step

```text
elanous setup [options]
```

| Option | Description |
|---|---|
| `--non-interactive` | Report setup state without prompts or writes |

## `elanous telegram`

Telegram bot — the standard Q&A poller that runs outside the nexus

```text
elanous telegram [options] [command]
```

| Subcommand | Description |
|---|---|
| `run` | Run the same Q&A path as the nexus in a separate process (only after taking a polling lock per token · if the nexus is polling, waits 30 seconds and then gives up that token). To turn the nexus poller off, set telegram.poller=standalone. |
| `service [options]` | Show the service definition for `telegram run` (launchd plist · systemd unit). With --install, writes and starts it (only when telegram.poller=standalone). |

## `elanous tier`

Look up the LLM tier → model mapping — per-provider budget/balanced/better/best/loaded ladder (llm-tier-map). Accepts aliases like "grok low".

```text
elanous tier [options] [command]
```

| Subcommand | Description |
|---|---|
| `resolve [options] <provider> [tier]` | Resolve provider (+tier) → model. Omit tier for all five. Aliases low/mid/high/max accepted. |
| `list|ls [options] [provider]` | Full matrix (provider × 5 tiers) or one provider. A one-glance table to avoid tier confusion. |
| `providers` | Providers that have a tier ladder. |

## `elanous update`

Update an installed copy from a release, a checkout from a clean checkout; restart the nexus when approved · same as `elanous update` · with `--auto on`, runs every day

```text
elanous self-update|update [options]
```

| Option | Description |
|---|---|
| `--from <checkout>` | Checkout to install (default: releases for an installed copy, the current checkout for a checkout) |
| `--version <version>` | Install this release version on an installed copy (default: latest) |
| `--restart` | Approve restarting the nexus |
| `--json` | Print the result as JSON |
| `--keep <n>` | Recent versions to keep after install (installed copy: current and previous; checkout: current and the daemon's version are protected · 0 = no cleanup) (default: "3") |
| `--alert` | Also send failures (exit≠0) as an alert — for unattended cron runs |
| `--auto <on|off|status>` | Automatic updates — a macOS launchd agent or Linux systemd timer runs `self-update --restart --alert` every day at 04:17 (not turned on if a cron entry already runs it) |

## `elanous usage`

One row per account: how much you can still use right now (credit axis ≠ subscription axis)

```text
elanous usage [options] [command]
```

| Option | Description |
|---|---|
| `--json` | JSON output — contains no credentials |

| Subcommand | Description |
|---|---|
| `runs [options]` | Aggregate stored llm-usage logs by run, model and billing path |
| `reset [options]` | ⛔ Cannot be undone — spends one Codex reset credit to restart that account's weekly window now |

## `elanous wf`

Run YAML DAG workflows (workflow-runtime · prompt|bash|skill|cft|approval|if|switch|iteration|classify|extract|set|filter|template|http|showroom|scheduleTrigger|webhookTrigger|discordTrigger|telegramTrigger|manualTrigger|chatTrigger nodes). Aliases: `workflows` (plural) · `workflow` (singular).

```text
elanous wf|workflows [options] [command]
```

| Subcommand | Description |
|---|---|
| `list` | List all discovered workflows (project + global + builtin) |
| `show <name>` | Print a workflow YAML to stdout |
| `validate <target>` | Validate a workflow by name or by file path (.yaml / .yml) |
| `run <name> [args...]` | Run a workflow with positional args joined as $ARGUMENTS |
| `node` | Workflow node catalog reference — kinds, specs, and search. |
| `suggest-next [options] <workflow>` | Suggest the next node(s) to add to a workflow (LLM-driven · Phase 4 N5-1) |
| `synth [options] <intent...>` | Synthesize a workflow YAML from a natural-language intent (LLM-driven · scheduler-retirement R3) |

## `elanous where`

Show which instance (prod/test) this process belongs to, and why (READ-ONLY)

```text
elanous where [options]
```

| Option | Description |
|---|---|
| `--json` | JSON output |
