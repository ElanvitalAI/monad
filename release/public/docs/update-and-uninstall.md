# Update and uninstall

## Update

```bash
elanous self-update                  # latest release
elanous self-update --version 0.2.0  # a specific version
```

A release install updates by re-running the release installer; the previous version stays under `versions/` for rollback.

| Option | What it does |
|---|---|
| `--version <version>` | Install a specific release (default: latest) |
| `--restart` | Also restart the background service so it runs the new version |
| `--keep <n>` | How many recent versions to keep after installing (default 3; the current and previous are always kept) |
| `--json` | Structured result |

### `elanous update` and automatic updates

```bash
elanous update                # same as self-update
elanous update --auto on      # update every day
elanous update --auto status  # is it on?
elanous update --auto off
```

`--auto on` installs a daily job — a launchd agent on macOS, a systemd user timer on Linux — that runs `self-update --restart --alert` at 04:17 local time. It is not turned on if a cron entry already runs the update.

## Moving from monad

Elanous 0.2.0 is monad renamed — same project, new command (`elanous`), folders (`~/.elanous`, `~/.local/share/elanous`), `ELANOUS_*` variables and service names.

:::warning Don't move with `monad update`
The old updater doesn't know the new install folder. Turn automatic updates off (`monad update --auto off`), install Elanous fresh with the one-line installer, then run the migration script it ships.
:::

The exact steps — the migration script (a dry run first), macOS and Linux services, what stays behind — are in the [0.2.0 release notes](0.2.0.md#moving-from-monad).

## Uninstall

```bash
curl -fsSL https://github.com/ElanvitalAI/elanous/releases/latest/download/uninstall.sh | bash
```

It removes what the installer created (`versions/`, `current`, `bin/`, `install.json`) and the PATH lines it added. Anything else in the install folder is kept and named — your memories live there (`~/.local/share/elanous/memory`). Your state folder (`~/.elanous`: logins, logs, ledgers, config) is **not** removed either. If you installed the background service, run `elanous nexus uninstall --launchd` (macOS) or `--systemd-user` (Linux) first.

:::info Available from 0.1.1
`uninstall.sh` ships as a release asset from 0.1.1. Use that one even on a 0.1.0 install — the copy bundled with 0.1.0 removes the whole install folder, memories included.
:::
