// Multimedia → ACP ContentBlock normalization.
//
// Messengers deliver attachments in platform-specific shapes (Telegram
// photo/voice/document objects, Discord URL attachments). The ACP
// prompt surface is a uniform ContentBlock[], so we normalize at the
// bridge layer. Each backend (claude / codex / gemini) accepts the
// same block shapes; capability differences (image support, audio
// support) are advertised at initialize-time via PromptCapabilities,
// but for v1 we just send the blocks and let the backend decide —
// mirrors zed's approach (acp_thread.rs ContentBlock normalization).
//
// Mapping matrix:
//   image (base64, mime known)            → { type:'image', data, mimeType }
//   audio/voice (local path)              → Whisper transcription → text block
//                                           (fallback: resource_link + inline hint)
//   text-extractable document (pdf/docx)  → extracted text prefixed with name
//   other document / unknown mime         → resource_link (file:// URI)
//   bare URL                              → resource_link (http(s) URI)

import { readFileSync } from 'node:fs';
import type { ContentBlock } from '@agentclientprotocol/sdk';
import type { Attachment } from '../context.js';
import type { ContentBlock as LLMContentBlock } from '../llm.js';

export interface NormalizedAttachment {
  /** Descriptive name shown to the LLM + logged on failure. */
  name: string;
  /** Absolute path to the local file. */
  localPath: string;
  /** MIME type if known — guides extractor selection. */
  mimeType?: string;
  /** "photo" | "voice" | "audio" | "document" — mirrors the
   *  TgAttachmentKind labels but agnostic to the source messenger. */
  kind: 'photo' | 'voice' | 'audio' | 'document' | 'unknown';
  /** Source URL when the attachment came from Discord (native URL)
   *  or an LLM-pasted link. Used for ResourceLink blocks. */
  sourceUrl?: string;
  /** Extra info for the inline label (dimensions, duration, size).
   *  Any field may be absent. */
  width?: number;
  height?: number;
  duration?: number;
  sizeBytes?: number;
}

/** Shape emitted for each attachment. `blocks` goes into the ACP
 *  PromptRequest; `summary` is an inline text note folded into the
 *  user's prompt so the LLM sees "the user attached X" even when the
 *  backend doesn't render the block type (e.g. claude-code rejecting
 *  image_block during a codebase task). */
export interface NormalizedContent {
  blocks: ContentBlock[];
  /** Short inline summary like "[photo 1920×1080]" or
   *  "[document: report.pdf]". Joined into the text block. */
  summary?: string;
}

/** Read a local image file and pack it into an ACP image block.
 *  MIME is taken from the passed value or inferred from the file
 *  extension. Large images (>10 MB decoded) should really be routed
 *  via resource_link instead — guard against OOM by capping here. */
const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;

export function localImageToBlock(
  localPath: string,
  mimeType?: string,
): ContentBlock {
  const bytes = readFileSync(localPath);
  if (bytes.byteLength > MAX_INLINE_IMAGE_BYTES) {
    throw new Error(
      `image ${localPath} is ${bytes.byteLength} bytes — exceeds ${MAX_INLINE_IMAGE_BYTES} inline cap. ` +
      'Use a resource_link or downscale before sending.',
    );
  }
  const mt = mimeType ?? inferImageMime(localPath);
  return {
    type: 'image',
    data: bytes.toString('base64'),
    mimeType: mt,
  };
}

function inferImageMime(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'png':  return 'image/png';
    case 'gif':  return 'image/gif';
    case 'webp': return 'image/webp';
    case 'jpg':
    case 'jpeg':
    default:     return 'image/jpeg';
  }
}

/** Build a resource_link block for a file — preferred when the
 *  backend can read the local file itself (via its fs tool) rather
 *  than having us inline the bytes. `file://` URI per RFC 8089. */
export function localFileToResourceLink(
  localPath: string,
  opts: { name?: string; mimeType?: string; size?: number } = {},
): ContentBlock {
  const absolute = localPath.startsWith('/') ? localPath : `/${localPath}`;
  return {
    type: 'resource_link',
    uri: `file://${absolute}`,
    name: opts.name ?? localPath.split('/').pop() ?? localPath,
    ...(opts.mimeType ? { mimeType: opts.mimeType } : {}),
    ...(opts.size ? { size: opts.size } : {}),
  };
}

