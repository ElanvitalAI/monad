# External commands

Beyond Bun and git, elanous spawns these. None are needed to boot; each gates
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
