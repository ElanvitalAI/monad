import { preservesHostChromeInput } from './host-chrome-profile.js';
import type { DisplaySurface } from './types.js';

export type SurfaceInteractionClass =
  | 'workspace'
  | 'blocking-modal'
  | 'embedded-overlay';

export interface SurfaceInteractionPolicy {
  interactionClass: SurfaceInteractionClass;
  isWorkspace: boolean;
  blocksHostInput: boolean;
  suppressesBottomArea: boolean;
  suppressesHudArea: boolean;
  suppressesCursorFallback: boolean;
  ownsPrimaryKeyRoute: boolean;
  participatesInBlockingForegroundViewMode: boolean;
}

export function resolveModalInteractionClass(
  surface: DisplaySurface | null | undefined,
): SurfaceInteractionClass | null {
  if (!surface) return null;
  if (surface.interactionClass) return surface.interactionClass;
  if (preservesHostChromeInput(surface.hostChromeProfile) || surface.tier === 'vw') {
    return 'workspace';
  }
  if (surface.windowRole === 'companion') {
    return 'embedded-overlay';
  }
  return 'blocking-modal';
}

export function resolveModalInteractionPolicy(
  surface: DisplaySurface | null | undefined,
): SurfaceInteractionPolicy {
  const interactionClass = resolveModalInteractionClass(surface) ?? 'blocking-modal';
  const blocksHostInput =
    !!surface
    && interactionClass === 'blocking-modal'
    && surface.backgroundInteractionPolicy === 'block';
  return {
    interactionClass,
    isWorkspace: interactionClass === 'workspace',
    blocksHostInput,
    suppressesBottomArea: blocksHostInput,
    suppressesHudArea: blocksHostInput,
    suppressesCursorFallback: blocksHostInput,
    ownsPrimaryKeyRoute: blocksHostInput,
    participatesInBlockingForegroundViewMode: blocksHostInput,
  };
}

export function isWorkspaceInteractionSurface(
  surface: DisplaySurface | null | undefined,
): boolean {
  return resolveModalInteractionClass(surface) === 'workspace';
}

export function isBlockingModalInteractionSurface(
  surface: DisplaySurface | null | undefined,
): boolean {
  return resolveModalInteractionPolicy(surface).blocksHostInput;
}

export function isEmbeddedOverlayInteractionSurface(
  surface: DisplaySurface | null | undefined,
): boolean {
  return resolveModalInteractionClass(surface) === 'embedded-overlay';
}

/** Foreground modal key-route ownership for chat-main / prompt entry.
 *  Workspace-class VW declines this route so host typing stays on the
 *  prompt after `Ctrl+L`; true blocking popups own it. */
export function ownsForegroundModalKeyRoute(
  surface: DisplaySurface | null | undefined,
): boolean {
  return resolveModalInteractionPolicy(surface).ownsPrimaryKeyRoute;
}