/** Build a resource_link for a bare URL (Discord attachment URL,
 *  user-pasted http link). The backend decides whether to fetch. */
export function urlToResourceLink(
  uri: string,
  opts: { name?: string; mimeType?: string } = {},
): ContentBlock {
  return {
    type: 'resource_link',
    uri,
    name: opts.name ?? uri.split('/').pop() ?? uri,
    ...(opts.mimeType ? { mimeType: opts.mimeType } : {}),
  };
}

/** Build a plain text block. Exists for API symmetry with the image /
 *  resource-link helpers above, so callers never have to hand-write
 *  `{ type: 'text', text: ... }`. */
export function textBlock(text: string): ContentBlock {
  return { type: 'text', text };
}

/** Phase 8 (2026-04-30) — read a local audio file and pack it into an
 *  ACP AudioContent block. Mirrors `localImageToBlock` for the
 *  voice/audio attachment path. The ACP `audio` content type
 *  (AudioContent in `@agentclientprotocol/sdk`) carries `data` (base64)
 *  + `mimeType`. Backends that advertise audio capability render it
 *  natively; backends without audio support typically drop or surface
 *  a placeholder.
 *
 *  Cap: 10 MB inline (same as image). Voice msgs from Telegram (.ogg
 *  Opus) and PWA (24 kHz mono PCM) are typically <2 MB for ~5 min of
 *  audio so the cap is comfortable.
 *
 *  See README of `@agentclientprotocol/sdk` for the full ContentBlock
 *  union; AudioContent matches ImageContent shape (`data` + `mimeType`).
 *
 *  Voice msg semantics (vs raw audio): the source attachment's `kind`
 *  ('voice' vs 'audio') is preserved at the NormalizedAttachment layer
 *  so callers can decide on different summary text or routing. The
 *  ACP block itself is type='audio' for both. */
const MAX_INLINE_AUDIO_BYTES = 10 * 1024 * 1024;

export function localAudioToBlock(
  localPath: string,
  mimeType?: string,
): ContentBlock {
  const bytes = readFileSync(localPath);
  if (bytes.byteLength > MAX_INLINE_AUDIO_BYTES) {
    throw new Error(
      `audio ${localPath} is ${bytes.byteLength} bytes — exceeds ${MAX_INLINE_AUDIO_BYTES} inline cap. ` +
      'Use a resource_link or downsample before sending.',
    );
  }
  return {
    type: 'audio',
    data: bytes.toString('base64'),
    mimeType: mimeType ?? inferAudioMime(localPath),
  } as ContentBlock;
}

function inferAudioMime(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'ogg':  return 'audio/ogg';
    case 'opus': return 'audio/opus';
    case 'mp3':  return 'audio/mpeg';
    case 'wav':  return 'audio/wav';
    case 'm4a':  return 'audio/mp4';
    case 'flac': return 'audio/flac';
    default:     return 'audio/ogg';
  }
}

/** PR7 (2026-05-14) — ACP video block kind 신설. Schema 정의 + server-side
 *  validation + LLM-side placeholder routing 만 — 실 native passthrough
 *  (Gemini Live · OpenAI Realtime) 는 향후 별 PR 의 capability advertise
 *  + provider routing 합쳐서 진행.
 *
 *  현 cut 의 의의: iOS / 다른 ACP client 가 `type:'video'` block 을 wire
 *  로 보낼 수 있게 하고, 서버는 graceful 하게 placeholder text 로 흡수
 *  (LLM 이 적어도 "사용자가 비디오를 첨부했다" 메타를 봄). 사용자가
 *  옵션 toggle 없이 frame extraction (PR5/PR6 기존 path) 가 default —
 *  본 PR 이 그 path 를 끊지 않음 (file-disjoint with existing iOS path).
 *
 *  ACP SDK `@agentclientprotocol/sdk` 의 ContentBlock union 은 1.0 시점
 *  video kind 미정의 — `as ContentBlock` 캐스트로 wire 송수신만 통과.
 *  audio 패턴과 동일.
 *
 *  Cap: 25 MB inline (image/audio 의 10MB 보다 큼 — 비디오 base64 가
 *  raw bytes 1.33× 부풀어서 raw 19MB ≈ base64 25MB. 더 크면
 *  resource_link 권장). */
