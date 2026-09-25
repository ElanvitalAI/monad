// PWA · Nexus hooks public surface (Phase N-4 PR ξ)

export { NexusProvider, useNexusClient } from './use-nexus-context';
export { useNexusHealth, useNexusSnapshot, useNexusTabs, useNexusTab } from './use-nexus-state';
export {
  useCreateTab,
  useDeleteTab,
  usePatchTab,
  useStartTab,
  useStopTab,
  useRestartTab,
} from './use-tab-actions';
export { useNexusEvents } from './use-events';
export {
  useNexusConfig,
  useNexusSwitches,
  useNexusSwitch,
  usePutSwitch,
  useNexusSecrets,
  usePostSecret,
  useDeleteSecret,
} from './use-config';
export { useTemplates, useTemplate, useSaveTemplate } from './use-templates';
export { useBindingChannels, useBindings, useUpsertBinding, useDeleteBinding } from './use-bindings';
export { nexusKeys, invalidationsForEvent } from './query-keys';
