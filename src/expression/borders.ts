// Border glyph variants — lipgloss-style border kinds.
//
// Renderers compose a frame from {top, bottom, left, right} edges
// + {tl, tr, bl, br} corners + {ml, mr, mt, mb} mid-junctions when
// drawing tables. `hidden` keeps the layout reservation while
// emitting blanks; `ascii` is the SSH/legacy fallback that survives
// terminals without box-drawing glyph support.

export interface BorderShape {
  top: string;
  bottom: string;
  left: string;
  right: string;
  tl: string;
  tr: string;
  bl: string;
  br: string;
  /** Mid-row T-junctions (─┬─, ─┴─). */
  mt: string;
  mb: string;
  /** Mid-column T-junctions (├, ┤). */
  ml: string;
  mr: string;
  /** Cross-junction (┼). */
  cross: string;
}

export const BORDER_NORMAL: BorderShape = {
  top: '─', bottom: '─', left: '│', right: '│',
  tl: '┌', tr: '┐', bl: '└', br: '┘',
  mt: '┬', mb: '┴', ml: '├', mr: '┤', cross: '┼',
};

export const BORDER_ROUNDED: BorderShape = {
  top: '─', bottom: '─', left: '│', right: '│',
  tl: '╭', tr: '╮', bl: '╰', br: '╯',
  mt: '┬', mb: '┴', ml: '├', mr: '┤', cross: '┼',
};

export const BORDER_THICK: BorderShape = {
  top: '━', bottom: '━', left: '┃', right: '┃',
  tl: '┏', tr: '┓', bl: '┗', br: '┛',
  mt: '┳', mb: '┻', ml: '┣', mr: '┫', cross: '╋',
};

export const BORDER_DOUBLE: BorderShape = {
  top: '═', bottom: '═', left: '║', right: '║',
  tl: '╔', tr: '╗', bl: '╚', br: '╝',
  mt: '╦', mb: '╩', ml: '╠', mr: '╣', cross: '╬',
};

export const BORDER_DOTTED: BorderShape = {
  top: '┄', bottom: '┄', left: '┆', right: '┆',
  tl: '╭', tr: '╮', bl: '╰', br: '╯',
  mt: '┬', mb: '┴', ml: '├', mr: '┤', cross: '┼',
};

export const BORDER_DASHED: BorderShape = {
  top: '╌', bottom: '╌', left: '╎', right: '╎',
  tl: '┌', tr: '┐', bl: '└', br: '┘',
  mt: '┬', mb: '┴', ml: '├', mr: '┤', cross: '┼',
};

export const BORDER_BLOCK: BorderShape = {
  top: '▀', bottom: '▄', left: '▌', right: '▐',
  tl: '▛', tr: '▜', bl: '▙', br: '▟',
  mt: '▀', mb: '▄', ml: '▌', mr: '▐', cross: '█',
};

export const BORDER_ASCII: BorderShape = {
  top: '-', bottom: '-', left: '|', right: '|',
  tl: '+', tr: '+', bl: '+', br: '+',
  mt: '+', mb: '+', ml: '+', mr: '+', cross: '+',
};

export const BORDER_HIDDEN: BorderShape = {
  top: ' ', bottom: ' ', left: ' ', right: ' ',
  tl: ' ', tr: ' ', bl: ' ', br: ' ',
  mt: ' ', mb: ' ', ml: ' ', mr: ' ', cross: ' ',
};

export type BorderKind =
  | 'normal'
  | 'rounded'
  | 'thick'
  | 'double'
  | 'dotted'
  | 'dashed'
  | 'block'
  | 'ascii'
  | 'hidden';

export const BORDERS: Record<BorderKind, BorderShape> = {
  normal: BORDER_NORMAL,
  rounded: BORDER_ROUNDED,
  thick: BORDER_THICK,
  double: BORDER_DOUBLE,
  dotted: BORDER_DOTTED,
  dashed: BORDER_DASHED,
  block: BORDER_BLOCK,
  ascii: BORDER_ASCII,
  hidden: BORDER_HIDDEN,
};

/** Pick a border shape, falling back to `normal` for unknown kinds.
 *  Useful when callers thread user-specified strings through. */
export function pickBorder(kind: BorderKind | string | undefined): BorderShape {
  if (!kind) return BORDER_NORMAL;
  return BORDERS[kind as BorderKind] ?? BORDER_NORMAL;
}
