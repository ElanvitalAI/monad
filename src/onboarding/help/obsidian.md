Obsidian vault — Step 3 / 5

Absolute path to your Obsidian vault's root directory (the folder
that contains the `.obsidian/` marker). Used by:

  · the Obsidian browser pane (`Ctrl-B o`)
  · vault-save skills (saving research output as a note)
  · the Obsidian-write tool surface

If you don't use Obsidian, point this at any directory you want
to use as a notes root — elanous treats it as a generic markdown
vault. Path doesn't have to exist when you set it; we'll warn
but keep going.

Default: `$OBSIDIAN_VAULT` env var if set, else
`$HOME/Documents/Obsidian`.
