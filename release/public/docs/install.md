# Install

elanous runs on **Bun** (not Node) on macOS, Linux and WSL2; Windows native PowerShell is experimental.

## One line

```bash
curl -fsSL https://github.com/ElanvitalAI/elanous/releases/latest/download/install.sh | bash
```

The installer:

- downloads the latest release and checks it against `SHA256SUMS` — a mismatch stops the install,
- installs `bun` with its official installer if it is missing, at the version pinned in `.bun-version` (turn this off with `--no-bootstrap-bun`; `ELANOUS_BUN_VERSION=latest` lifts the pin),
- installs into `~/.local/share/elanous` (override with `--prefix PATH` or `ELANOUS_INSTALL_PREFIX`),
- adds `~/.local/share/elanous/bin` to your shell `PATH` (skip with `--no-modify-path`),
- if a command it needs is missing, names **all** of them in one install line (without `sudo` when you are root),
- ends by telling you the next step based on what it found (for example, whether you are logged in yet).

Open a new shell, then check:

```bash
elanous --version     # prints the version and the commit it was built from
elanous doctor        # what this machine still needs — a report, not a gate
```

Pin a version with `ELANOUS_VERSION`:

```bash
curl -fsSL https://github.com/ElanvitalAI/elanous/releases/latest/download/install.sh | ELANOUS_VERSION=0.1.1 bash
```

## Windows (native PowerShell) — experimental

```powershell
irm https://github.com/ElanvitalAI/elanous/releases/latest/download/install.ps1 | iex
elanous --version
```

It installs into `%LOCALAPPDATA%\elanous` (override with `-Prefix PATH` or `ELANOUS_INSTALL_PREFIX`) with the same layout as below — `current` is a directory junction, so no administrator rights are needed — and adds `bin` to your PowerShell profile (skip with `-NoModifyPath`). WSL2 remains the recommended way to run the harness on Windows.

## From a bare Linux machine

A bare image may not even have `curl`, so install the basics first:

```bash
sudo apt-get update && sudo apt-get install -y curl ca-certificates unzip git
curl -fsSL https://github.com/ElanvitalAI/elanous/releases/latest/download/install.sh | bash
source ~/.bashrc
elanous --version && elanous doctor
```

That is enough to boot. To run the daemon and the harness, let `doctor` install what they need — build tools and the node-pty rebuild, a pinned static `gh`, `rg`, Node and the Codex CLI (about 80 seconds on a bare Debian 12 VM):

```bash
elanous doctor --fix --yes --sudo
```

- ⚠️ Do **not** install `gh` from Debian/Ubuntu apt — those packages (Debian 12: 2.23, Ubuntu 24.04: 2.45) are older than the 2.80 the harness needs. `elanous doctor --fix --yes` fetches a pinned one.
- If terminal features stay dark, run `elanous doctor --fix --yes` again — it rebuilds `node-pty` for the installed version. Re-running the installer on the same version does not.
- Prefer to install by hand? `sudo apt-get install -y build-essential ripgrep`, Node 20+ and `npm install -g @openai/codex` are the equivalent.

## Run the daemon in the background

```bash
elanous nexus install --systemd-user    # Linux: active, enabled, and survives reboots without a login
elanous nexus install --launchd         # macOS
```

The daemon's port answers about 30 seconds after it starts.

## From a checkout

```bash
git clone https://github.com/ElanvitalAI/elanous && cd elanous
bash scripts/install.sh               # same installer, installing this checkout (folder named by commit)
```

## Layout

```
~/.local/share/elanous/
  versions/<version>/            one folder per installed version (older ones are kept)
  current -> versions/…          the active version
  bin/elanous                      the command on your PATH
  install.json                   what is installed, from where, which commit
```

Your settings, logins and logs live in `~/.elanous`; your memory lives in `~/.local/share/elanous/memory` (inside the install folder). The installer never touches either, and the uninstaller removes only what the installer created (`versions/`, `current`, `bin/`, `install.json`) and names everything it keeps.

## Update, roll back, uninstall

```bash
elanous self-update                              # latest release; the previous version stays for rollback
elanous self-update --version 0.1.1              # a specific release
ln -sfn versions/<previous> ~/.local/share/elanous/current      # roll back
curl -fsSL https://github.com/ElanvitalAI/elanous/releases/latest/download/uninstall.sh | bash
```

If you run the background service, restart it after an update — see [troubleshooting](troubleshooting.md#the-service-still-runs-the-old-version).

## Known limits

- On Linux, `node-pty` has no prebuilt binary; elanous falls back to Bun's own PTY and nothing breaks. `elanous doctor --fix --yes` rebuilds it when a C++ toolchain is present.
- If `bun install` silently skips an optional dependency on Linux, check whether `TMPDIR` and Bun's cache are on different filesystems — `elanous doctor` reports it as `bun-tmpdir`, and `elanous doctor --fix --yes` adds the fix to your shell startup file. See [troubleshooting](troubleshooting.md#bun-skips-an-optional-dependency).

Next: [quickstart](quickstart.md).
