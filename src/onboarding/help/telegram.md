Telegram bot — Step 4 / 5

Chat with elanous from your phone. Three things needed:

  1) Bot token — DM @BotFather → /newbot → copy the
                  `12345:ABCdef...` token.

  2) Your user ID — DM @userinfobot → /start. Paste the numeric
                    `id: 123456789` value back here. The first
                    user ID you list is the "owner" (cron messages
                    deliver here by default).

  3) Optional: open the bot's privacy mode in @BotFather →
     /setprivacy → Disable so the bot can read group messages.

After setup, run `elanous telegram` to start the bot in a panel.
The wizard validates the token by calling /getMe — typos catch
immediately.

Skipping is fine — you can revisit any time:
    elanous setup telegram