const MAX_INLINE_VIDEO_BYTES = 25 * 1024 * 1024;

export function localVideoToBlock(
  localPath: string,
  mimeType?: string,
): ContentBlock {
  const bytes = readFileSync(localPath);
  if (bytes.byteLength > MAX_INLINE_VIDEO_BYTES) {
    throw new Error(
      `video ${localPath} is ${bytes.byteLength} bytes — exceeds ${MAX_INLINE_VIDEO_BYTES} inline cap. ` +
      'Use a resource_link or downscale before sending.',
    );
  }
  // ACP SDK 1.0 ContentBlock union 미정의 video kind — `as unknown as` 로
  // wire 송수신 통과 (audio 와 동일 패턴 · 향후 SDK 확장 시 정상 타입).
  return {
    type: 'video',
    data: bytes.toString('base64'),
    mimeType: mimeType ?? inferVideoMime(localPath),
  } as unknown as ContentBlock;
}

function inferVideoMime(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'mp4':  return 'video/mp4';
    case 'mov':  return 'video/quicktime';
    case 'm4v':  return 'video/x-m4v';
    case 'qt':   return 'video/quicktime';
    case 'avi':  return 'video/x-msvideo';
    case 'webm': return 'video/webm';
    case 'mkv':  return 'video/x-matroska';
    default:     return 'video/mp4';
  }
}

/** Build a transcribed-voice block bundle — when STT is available
 *  inline, callers (Telegram bot, PWA daemon relay) can emit BOTH the
 *  native audio block AND the transcribed text block alongside it.
 *  Backends with audio capability render the audio; backends without
 *  fall back to the text. Returns blocks in transcript-first order
 *  (the LLM reads text before audio when both are present so the
 *  transcript primes the response).
 *
 *  When `transcript` is empty, only the audio block is returned —
 *  caller may still want native audio routing without a transcript. */
export function buildTranscribedVoiceBlocks(opts: {
  localPath: string;
  mimeType?: string;
  transcript: string;
  language?: string;
}): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  if (opts.transcript) {
    const langTag = opts.language ? ` (${opts.language})` : '';
    blocks.push(textBlock(`[voice msg transcript${langTag}] ${opts.transcript}`));
  }
  try {
    blocks.push(localAudioToBlock(opts.localPath, opts.mimeType));
  } catch {
    // Oversize / read error — caller already has the transcript text
    // block which is the meaningful content.
  }
  return blocks;
}

/** Normalize a single attachment. The caller provides the already-
 *  downloaded local path + kind metadata; we pick the right ACP
 *  block shape. For audio / voice we leave transcription to a
 *  separate Whisper pass (the bridge can inject the transcribed
 *  text as a text block alongside — keeps this module pure). */
