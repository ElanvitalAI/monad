# Sessions

Conversation history persists to `~/.local/share/elanous/sessions/` as
append-only JSONL (one file per session), with an index at
`index.json`. The "active" session lives at
`~/.local/state/elanous/active`.

```bash
elanous session list                   # recent sessions (newest first)
elanous session new                    # start a fresh one, mark active
elanous session resume <idPrefix>      # resume by full id or short prefix
elanous session show [idPrefix]        # print transcript of active / given session
elanous session delete <idPrefix>      # remove a session

elanous chat "hello world"             # one-shot turn in active session
elanous chat --new "fresh topic"       # force a new session
```

`elanous chat` streams the provider response to stdout and persists both
sides of the turn. Token budget is estimated (rough `chars/4` heuristic)
and surfaced in the footer line.
