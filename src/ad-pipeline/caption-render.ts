import { resolve } from 'node:path';

import type { CaptionLine } from './caption-plan.js';

export const CAPTION_BOTTOM_FRACTION = 0.2;

export interface CaptionRenderCommand {
  readonly step: 'rasterize-caption' | 'overlay-captions';
  readonly argv: readonly string[];
}

export interface CaptionRenderPlan {
  readonly commands: readonly CaptionRenderCommand[];
  readonly blocked: readonly string[];
}

export interface CaptionRenderOptions {
  readonly lines: readonly CaptionLine[];
  readonly fontPath?: string;
  readonly workDir: string;
  readonly masterPath: string;
  readonly outputPath: string;
}

function pathIn(workDir: string, name: string): string {
  return `${workDir.replace(/[\\/]+$/, '')}/${name}`;
}

function seconds(milliseconds: number): string {
  return (milliseconds / 1000).toString();
}

/** Escapes ImageMagick annotate expansions while preserving caller-supplied caption text. */
function literalAnnotateText(text: string): string {
  return text.replace(/([%@\\])/g, '\\$1');
}

/**
 * Plans external caption rasterization followed by a single ffmpeg overlay command.
 * This is deliberately execution-free: callers receive argv arrays and run them separately.
 */
export function buildCaptionRenderPlan(options: CaptionRenderOptions): CaptionRenderPlan {
  if (options.lines.length === 0) return { commands: [], blocked: [] };

  const fontPath = options.fontPath?.trim();
  if (!fontPath) return { commands: [], blocked: ['missing-font-path'] };

  const masterPath = resolve(options.masterPath);
  const fontInputPath = resolve(fontPath);
  const outputPath = resolve(options.outputPath);
  const pngPaths = options.lines.map((_, index) => pathIn(options.workDir, `caption-${index}.png`));
  const normalizedPngPaths = pngPaths.map((path) => resolve(path));
  const blocked: string[] = [];

  if (masterPath === outputPath) blocked.push('master-output-path-conflict');
  if (fontInputPath === outputPath) blocked.push('font-output-path-conflict');
  for (const [index, pngPath] of normalizedPngPaths.entries()) {
    if (pngPath === masterPath) blocked.push(`caption-input-path-conflict:caption-${index}`);
    if (pngPath === fontInputPath) blocked.push(`caption-font-path-conflict:caption-${index}`);
    if (pngPath === outputPath) blocked.push(`caption-output-path-conflict:caption-${index}`);
  }
  if (blocked.length > 0) return { commands: [], blocked };

  const commands: CaptionRenderCommand[] = options.lines.map((line, index) => {
    const text = literalAnnotateText(line.text);
    return {
      step: 'rasterize-caption',
      argv: [
        'magick', '-size', '1040x260', 'xc:none', '-font', fontPath, '-pointsize', '56',
        '-interline-spacing', '14', '-gravity', 'center',
        '-fill', '#000000C0', '-annotate', '+3+3', text,
        '-fill', 'white', '-annotate', '+0+0', text,
        pngPaths[index]!,
      ],
    };
  });

  const inputs = pngPaths.flatMap((path) => ['-i', path]);
  const overlays = options.lines.map((line, index) => {
    const inputIndex = index + 1;
    const source = index === 0 ? '[0:v]' : `[caption-${index - 1}]`;
    return `${source}[${inputIndex}:v]overlay=(W-w)/2:H-h-H*${CAPTION_BOTTOM_FRACTION}:enable='between(t,${seconds(line.startMs)},${seconds(line.endMs)})'[caption-${index}]`;
  });
  const finalVideo = `[caption-${options.lines.length - 1}]`;
  commands.push({
    step: 'overlay-captions',
    argv: ['ffmpeg', '-i', options.masterPath, ...inputs, '-filter_complex', overlays.join(';'), '-map', finalVideo, '-map', '0:a?', '-c:v', 'libx264', '-c:a', 'aac', options.outputPath],
  });

  return { commands, blocked };
}
