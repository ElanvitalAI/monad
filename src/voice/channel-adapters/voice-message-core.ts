import {
  buildTurnOutputTextBlocks,
} from '../../input/turn-output-block.js';
import { selectTurnOutputTextForSink } from '../../input/turn-output-sink-registry.js';
import type { STTProvider } from '../stt-provider.js';
import type { TTSProvider } from '../tts/tts-provider.js';

export type VoiceMessageReplyMode = 'auto' | 'text' | 'voice';

export interface VoiceMessageCodec {
  /** Channel-native audio blob → 16 kHz mono int16 PCM for batch STT. */
  inputToPcm16k(input: Buffer): Promise<Buffer>;
  /** 24 kHz mono int16 PCM from TTS → channel-native audio blob. */
  pcm24kToOutput(pcm: Buffer): Promise<Buffer>;
}

export interface VoiceMessageTranscriptResult {
  transcript: string;
  language?: string;
  durationMs?: number;
}

export interface VoiceMessageReply {
  text: string;
  voiceBlob: Buffer | null;
}

export function buildSpeakableVoiceReplyText(replyText: string): string {
  return selectTurnOutputTextForSink('audio-tts', buildTurnOutputTextBlocks(replyText)) ?? '';
}

export function normalizeVoiceMessageReplyMode(v: unknown): VoiceMessageReplyMode {
  if (v === 'text' || v === 'voice') return v;
  return 'auto';
}

export function resolveVoiceMessageReplyMode(
  replyMode: VoiceMessageReplyMode,
  fromVoice: boolean,
): 'text' | 'voice' {
  if (replyMode === 'text') return 'text';
  if (replyMode === 'voice') return 'voice';
  return fromVoice ? 'voice' : 'text';
}

export async function transcribeVoiceMessageInput(
  codec: VoiceMessageCodec,
  stt: STTProvider,
  input: Buffer,
  opts: { language?: string } = {},
): Promise<VoiceMessageTranscriptResult> {
  const pcm = await codec.inputToPcm16k(input);
  const result = await stt.transcribeBatch(
    pcm,
    opts.language ? { language: opts.language } : undefined,
  );
  return {
    transcript: result.text,
    language: result.language,
    durationMs: result.durationMs,
  };
}

export async function generateVoiceMessageReply(
  codec: VoiceMessageCodec,
  tts: TTSProvider | null,
  replyMode: VoiceMessageReplyMode,
  replyText: string,
  opts: { fromVoice: boolean },
): Promise<VoiceMessageReply> {
  const resolved = resolveVoiceMessageReplyMode(replyMode, opts.fromVoice);
  if (resolved === 'text' || !tts) {
    return { text: replyText, voiceBlob: null };
  }
  const speakableText = buildSpeakableVoiceReplyText(replyText);
  const ttsResult = await tts.synthesizeBatch(speakableText || replyText);
  const voiceBlob = await codec.pcm24kToOutput(ttsResult.pcm);
  return { text: replyText, voiceBlob };
}
