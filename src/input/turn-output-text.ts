export interface TurnOutputTextVariants {
  text: string;
  speakableText: string;
}

function looksStructuralLine(line: string): boolean {
  return /^#{1,6}\s+/.test(line)
    || /^[>\-+*]\s+/.test(line)
    || /^[-+*]\s+\[[ xX]\]\s+/.test(line)
    || /^\d+[.)]\s+/.test(line)
    || /^\$\s+/.test(line)
    || /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[^\s]*[$#]\s+/.test(line)
    || /^[A-Za-z0-9._-]+:[~/\\][^\s]*[$#]\s+/.test(line)
    || /^[A-Za-z0-9 _-]+:\s+/.test(line)
    || /(^|[\s{,])["']?[A-Za-z0-9_-]+["']?\s*:\s*["'{[]?/.test(line)
    || /\|/.test(line);
}

function normalizeSpeakableLine(line: string): string {
  const jsonLike = /(^|[\s{,])["']?[A-Za-z0-9_-]+["']?\s*:\s*["'{[]?/.test(line);
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-+*]\s+\[[ xX]\]\s+/, '')
    .replace(/^[>\-+*]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/!\[\s*\]\((?:[^)]+)\)/g, 'image')
    .replace(/!\[([^\]]*)\]\((?:[^)]+)\)/g, '$1')
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' link ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\b[A-Z][A-Z0-9_]{2,}=([^\s]+)/g, ' setting $1 ')
    .replace(/--[a-z0-9][a-z0-9-]*/gi, (flag) => ` option ${flag.slice(2).replace(/-/g, ' ')} `)
    .replace(/\b[A-Z][A-Z0-9_]{2,}\b/g, (token) => token.includes('_') ? ' setting ' : token)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\b[A-Za-z]:\\[^\s]+/g, ' path ')
    .replace(/(?:^|\s)(\/[^\s/]+(?:\/[^\s/]+)+)(?=\s|$)/g, ' path ')
    .replace(/(?:^|\s)(\.{1,2}\/[^\s/]+(?:\/[^\s/]+)*)(?=\s|$)/g, ' path ')
    .replace(/^\$\s+/, '')
    .replace(/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[^\s]*[$#]\s+/, '')
    .replace(/^[A-Za-z0-9._-]+:[~/\\][^\s]*[$#]\s+/, '')
    .replace(/[|]+/g, ' ')
    .replace(jsonLike ? /[{}[\]",]+/g : /[{}[\]"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSpeakableOutputText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const codeBlocks = [...trimmed.matchAll(/```[\s\S]*?```/g)];
  const withoutCodeBlocks = trimmed.replace(/```[\s\S]*?```/g, ' ');
  const lines = withoutCodeBlocks
    .split('\n')
    .map((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return null;
      if (/^[|:\-\s]+$/.test(trimmedLine)) return null;
      const structural = looksStructuralLine(trimmedLine);
      const cleaned = normalizeSpeakableLine(trimmedLine);
      if (!cleaned) return null;
      return { text: cleaned, structural };
    })
    .filter((line): line is { text: string; structural: boolean } => line !== null);
  const normalized = lines.reduce((acc, line, index) => {
    if (index === 0) return line.text;
    const separator = line.structural ? '. ' : ' ';
    return `${acc}${separator}${line.text}`;
  }, '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    if (codeBlocks.length > 0) return 'code block';
    return '';
  }
  if (normalized.length <= 480) return normalized;
  return `${normalized.slice(0, 477).trimEnd()}...`;
}

export function buildTurnOutputTextVariants(text: string): TurnOutputTextVariants {
  return {
    text,
    speakableText: buildSpeakableOutputText(text),
  };
}
