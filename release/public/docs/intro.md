# What is Elanous

**Give it a goal — it plans, builds, verifies and merges on its own. It watches itself, understands what it sees, and heals itself.**

- **Observe** — it sees its own actions through logs, screens and memory.
- **Understand** — it judges context on top of what it sees.
- **Heal** — it fixes itself, and asks a person when it cannot.

In practice, `elanous` takes a change described in one sentence, writes a goal document, implements it in an isolated git worktree, gates it with tests, reviews it unattended and merges it. You are called only when the system cannot converge.

```bash
curl -fsSL https://github.com/ElanvitalAI/elanous/releases/latest/download/install.sh | bash
elanous harness say "add a --json flag to the status command"
```

Start with [Install](install.md) and the [Quickstart](quickstart.md).
