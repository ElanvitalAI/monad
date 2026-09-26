# Troubleshooting

Messages that look like one problem and mean another.

## `No LLM provider available`

No provider could be used: nothing is signed in, or every account and fallback is used up. Run `elanous login status` and `elanous usage`; if nothing is signed in, run `elanous setup`.

## `elanous usage` says `unavailable (auth)` for codex, but runs work

`usage` reads the Codex CLI's own sign-in file, which is separate from the sign-in elanous uses. The line does not mean your credential is broken.

## The harness finished with a branch, not a pull request

The repository has no GitHub remote, or `gh` is not signed in. This is expected: elanous leaves the work on a branch you can merge. Run `gh auth login` if you want pull requests.

## On Linux the run stops with `codex app-server stdin drain timeout`

The Codex CLI itself is not installed. `elanous login openai-codex` signs elanous in, but the part that writes code starts the `codex` program. Install the Codex CLI and run `codex login` once.

## The service still runs the old version

Installing a new build does not restart a running service. `elanous nexus restart-needed` says whether it has to; `elanous self-update --restart` installs and restarts only when needed. To restart by hand:

```bash
launchctl kickstart -k "gui/$(id -u)/com.elanous.nexus"     # macOS
systemctl --user restart elanous-nexus                      # Linux (systemd user service)
```

Then compare `elanous --version` with the `daemonSha` in `curl -s http://127.0.0.1:31415/v1/health`.

## The service keeps restarting right after install

Look at the service's error log. If it says the web app is not built, point it at a built copy with `ELANOUS_PWA_STATIC_DIR` (see [install](install.md#known-limits)).

## Bun skips an optional dependency

On some Linux machines `bun install` silently skips an optional dependency when `TMPDIR` and Bun's cache are on different filesystems (an upstream Bun issue). Put the temporary directory on the same filesystem:

```bash
mkdir -p ~/tmp-bun && export TMPDIR=~/tmp-bun
```

## `command -v <tool>` finds nothing, but elanous works

Some tools are fetched on demand by the package manager. Check what elanous actually reports with `elanous doctor` instead of looking at `PATH`.

## A count of "0" in a report

Before trusting a "0", check that the report looked where you think it did (`elanous where`, `elanous logs --all --include-test`) and that the output was not cut off by a limit (`--limit`).
