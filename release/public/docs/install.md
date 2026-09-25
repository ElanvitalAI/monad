# Install

monad runs on **Bun** (not Node) on macOS, Linux and WSL2.

## What you need first

| Tool | Why | Required? |
|---|---|---|
| `bash`, `curl`, `tar` | the installer | yes |
| `git` | the harness works in git worktrees | yes |
| `bun` | runtime | installed for you if missing (see below) |
| `gh` (GitHub CLI) | the harness opens pull requests | only if you want PRs |

## Install from a checkout

```bash
git clone <repository URL> monad && cd monad
bash scripts/install.sh
```

The installer:

- installs `bun` with its official installer if it is missing (turn this off with `--no-bootstrap-bun`),
- installs into `~/.local/share/monad` (override with `--prefix PATH` or `MONAD_INSTALL_PREFIX`),
- adds `~/.local/share/monad/bin` to your shell `PATH` (skip with `--no-modify-path`),
- ends by telling you the next step based on what it found (for example, whether you are logged in yet).

Open a new shell (or add the `bin` directory to `PATH` yourself), then check:

```bash
monad --version     # prints the version and the commit it was installed from
```

## Install from a package file

If you have a package tarball (`.tgz`) — a local file or a URL:

```bash
bash scripts/install.sh --source ./monadagent-1.0.0.tgz
curl -fsSL <install.sh URL> | bash -s -- --source <package .tgz URL>
```

## Windows (native PowerShell) — experimental

WSL2 is the recommended way to run monad on Windows. A native install works for the command itself
(verified on Windows 11 with Windows PowerShell 5.1 and PowerShell 7.6); deeper features (terminal sessions,
the harness) are not verified there yet.

```powershell
irm bun.sh/install.ps1 | iex                                            # bun, if you do not have it
powershell -ExecutionPolicy Bypass -File scripts\install.ps1            # from a checkout
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Source .\monadagent-1.0.0.tgz
monad --version
```

It installs into `%LOCALAPPDATA%\monad` (override with `-Prefix PATH` or `MONAD_INSTALL_PREFIX`) with the same
layout as below — `current` is a directory junction, so no administrator rights are needed — and adds
`bin` to your PowerShell profile (skip with `-NoModifyPath`).

## Layout

```
~/.local/share/monad/
  versions/<version>-<commit>/   one folder per installed build (older ones are kept)
  current -> versions/…          the active build
  bin/monad                      the command on your PATH
  install.json                   what is installed, from where, which commit
```

Your settings, logins and logs live separately in `~/.monad` and are never touched by the installer.

## Upgrade and roll back

```bash
cd monad && git pull && monad self-update            # install; tells you whether the service needs a restart
monad self-update --restart                          # same, and restart the service only if it is needed
ln -sfn versions/<previous build> ~/.local/share/monad/current      # roll back
```

If you run the background service (`monad nexus`), restart it after an upgrade — see [troubleshooting](troubleshooting.md#the-service-still-runs-the-old-version).

## Known limits

- The **web app (PWA)** is not inside the installed package yet. To use it, build it from a checkout (`monad nexus build` in the checkout) and point the service at it with `MONAD_PWA_STATIC_DIR=<checkout>/apps/pwa/out`.
- On Linux, `node-pty` has no prebuilt binary; monad falls back to Bun's own PTY and nothing breaks.
- If `bun install` silently skips an optional dependency on Linux, check whether `TMPDIR` and Bun's cache are on different filesystems — `monad doctor` reports it as `bun-tmpdir`, and `monad doctor --fix --yes` adds the fix to your shell startup file. See [troubleshooting](troubleshooting.md#bun-skips-an-optional-dependency).

Next: [quickstart](quickstart.md).
