# Telegram

Set up in the wizard (step 4) or edit `config.json` directly:
```json
"telegram": {
  "enabled": true,
  "botToken": "123456:ABC...",         // from @BotFather
  "allowedUsers": [42, 100],           // from @userinfobot — first = owner
  "homeChannel": -1001234567890        // optional; for cron deliveries
}
```

Run the bot daemon (long-polling, Ctrl+C to exit):
```bash
monad telegram
```

Every incoming chat+thread maps to a per-conversation session. Messages
persist to the same session store as CLI chats; you can `monad session
list --source telegram` to audit. Replies chunk automatically at 4000
chars; `parameters.retry_after` on 429 is respected.

Unknown user IDs (not in `allowedUsers`) get a polite refusal and
nothing else. Empty allowlist = fail-open (solo-dev convenience).