export function normalizeAttachment(att: NormalizedAttachment): NormalizedContent {
  if (att.kind === 'photo') {
    try {
      return {
        blocks: [localImageToBlock(att.localPath, att.mimeType)],
        // 저장 경로 포함(2026-07-12 dogfood): 첨부 블록은 그 턴 한정이라
        // 후속 continue 턴에서 모델이 이미지를 다시 볼 수단이 없어 경로를
        // 추측한 Read(EISDIR)로 미끄러졌다. claude code는 Read로 디스크
        // 이미지를 직접 보므로, 경로를 요약에 남기면 재열람이 가능하다.
        summary: `[photo ${att.width ?? '?'}×${att.height ?? '?'} · saved: ${att.localPath}]`,
      };
    } catch (err: any) {
      // Oversize / read error — fall back to a resource link so the
      // LLM at least sees the reference.
      return {
        blocks: [localFileToResourceLink(att.localPath, {
          name: att.name, mimeType: att.mimeType, size: att.sizeBytes,
        })],
        summary: `[photo ${att.name} (${err?.message ?? 'inline failed'})]`,
      };
    }
  }

  if (att.kind === 'voice' || att.kind === 'audio') {
    // Phase 8 (2026-04-30) — try to inline the audio as an ACP
    // AudioContent block first (backends with audio capability render
    // it natively). Falls back to a resource_link when the file is
    // oversize or unreadable, preserving the pre-Phase-8 semantics
    // for backends that don't accept audio. The bridge layer is still
    // free to prepend a STT transcript text block via
    // `buildTranscribedVoiceBlocks` when it has Whisper output.
    const dur = att.duration != null ? `${att.duration}s` : 'unknown duration';
    try {
      return {
        blocks: [localAudioToBlock(att.localPath, att.mimeType)],
        summary: `[${att.kind}: ${dur}, mime ${att.mimeType ?? 'audio/ogg'} · saved: ${att.localPath}]`,
      };
    } catch {
      // Oversize / read error → resource_link fallback.
      return {
        blocks: [localFileToResourceLink(att.localPath, {
          name: att.name, mimeType: att.mimeType, size: att.sizeBytes,
        })],
        summary: `[${att.kind}: ${dur}, mime ${att.mimeType ?? 'n/a'}]`,
      };
    }
  }

  // document / unknown — hand off via resource_link. Extracted text
  // (pdf-parse, mammoth, etc.) is the caller's responsibility to
  // inline as a text block; here we just point at the file.
  return {
    blocks: [localFileToResourceLink(att.localPath, {
      name: att.name, mimeType: att.mimeType, size: att.sizeBytes,
    })],
    summary: `[${att.kind === 'document' ? 'document' : 'file'}: ${att.name} · saved: ${att.localPath}]`,
  };
}

/** Convert dashboard `Attachment[]` (the chat-input paste-to-token
 *  registry, see `src/context.ts`) into the messenger-agnostic
 *  `NormalizedAttachment[]` shape that `buildAcpPrompt` consumes.
 *  Image kinds → `photo`, everything text-extractable → `document`.
 *  Used by the ACP sticky multi-turn path so chat-input attachments
 *  flow naturally into ACP `image` / `resource_link` blocks. */
export function attachmentsToNormalized(items: Attachment[]): NormalizedAttachment[] {
  const out: NormalizedAttachment[] = [];
  for (const a of items) {
    const kind: NormalizedAttachment['kind'] = a.kind === 'image' ? 'photo' : 'document';
    out.push({
      name: a.filename,
      localPath: a.sourcePath,
      kind,
      ...(a.mediaType ? { mimeType: a.mediaType } : {}),
      ...(a.dimensions ? { width: a.dimensions.w, height: a.dimensions.h } : {}),
      ...(typeof a.sizeBytes === 'number' ? { sizeBytes: a.sizeBytes } : {}),
    });
  }
  return out;
}

/** Batch normalize + fold into a single prompt. `promptText` becomes
 *  one text block; attachment blocks are prepended (ACP convention
 *  has the user message content in order). Inline summaries are
 *  appended to the text block so the backend has human-readable
 *  descriptions even when it drops a block type it can't handle. */
export function buildAcpPrompt(
  promptText: string,
  attachments: NormalizedAttachment[] = [],
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const summaries: string[] = [];
  for (const att of attachments) {
    const norm = normalizeAttachment(att);
    blocks.push(...norm.blocks);
    if (norm.summary) summaries.push(norm.summary);
  }
  const text = summaries.length > 0
    ? `${promptText}\n\n${summaries.join('\n')}`.trim()
    : promptText;
  blocks.push(textBlock(text));
  return blocks;
}

/** Step 2 of platform-evolution arc — convert ACP ContentBlock[] from
 *  an inbound PromptRequest into the LLMMessage.content shape that
 *  daemon-runtime feeds to the LLM. Mapping:
 *    - text                → keep as text
 *    - image (data/mimeType) → LLMContentBlock image (base64/mediaType)
 *    - audio               → drop with placeholder text "[audio]"
 *                             (no LLM audio block yet — Step 7 LLM
 *                             catalog adds this)
 *    - resource_link       → placeholder text "[file: <name>]"
 *                             (vision-incapable models still see
 *                             the metadata — D15 placeholder pattern)
 *    - resource (embedded) → placeholder text "[resource]"
 *
 *  Returns a LLMContentBlock[]. Multi-block message: caller wraps
 *  into LLMMessage { role: 'user', content: <result> }. When the
 *  result is a single text block, caller may unwrap to plain string
 *  for legacy-friendly `content: string` semantics — `flattenLlmContent`
 *  helper does that. */
