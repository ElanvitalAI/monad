// X9 (2026-04-30) — Discord voice message attachment adapter.
//
// Discord users can send voice notes / audio attachments inside text
// channels and DMs. This adapter turns those files into transcripts
// and, optionally, synthesized voice replies. Unlike the Telegram
// adapter, Discord's product flavor is text-first: callers typically
// keep the assistant transcript in the channel and may add a voice
// attachment as a second artifact rather than replacing text entirely.

import { spawn } from 'node:child_process';
import { debug } from '../../debug/log.js';
import type { STTProvider } from '../stt-provider.js';
import type { TTSProvider } from '../tts/tts-provider.js';
import {
  generateVoiceMessageReply,
  normalizeVoiceMessageReplyMode,
  transcribeVoiceMessageInput,
  type VoiceMessageCodec,
  type VoiceMessageReplyMode,
} from './voice-message-core.js';

export type DiscordVoiceReplyMode = VoiceMessageReplyMode;

export interface DiscordVoiceTranscriptResult {
  transcript: string;
  language?: string;
  durationMs?: number;
}

export interface DiscordVoiceReply {
  text: string;
  voiceAttachment: Buffer | null;
}

export interface DiscordVoiceCodec extends VoiceMessageCodec {}

export interface DiscordVoiceAttachmentInfo {
  filename?: string;
  contentType?: string;
}

export interface DiscordVoiceAdapter {
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly replyMode: DiscordVoiceReplyMode;
  transcribeAttachment(
    input: Buffer,
    attachment?: DiscordVoiceAttachmentInfo,
    opts?: { language?: string },
  ): Promise<DiscordVoiceTranscriptResult>;
  generateReply(replyText: string, opts: { fromVoice: boolean }): Promise<DiscordVoiceReply>;
}

export class DiscordVoiceUnavailableError extends Error {
  constructor(hint: string) {
    super(`Discord voice message unavailable — ${hint}`);
    this.name = 'DiscordVoiceUnavailableError';
  }
}

interface SoxBinarySpec {
  binaryPath?: string;
}

export function createSoxDiscordVoiceCodec(spec: SoxBinarySpec = {}): DiscordVoiceCodec {
  const bin = spec.binaryPath ?? 'sox';
  return {
    inputToPcm16k(input) {
      const inputType = sniffDiscordInputType(input);
      return runSoxConversion(bin, input, [
        '-q',
        '-t', inputType, '-',
        '-t', 'raw', '-r', '16000', '-e', 'signed', '-b', '16', '-c', '1',
        '-',
      ]);
    },
    pcm24kToOutput(pcm) {
      return runSoxConversion(bin, pcm, [
        '-q',
        '-t', 'raw', '-r', '24000', '-e', 'signed', '-b', '16', '-c', '1', '-',
        '-t', 'ogg', '-C', '-1',
        '-',
      ]);
    },
  };
}

function sniffDiscordInputType(input: Buffer): 'ogg' | 'wav' | 'mp3' | 'flac' {
  if (input.byteLength >= 4) {
    const head4 = input.subarray(0, 4).toString('ascii');
    if (head4 === 'OggS') return 'ogg';
    if (head4 === 'RIFF') return 'wav';
    if (head4 === 'fLaC') return 'flac';
    if (head4 === 'ID3\x04' || head4.startsWith('ID3')) return 'mp3';
  }
  if (input.byteLength >= 2 && input[0] === 0xff && (input[1] & 0xe0) === 0xe0) {
    return 'mp3';
  }
  return 'ogg';
}

async function runSoxConversion(bin: string, input: Buffer, args: string[]): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`sox exited with code ${code}: ${stderr.trim()}`));
      }
    });
    child.stdin.end(input);
  });
}

export interface DiscordVoiceAdapterOpts {
  sttProvider: STTProvider | null | undefined;
  ttsProvider?: TTSProvider | null | undefined;
  replyMode?: DiscordVoiceReplyMode;
  codec?: DiscordVoiceCodec;
  voiceLanguage?: string;
}

export function createDiscordVoiceAdapter(
  opts: DiscordVoiceAdapterOpts,
): DiscordVoiceAdapter {
  const replyMode: DiscordVoiceReplyMode = opts.replyMode ?? 'auto';
  const codec = opts.codec ?? createSoxDiscordVoiceCodec();

  if (!opts.sttProvider) {
    const reason = 'sttProvider not supplied — Discord voice message path requires an STT provider';
    if (debug.enabled)
      debug.log('voice.discord.msg', 'unavailable', { reason });
    return {
      available: false,
      unavailableReason: reason,
      replyMode,
      transcribeAttachment: () => Promise.reject(new DiscordVoiceUnavailableError(reason)),
      generateReply: () => Promise.reject(new DiscordVoiceUnavailableError(reason)),
    };
  }

  const stt = opts.sttProvider;
  const tts = opts.ttsProvider ?? null;

  async function transcribeAttachment(
    input: Buffer,
    _attachment?: DiscordVoiceAttachmentInfo,
    opts2: { language?: string } = {},
  ): Promise<DiscordVoiceTranscriptResult> {
    if (debug.enabled)
      debug.log('voice.discord.msg', 'transcribe.begin', { bytes: input.byteLength });
    const lang = opts2.language ?? opts.voiceLanguage;
    const result = await transcribeVoiceMessageInput(
      codec,
      stt,
      input,
      lang ? { language: lang } : {},
    );
    if (debug.enabled)
      debug.log('voice.discord.msg', 'transcribe.ok', {
        chars: result.transcript.length,
        language: result.language ?? null,
      });
    return result;
  }

  async function generateReply(
    replyText: string,
    opts2: { fromVoice: boolean },
  ): Promise<DiscordVoiceReply> {
    if (debug.enabled && tts)
      debug.log('voice.discord.msg', 'reply.tts.begin', { chars: replyText.length });
    const reply = await generateVoiceMessageReply(
      codec,
      tts,
      replyMode,
      replyText,
      opts2,
    );
    if (debug.enabled && reply.voiceBlob)
      debug.log('voice.discord.msg', 'reply.tts.ok', { bytes: reply.voiceBlob.byteLength });
    return { text: reply.text, voiceAttachment: reply.voiceBlob };
  }

  return {
    available: true,
    unavailableReason: null,
    replyMode,
    transcribeAttachment,
    generateReply,
  };
}

export function normalizeDiscordVoiceReplyMode(v: unknown): DiscordVoiceReplyMode {
  return normalizeVoiceMessageReplyMode(v);
}
