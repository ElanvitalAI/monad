# What is elanous

elanous takes a change described in one sentence, writes a goal document, implements it in an isolated git worktree, gates it with tests, reviews it unattended and merges it. You are called only when the system cannot converge.

```bash
curl -fsSL https://github.com/ElanvitalAI/elanous/releases/latest/download/install.sh | bash
elanous harness say "add a --json flag to the status command"
```

Start with [Install](install.md) and the [Quickstart](quickstart.md).
