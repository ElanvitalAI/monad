Discord bot — Step 5 / 5

Chat with elanous in any Discord server / DM. Setup steps:

  1) Create the bot:
     https://discord.com/developers/applications →
     New Application → Bot tab → Reset Token → copy.

  2) Get your user ID:
     Discord client → Settings → Advanced → enable Developer
     Mode. Right-click your name → Copy User ID. Snowflakes are
     long (17-19 digits).

  3) Enable Message Content Intent:
     Bot tab → Privileged Gateway Intents → enable Message
     Content Intent. Required for DM replies.

  4) Invite the bot to a server:
     OAuth2 tab → URL Generator → check "bot" scope → pick
     permissions (at least Read / Send Messages) → copy URL →
     paste into a browser → choose your server.

The wizard validates the token by calling /users/@me — typos
catch immediately.

Skipping is fine — re-run via:
    elanous setup discord
