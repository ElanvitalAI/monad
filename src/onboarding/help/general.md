elanous — setup wizard

The wizard walks you through 5 steps:

  1) LLM provider     — pick your provider, enter an API key
  2) Skill directories — pick a preset (opencode / claudecode / codex / hermes / openclaw)
  3) Obsidian vault   — absolute path to your vault root
  4) Telegram bot     — optional · chat from your phone
  5) Discord bot      — optional · chat from any Discord server

Tips:

  · Press Enter at any prompt to accept the default in [brackets].
  · Type "?" or "help" at any prompt for context-specific help.
  · Press Esc / Ctrl-C to cancel — no config is written.
  · Re-run `elanous setup` any time to revisit answers, or `elanous
    setup <step>` to update just one step.
  · Drop a JSON file at ~/.config/elanous/setup-answers.json and run
    `elanous setup --non-interactive` to deploy without prompts.
