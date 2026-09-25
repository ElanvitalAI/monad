# Sessions

Conversation history persists to `~/.local/share/monad/sessions/` as
append-only JSONL (one file per session), with an index at
`index.json`. The "active" session lives at
`~/.local/state/monad/active`.

```bash
monad session list                   # recent sessions (newest first)
monad session new                    # start a fresh one, mark active
monad session resume <idPrefix>      # resume by full id or short prefix
monad session show [idPrefix]        # print transcript of active / given session
monad session delete <idPrefix>      # remove a session

monad chat "hello world"             # one-shot turn in active session
monad chat --new "fresh topic"       # force a new session
```

`monad chat` streams the provider response to stdout and persists both
sides of the turn. Token budget is estimated (rough `chars/4` heuristic)
and surfaced in the footer line.
