export type MirrorOpenAxis = 'documentHeight' | 'bodyFontFamily' | 'bodyBackground' | 'h1FontSize';
export type MirrorOpenAxisState = 'match' | 'mismatch' | 'unmeasured';
export type MirrorOpenState = 'open' | 'different' | 'unmeasured';

export interface MirrorOpenMeasurements {
  readonly documentHeight: number | null;
  readonly bodyFontFamily: string | null;
  readonly bodyBackground: string | null;
  readonly h1FontSize: string | null;
}

export interface MirrorOpenVerdict {
  /** Any mismatch is different; otherwise any match is open; only all-unmeasured is unmeasured. */
  readonly state: MirrorOpenState;
  /** Counts both matches and mismatches as observed. */
  readonly observedAxisCount: number;
  readonly totalAxisCount: number;
  readonly axes: Readonly<Record<MirrorOpenAxis, MirrorOpenAxisState>>;
}

export interface DocumentHeightReadings {
  readonly documentElementScrollHeight: number | null;
  readonly bodyScrollHeight: number | null;
  readonly innerHeight: number | null;
}

export type DocumentHeightExclusionReason =
  | 'none'
  | 'viewport-height'
  | 'missing-window'
  | 'scroll-height-limit';

export interface NormalizedDocumentHeight {
  readonly documentHeight: number | null;
  readonly exclusionReason: DocumentHeightExclusionReason;
}

// 이 값은 측정이 아니라 천장이다.
export const BROWSER_SCROLL_HEIGHT_LIMIT = 2 ** 25;

/** Select the reliable document height, excluding unreadable viewport and browser-limit readings. */
export function normalizeDocumentHeight({
  documentElementScrollHeight,
  bodyScrollHeight,
  innerHeight,
}: DocumentHeightReadings): NormalizedDocumentHeight {
  if (documentElementScrollHeight === null || bodyScrollHeight === null || innerHeight === null) {
    return { documentHeight: null, exclusionReason: 'none' };
  }
  if (innerHeight === 0) return { documentHeight: null, exclusionReason: 'missing-window' };

  const documentHeight = Math.max(documentElementScrollHeight, bodyScrollHeight);
  if (documentHeight === innerHeight) return { documentHeight: null, exclusionReason: 'viewport-height' };
  if (documentHeight === BROWSER_SCROLL_HEIGHT_LIMIT) {
    return { documentHeight: null, exclusionReason: 'scroll-height-limit' };
  }
  return { documentHeight, exclusionReason: 'none' };
}

function compareAxis(
  liveValue: string | number | null,
  archiveValue: string | number | null,
): MirrorOpenAxisState {
  if (liveValue === null || archiveValue === null) return 'unmeasured';
  return liveValue === archiveValue ? 'match' : 'mismatch';
}

/** Compare only computed render measurements; this module never opens a browser or network connection. */
export function judgeMirrorOpen(
  live: MirrorOpenMeasurements,
  archive: MirrorOpenMeasurements,
): MirrorOpenVerdict {
  const axes: Record<MirrorOpenAxis, MirrorOpenAxisState> = {
    documentHeight: compareAxis(live.documentHeight, archive.documentHeight),
    bodyFontFamily: compareAxis(live.bodyFontFamily, archive.bodyFontFamily),
    bodyBackground: compareAxis(live.bodyBackground, archive.bodyBackground),
    h1FontSize: compareAxis(live.h1FontSize, archive.h1FontSize),
  };
  const states = Object.values(axes);
  return {
    state: states.includes('mismatch')
      ? 'different'
      : states.includes('match')
        ? 'open'
        : 'unmeasured',
    axes,
    observedAxisCount: states.filter(state => state !== 'unmeasured').length,
    totalAxisCount: states.length,
  };
}
