import {
  buildTurnOutputTextVariants,
  type TurnOutputTextVariants,
} from './turn-output-text.js';

export type TurnOutputBlock =
  | { kind: 'text'; text: string }
  | { kind: 'link-text'; text: string }
  | { kind: 'picture-ref'; text: string; url: string; source: 'markdown-image' | 'url' }
  | { kind: 'video-ref'; text: string; url: string; source: 'markdown-link' | 'url' }
  | { kind: 'path-text'; text: string }
  | { kind: 'code-text'; text: string; source: 'fenced' }
  | { kind: 'speakable-text'; text: string; source: 'rewrite' | 'direct' };

function looksLikeUrlText(text: string): boolean {
  const trimmed = text.trim();
  return /^https?:\/\/[^\s]+$/i.test(trimmed) || /^data:[^\s]+$/i.test(trimmed);
}

function looksLikePathText(text: string): boolean {
  return /^(\/[^\s]+|\.{1,2}\/[^\s]+|~\/[^\s]+|[A-Za-z]:\\[^\s]+)$/.test(text.trim());
}

function looksLikePictureUrl(text: string): boolean {
  const trimmed = text.trim();
  return (
    /^https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s]*)?$/i.test(trimmed)
    || /^data:image\/[a-z0-9.+-]+(?:;[^,\s]+)*,[\s\S]+$/i.test(trimmed)
  );
}

function looksLikeVideoUrl(text: string): boolean {
  const trimmed = text.trim();
  return (
    /^https?:\/\/[^\s]+\.(?:mp4|mov|m4v|webm)(?:\?[^\s]*)?$/i.test(trimmed)
    || /^data:video\/[a-z0-9.+-]+(?:;[^,\s]+)*,[\s\S]+$/i.test(trimmed)
  );
}

function extractMarkdownPictureRef(text: string): { text: string; url: string } | null {
  const match = text.trim().match(/^!\[([^\]]*)\]\(((?:https?:\/\/[^)\s]+|data:image\/[^)]+))\)$/i);
  if (!match) return null;
  return {
    text: (match[1] ?? '').trim() || 'image',
    url: match[2]!,
  };
}

function extractMarkdownVideoRef(text: string): { text: string; url: string } | null {
  const match = text.trim().match(/^\[([^\]]+)\]\(((?:https?:\/\/[^)\s]+\.(?:mp4|mov|m4v|webm)(?:\?[^)\s]*)?|data:video\/[^)]+))\)$/i);
  if (!match) return null;
  return {
    text: (match[1] ?? '').trim() || 'video',
    url: match[2]!,
  };
}

function extractFencedCodeText(text: string): string | null {
  const blocks = [...text.matchAll(/```[^\n`]*\n([\s\S]*?)```/g)]
    .map((match) => match[1]?.trim() ?? '')
    .filter((block) => block.length > 0);
  if (blocks.length === 0) return null;
  return blocks.join('\n\n');
}

export function buildTurnOutputTextBlocks(text: string): TurnOutputBlock[] {
  const variants = buildTurnOutputTextVariants(text);
  return turnOutputBlocksFromVariants(variants);
}

export function turnOutputBlocksFromVariants(
  variants: TurnOutputTextVariants,
): TurnOutputBlock[] {
  const blocks: TurnOutputBlock[] = [{ kind: 'text', text: variants.text }];
  if (looksLikeUrlText(variants.text)) {
    blocks.push({ kind: 'link-text', text: variants.text.trim() });
  }
  const pictureRef = extractMarkdownPictureRef(variants.text);
  if (pictureRef) {
    blocks.push({ kind: 'picture-ref', text: pictureRef.text, url: pictureRef.url, source: 'markdown-image' });
  } else if (looksLikePictureUrl(variants.text)) {
    blocks.push({ kind: 'picture-ref', text: variants.text.trim(), url: variants.text.trim(), source: 'url' });
  }
  const videoRef = extractMarkdownVideoRef(variants.text);
  if (videoRef) {
    blocks.push({ kind: 'video-ref', text: videoRef.text, url: videoRef.url, source: 'markdown-link' });
  } else if (looksLikeVideoUrl(variants.text)) {
    blocks.push({ kind: 'video-ref', text: variants.text.trim(), url: variants.text.trim(), source: 'url' });
  }
  if (looksLikePathText(variants.text)) {
    blocks.push({ kind: 'path-text', text: variants.text.trim() });
  }
  const codeText = extractFencedCodeText(variants.text);
  if (codeText) {
    blocks.push({ kind: 'code-text', text: codeText, source: 'fenced' });
  }
  if (!variants.speakableText) return blocks;
  blocks.push({
    kind: 'speakable-text',
    text: variants.speakableText,
    source: variants.speakableText === variants.text ? 'direct' : 'rewrite',
  });
  return blocks;
}

export function selectSpeakableTextBlock(blocks: readonly TurnOutputBlock[]): string | null {
  const speakable = blocks.find((block) => block.kind === 'speakable-text');
  return speakable?.text ?? null;
}

export function selectPrimaryTextBlock(blocks: readonly TurnOutputBlock[]): string | null {
  const text = blocks.find((block) => block.kind === 'text');
  return text?.text ?? null;
}

export function selectLinkTextBlock(blocks: readonly TurnOutputBlock[]): string | null {
  const text = blocks.find((block) => block.kind === 'link-text');
  return text?.text ?? null;
}

export function selectPictureRefBlock(
  blocks: readonly TurnOutputBlock[],
): Extract<TurnOutputBlock, { kind: 'picture-ref' }> | null {
  const block = blocks.find((candidate) => candidate.kind === 'picture-ref');
  return block ?? null;
}

export function selectVideoRefBlock(
  blocks: readonly TurnOutputBlock[],
): Extract<TurnOutputBlock, { kind: 'video-ref' }> | null {
  const block = blocks.find((candidate) => candidate.kind === 'video-ref');
  return block ?? null;
}

export function selectPathTextBlock(blocks: readonly TurnOutputBlock[]): string | null {
  const text = blocks.find((block) => block.kind === 'path-text');
  return text?.text ?? null;
}

export function selectCodeTextBlock(blocks: readonly TurnOutputBlock[]): string | null {
  const text = blocks.find((block) => block.kind === 'code-text');
  return text?.text ?? null;
}