export function acpPromptToLlmContent(
  blocks: readonly ContentBlock[],
): LLMContentBlock[] {
  const out: LLMContentBlock[] = [];
  for (const block of blocks) {
    const b = block as { type?: string; text?: string; data?: string; mimeType?: string; uri?: string; name?: string };
    if (b.type === 'text' && typeof b.text === 'string') {
      out.push({ type: 'text', text: b.text });
    } else if (b.type === 'image' && typeof b.data === 'string' && typeof b.mimeType === 'string') {
      out.push({ type: 'image', mediaType: b.mimeType, base64: b.data });
    } else if (b.type === 'audio') {
      // §3.4 (2026-04-30) — audio → audio. LLM-side ContentBlock now
      // has 'audio' type (src/llm.ts) routed by toOpenAIMessages to
      // input_audio for gpt-4o-audio-preview models. Providers without
      // audio support (Anthropic / xAI Grok Chat Completions / Local)
      // will see a placeholder via toAnthropicMessage's text fallback
      // OR caller pre-filters with providerSupportsAudio(model).
      // Bridges that have STT can additionally prepend a transcript
      // text block via buildTranscribedVoiceBlocks for vision-only
      // models.
      if (typeof b.data === 'string' && typeof b.mimeType === 'string') {
        out.push({ type: 'audio', mediaType: b.mimeType, base64: b.data });
      } else {
        out.push({ type: 'text', text: `[audio: ${b.mimeType ?? 'unknown'}]` });
      }
    } else if (b.type === 'video') {
      // PR8 (2026-05-14) — ACP video block → LLM-side video content
      // block (PR7 placeholder 패턴 졸업). 각 provider 어댑터 (toGemini
      // Messages · toAnthropicMessage · toOpenAIMessages) 가 분기:
      //   - Gemini 1.5+ : inlineData passthrough (native video)
      //   - Anthropic / OpenAI Chat / xAI Grok / Local : 텍스트 placeholder
      // 이로써 사용자 의도가 capable provider 한테는 native bytes 로,
      // incapable 한테는 메타 placeholder 로 일관 라우팅. data/mimeType
      // 이 결손인 경우 placeholder fallback 유지 (안전 가드).
      if (typeof b.data === 'string' && typeof b.mimeType === 'string') {
        out.push({ type: 'video', mediaType: b.mimeType, base64: b.data });
      } else {
        const mime = typeof b.mimeType === 'string' ? b.mimeType : 'video/*';
        out.push({ type: 'text', text: `[video: ${mime} (incomplete data)]` });
      }
    } else if (b.type === 'resource_link') {
      const name = b.name ?? b.uri ?? 'file';
      out.push({ type: 'text', text: `[file: ${name}]` });
    } else if (b.type === 'resource') {
      out.push({ type: 'text', text: '[resource]' });
    }
    // Unknown / future block types — drop silently. The text fallback
    // would be misleading; the user prompt's text block (always
    // present in well-formed requests) carries the user's intent.
  }
  return out;
}

/** Collapse a LLMContentBlock[] to a plain string when every block is
 *  text — keeps `LLMMessage.content` as `string` for the common
 *  text-only path, preserving wire compatibility with the pre-Step 2
 *  appendUserAndBuildMessages persistence shape. Returns the original
 *  array when any non-text block is present (image, etc.). */
export function flattenLlmContent(
  blocks: LLMContentBlock[],
): string | LLMContentBlock[] {
  if (blocks.length === 0) return '';
  if (blocks.every((b) => b.type === 'text')) {
    return blocks.map((b) => (b as { text: string }).text).join('\n');
  }
  return blocks;
}
