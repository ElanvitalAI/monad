# Update and uninstall

## Update

```bash
monad self-update                  # latest release
monad self-update --version 0.1.1  # a specific version
```

A release install updates by re-running the release installer; the previous version stays under `versions/` for rollback.

## Uninstall

```bash
curl -fsSL https://github.com/ElanvitalAI/monad/releases/latest/download/uninstall.sh | bash
```

It removes what the installer created (`versions/`, `current`, `bin/`, `install.json`) and the PATH lines it added. Anything else in the install folder is kept and named — your memories live there (`~/.local/share/monad/memory`). Your state folder (`~/.monad`: logins, logs, ledgers, config) is **not** removed either. If you installed the background service, run `monad nexus uninstall --launchd` (macOS) or `--systemd-user` (Linux) first.

:::info Available from 0.1.1
`uninstall.sh` ships as a release asset from 0.1.1. Use that one even on a 0.1.0 install — the copy bundled with 0.1.0 removes the whole install folder, memories included.
:::
