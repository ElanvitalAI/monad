import { hexToRgb } from '../expression/color.js';

/** WCAG 2.x normal-text minimum contrast ratio. */
export const WCAG_NORMAL_TEXT_CONTRAST_RATIO = 4.5;

/**
 * Measures WCAG 2.x contrast for two opaque sRGB hex colors.
 *
 * Returns null when either input cannot be parsed by the shared color parser.
 */
export function measureContrast(foreground: string, background: string): number | null {
  const fg = hexToRgb(foreground);
  const bg = hexToRgb(background);
  if (!fg || !bg) return null;

  const foregroundLuminance = relativeLuminance(fg);
  const backgroundLuminance = relativeLuminance(bg);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  return 0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b);
}

function linearize(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.04045
    ? srgb / 12.92
    : Math.pow((srgb + 0.055) / 1.055, 2.4);
}
