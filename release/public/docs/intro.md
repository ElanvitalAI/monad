# What is monad

monad takes a change described in one sentence, writes a goal document, implements it in an isolated git worktree, gates it with tests, reviews it unattended and merges it. You are called only when the system cannot converge.

```bash
curl -fsSL https://github.com/ElanvitalAI/monad/releases/latest/download/install.sh | bash
monad harness say "add a --json flag to the status command"
```

Start with [Install](install.md) and the [Quickstart](quickstart.md).
