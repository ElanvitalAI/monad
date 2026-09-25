// M4c real-device smoke — Discord voice channel stack (dormant since
// 2026-04-30) against the LIVE gateway. Verifies, in order:
//
//   1. gateway session + voiceTap READY latch (coordinator.getSessionId)
//   2. voice-state handshake: op-4 join → VOICE_SERVER_UPDATE → voice
//      WS → UDP discovery → encryption negotiate → Ready
//      (this is the path the 2026-04-30 double-wrap bug broke — see
//      discord-voice-gateway-adapter.ts sendPayload)
//   3. outbound audio: 1.5 s 440 Hz sine @24 kHz mono s16 → resample →
//      opusscript(WASM) encode → RTP send (errors here = codec/crypto
//      dependency regression under Bun)
//   4. inbound audio: logs decoded PCM packets if a human speaks in the
//      channel during the --stay window (optional, needs a human)
//
// Usage:
//   bun run scripts/discord-voice-smoke.ts [--guild <id>] [--channel <id>]
//     [--stay <seconds>] [--tone]      # --tone plays the sine on join
//
// Defaults: guild/channel resolved via REST (first voice channel found).
// Token: `discord.botToken` from ~/.monad/config.json — SAME app as
// production; a second gateway session is safe (concurrent sessions OK,
// one voice connection per guild per user).
//
// Exit 0 = Ready reached (+ tone sent if requested). Exit 1 = any stage
// failed; the failing stage is the last "STAGE" line printed.

import { getUserConfig } from '../src/user-config.js';
import { DiscordBot } from '../src/discord.js';
import { createDiscordVoiceGatewayCoordinator } from '../src/voice/channel-adapters/discord-voice-gateway-adapter.js';
import { bootDiscordVoiceChannel } from '../src/voice/channel-adapters/discord-voice-channel-host-boot.js';
import { debug } from '../src/debug/log.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const stage = (msg: string): void => { console.log(`[smoke] STAGE ${msg}`); };
const info = (msg: string): void => { console.log(`[smoke] ${msg}`); };

async function main(): Promise<void> {
  // The stack's own gate — smoke always wants the production adapter.
  process.env.MONAD_DISCORD_VOICE_CHANNEL = '1';
  debug.setLevel('diag'); // voice.discord.* hot-path events → debug log file

  const cfg = getUserConfig();
  const token = cfg.discord.botToken?.trim();
  if (!token) throw new Error('discord.botToken missing in config');

  let guildId = arg('guild');
  let channelId = arg('channel');
  if (!guildId || !channelId) {
    stage('rest.discover — resolving guild + first voice channel via REST');
    const auth = { headers: { Authorization: `Bot ${token}` } };
    const guilds = await (await fetch('https://discord.com/api/v10/users/@me/guilds', auth)).json() as Array<{ id: string; name: string }>;
    if (!Array.isArray(guilds) || guilds.length === 0) throw new Error('bot is in no guilds');
    guildId = guildId ?? guilds[0]!.id;
    const channels = await (await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, auth)).json() as Array<{ id: string; type: number; name: string }>;
    const voice = channels.find((c) => c.type === 2);
    if (!voice) throw new Error(`no voice channel in guild ${guildId}`);
    channelId = channelId ?? voice.id;
    info(`guild=${guildId} (${guilds[0]!.name}) voiceChannel=${channelId} (${voice.name})`);
  }

  stage('gateway.boot — starting dependency-free bot with voiceTap');
  let bot: DiscordBot | null = null;
  const coordinator = createDiscordVoiceGatewayCoordinator({
    sendPayload: (p) => bot?.sendGatewayPayload(p) ?? false,
  });
  bot = new DiscordBot({
    token,
    allowedUsers: [], // no message handling in the smoke
    onMessage: async () => undefined,
    voiceTap: coordinator.tap,
    log: (m) => { console.log(`[bot] ${m}`); },
  });
  void bot.start().catch((err: unknown) => {
    console.error(`[smoke] bot.start error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });

  // READY latch — voiceTap.onReady stamps sessionId + bot user id.
  const readyDeadline = Date.now() + 20_000;
  while (!coordinator.getSessionId()) {
    if (Date.now() > readyDeadline) throw new Error('gateway READY not observed within 20s');
    await new Promise((r) => setTimeout(r, 200));
  }
  info(`gateway READY — sessionId=${coordinator.getSessionId()} botUser=${coordinator.getBotUserId()}`);

  stage('voice.boot — bootDiscordVoiceChannel (production adapter path)');
  const vboot = bootDiscordVoiceChannel({ coordinator });
  if (!vboot.enabled) throw new Error('voice channel gate reads disabled despite MONAD_DISCORD_VOICE_CHANNEL=1');

  stage('voice.join — op-4 handshake → voice WS → UDP → Ready (30s window)');
  const session = await vboot.adapter.joinChannel({ guildId: guildId!, channelId: channelId! });
  info('✅ voice connection READY — protocol + encryption + deps alive');

  let inboundPackets = 0;
  let inboundBytes = 0;
  const speakers = new Set<string>();
  session.onAudioReceived((pcm, userId) => {
    inboundPackets += 1;
    inboundBytes += pcm.length;
    if (!speakers.has(userId)) {
      speakers.add(userId);
      info(`🎙 inbound audio from user ${userId} (decode path alive)`);
    }
  });
  session.onStateChange((s) => { info(`state → ${s}`); });

  if (hasFlag('tone')) {
    stage('voice.tone — 1.5s 440Hz sine @24k mono s16 → encode → send');
    const sr = 24_000;
    const secs = 1.5;
    const pcm = Buffer.alloc(Math.floor(sr * secs) * 2);
    for (let i = 0; i < sr * secs; i += 1) {
      pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 0.25 * 32767), i * 2);
    }
    session.sendAudio(pcm);
    info('tone queued — audible in the channel if outbound path is alive');
  }

  const staySecs = Number(arg('stay') ?? '15');
  stage(`voice.stay — holding ${staySecs}s (join the channel + speak to test inbound)`);
  await new Promise((r) => setTimeout(r, staySecs * 1000));
  info(`inbound during stay: ${inboundPackets} packets · ${inboundBytes} bytes · ${speakers.size} speaker(s)`);

  stage('voice.leave — teardown');
  await session.leave();
  await vboot.shutdown();
  bot.stop();
  info('✅ SMOKE PASS');
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(`[smoke] ❌ FAIL: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
