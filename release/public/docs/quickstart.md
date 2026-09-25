# Quickstart

From an installed `monad` to a first change made for you — three commands if you already have a ChatGPT subscription and are signed in to GitHub.

## 1. See what is missing

```bash
monad doctor
```

`doctor` is a report, not a gate: it exits 0 even with nothing configured. For each credential it says whether it resolves, where it came from, what it unlocks, and whether a free fallback exists. Its readiness section names anything that would trip you up next, with one command each; `monad doctor --fix` shows the repairs it can make for you, and `--fix --yes` applies them.

## 2. Sign in to a model

The main path is a **subscription**, not an API key:

```bash
monad login openai-codex                     # ChatGPT device-code sign-in
monad login status                           # which providers have tokens
# with the default llm.provider=auto, a ChatGPT sign-in is used first
```

Other choices (xAI Grok, OpenRouter for Kimi / GLM / Qwen, Anthropic, Gemini, a local model) are in [providers](providers.md).

## 3. Ask for a change

Go to the project you want changed and say what you want in one sentence:

```bash
cd ~/my-project
monad harness say "add a Usage section to the README with the three commands a new user runs"
```

What happens:

1. monad writes a goal from your sentence,
2. works on it in a separate git worktree (your working tree is not touched),
3. runs the project's tests for the files it changed,
4. reviews its own change and reworks it if the review finds problems,
5. finishes with a pull request (when the repository has a GitHub remote and `gh` is signed in) or with a branch you can merge yourself (no remote).

Add `--no-auto-merge` if you want to merge pull requests yourself. Add `--dry-run` to see the plan without starting.

## 4. Talk to it directly

```bash
monad ask "what does src/app.ts do?"   # one question, one answer
monad agent "why is the build failing?" # one turn with file and shell tools
monad                                    # the terminal UI
```

## Where to look next

- [commands](commands.md) — the commands you will actually use
- [configuration](configuration.md) — where settings live and how to change them
- [troubleshooting](troubleshooting.md) — messages that look like one thing and mean another
