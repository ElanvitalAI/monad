export type NexusHttpHealth = 'responsive' | 'silent' | 'unknown';

type NexusStatusName =
  | 'alive'
  | 'lock alive, http silent'
  | 'http responding without live lock'
  | 'not running'
  | 'http health unknown';

interface NexusStatusObservation {
  lockAlive: boolean;
  health: NexusHttpHealth;
}

/** Classifies independent lock-process and HTTP listener observations. */
export function classifyNexusStatus({ lockAlive, health }: NexusStatusObservation): NexusStatusName {
  if (lockAlive && health === 'responsive') return 'alive';
  if (lockAlive && health === 'silent') return 'lock alive, http silent';
  if (!lockAlive && health === 'responsive') return 'http responding without live lock';
  if (health === 'unknown') return 'http health unknown';
  return 'not running';
}
