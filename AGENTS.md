# AGENTS.md

Instructions for coding agents (and humans) working in this repository.

## What monad is

monad is a self-hosting agent runtime: a CLI, a local daemon, and a harness that
turns a one-line request into a goal document, runs an implementer in an isolated
git worktree, gates it with tests, reviews it, and opens a pull request.

## Toolchain

- Runtime and package manager: **bun** (see `package.json` `engines`).
- Install dependencies: `bun install`
- Run the CLI from a checkout: `bun bin/monad.mjs <command>`
- Health check: `bun bin/monad.mjs doctor` — names every missing credential and what stops working without it.

## Working agreement

- Read `git status` before editing. Keep unrelated changes out of your commit.
- Reproduce a defect through its real entry point before fixing it. A unit test that
  never reaches the execution path is not proof that the path works.
- Prefer extending an existing owner (module, command, catalog entry) over adding a
  parallel one. Search first: `rg -uu <name>`.
- Do not hard-code model names. Resolve them from the tier ladder
  (`src/model-tier/`) so a model migration does not leave stale names behind.
- Observability is part of the change: autonomous or self-healing logic records its
  decisions with `debug.log('<component>.<subsystem>', '<event>', data)`.

## Tests

- Run the tests for the files you changed: `bun test <path>`.
- Type-check changed files: `bun run scripts/ci-typecheck-changed.ts`.
- The full suite is `bun run test:deterministic`. Judge a change by whether it adds a
  **new** failure, not by the absolute count.
- A new test should fail when the change is reverted. Check that before you rely on it.

## Pull requests

- One coherent change per PR. Describe the situation, the problem, and what changed.
- Include the commands you ran and their results.
- Do not commit local state: `.monad/` (goal documents, logs, run artifacts) is
  ignored on purpose.
