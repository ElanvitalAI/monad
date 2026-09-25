const COMPANION_SURFACE_PREFIX = 'companion';

export function companionSurfaceId(ownerId: string, key: string): string {
  return `${COMPANION_SURFACE_PREFIX}:${ownerId}::${key}`;
}

export interface CompanionSurfaceAddress {
  ownerId: string;
  key: string;
}

export function parseCompanionSurfaceId(surfaceId: string): CompanionSurfaceAddress | null {
  if (!surfaceId.startsWith(`${COMPANION_SURFACE_PREFIX}:`)) return null;
  const body = surfaceId.slice(COMPANION_SURFACE_PREFIX.length + 1);
  const splitAt = body.lastIndexOf('::');
  if (splitAt <= 0 || splitAt >= body.length - 2) return null;
  return {
    ownerId: body.slice(0, splitAt),
    key: body.slice(splitAt + 2),
  };
}
