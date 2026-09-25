import { expect, test } from 'bun:test';

import { buildCaptionRenderPlan, CAPTION_BOTTOM_FRACTION } from '../src/ad-pipeline/caption-render.js';
import type { CaptionLine } from '../src/ad-pipeline/caption-plan.js';

const lines: readonly CaptionLine[] = [
  { text: 'first supplied caption', startMs: 1250, endMs: 2750 },
  { text: 'second supplied caption', startMs: 3000, endMs: 4250 },
];

const options = {
  lines,
  fontPath: '/fonts/NanumMyeongjo.ttc',
  workDir: '/work/frames',
  masterPath: '/work/master.mp4',
  outputPath: '/work/captioned.mp4',
};

test('plans one external PNG rasterization per supplied line and a timed ffmpeg overlay', () => {
  const plan = buildCaptionRenderPlan(options);

  expect(CAPTION_BOTTOM_FRACTION).toBe(0.2);
  expect(plan.blocked).toEqual([]);
  expect(plan.commands).toHaveLength(3);
  expect(plan.commands.slice(0, 2).map((command) => command.argv)).toEqual([
    ['magick', '-size', '1040x260', 'xc:none', '-font', '/fonts/NanumMyeongjo.ttc', '-pointsize', '56', '-interline-spacing', '14', '-gravity', 'center', '-fill', '#000000C0', '-annotate', '+3+3', 'first supplied caption', '-fill', 'white', '-annotate', '+0+0', 'first supplied caption', '/work/frames/caption-0.png'],
    ['magick', '-size', '1040x260', 'xc:none', '-font', '/fonts/NanumMyeongjo.ttc', '-pointsize', '56', '-interline-spacing', '14', '-gravity', 'center', '-fill', '#000000C0', '-annotate', '+3+3', 'second supplied caption', '-fill', 'white', '-annotate', '+0+0', 'second supplied caption', '/work/frames/caption-1.png'],
  ]);
  const overlay = plan.commands[2]!;
  expect(overlay.step).toBe('overlay-captions');
  expect(overlay.argv).toContain("[0:v][1:v]overlay=(W-w)/2:H-h-H*0.2:enable='between(t,1.25,2.75)'[caption-0];[caption-0][2:v]overlay=(W-w)/2:H-h-H*0.2:enable='between(t,3,4.25)'[caption-1]");
  expect(overlay.argv).not.toContain('drawtext');
  expect(overlay.argv).not.toContain('subtitles');
  expect(overlay.argv).not.toContain('ass');
});

test('escapes ImageMagick annotate expansions without changing ordinary caption text', () => {
  const plan = buildCaptionRenderPlan({
    ...options,
    lines: [{ text: '@caption %[fx:w] \\ literal', startMs: 0, endMs: 1000 }],
  });

  const raster = plan.commands[0]!;
  expect(raster.argv).toContain('\\@caption \\%[fx:w] \\\\ literal');
  expect(raster.argv.filter((argument) => argument === '\\@caption \\%[fx:w] \\\\ literal')).toHaveLength(2);
});

test('blocks absent font paths rather than inventing one', () => {
  const plan = buildCaptionRenderPlan({ ...options, fontPath: ' ' });

  expect(plan).toEqual({ commands: [], blocked: ['missing-font-path'] });
});

test('returns an empty plan without requiring a font when there are no lines', () => {
  expect(buildCaptionRenderPlan({ ...options, lines: [], fontPath: undefined })).toEqual({ commands: [], blocked: [] });
});

test('blocks normalized master/output aliases and generated-PNG input/output collisions', () => {
  expect(buildCaptionRenderPlan({ ...options, outputPath: '/work/./master.mp4' })).toEqual({ commands: [], blocked: ['master-output-path-conflict'] });
  expect(buildCaptionRenderPlan({ ...options, masterPath: '/work/frames/../frames/caption-0.png' })).toEqual({ commands: [], blocked: ['caption-input-path-conflict:caption-0'] });
  expect(buildCaptionRenderPlan({ ...options, outputPath: '/work/frames/caption-1.png' })).toEqual({ commands: [], blocked: ['caption-output-path-conflict:caption-1'] });
});

test('blocks normalized font aliases that would overwrite a generated PNG or final output', () => {
  expect(buildCaptionRenderPlan({ ...options, fontPath: '/work/frames/./caption-0.png' })).toEqual({ commands: [], blocked: ['caption-font-path-conflict:caption-0'] });
  expect(buildCaptionRenderPlan({ ...options, fontPath: '/work/frames/nested/../../frames/caption-1.png' })).toEqual({ commands: [], blocked: ['caption-font-path-conflict:caption-1'] });
  expect(buildCaptionRenderPlan({ ...options, fontPath: '/work/./captioned.mp4' })).toEqual({ commands: [], blocked: ['font-output-path-conflict'] });
});
