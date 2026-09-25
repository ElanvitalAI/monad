export type HostChromeProfile = 'dock-only' | 'hud-status-input-dock';

export const DEFAULT_HOST_CHROME_PROFILE: HostChromeProfile = 'dock-only';

export function preservesHostChromeInput(
  profile: HostChromeProfile | null | undefined,
): boolean {
  return (profile ?? DEFAULT_HOST_CHROME_PROFILE) === 'hud-status-input-dock';
}
