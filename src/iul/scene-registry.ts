import type { IulAssetId } from './asset-registry.js';

export interface IulSceneSpec {
  id: string;
  label: string;
  assetIds: readonly [IulAssetId, IulAssetId, IulAssetId, IulAssetId];
}

const IUL_SCENES: readonly IulSceneSpec[] = [
  {
    id: 'test-lab-core',
    label: 'Test Lab',
    assetIds: [
      'runtime.change-layout',
      'runtime.dock-menu',
      'ux.context-menu',
      'ux.file-dialog',
    ],
  },
] as const;

export function getIulSceneRegistry(): ReadonlyMap<string, IulSceneSpec> {
  return new Map(IUL_SCENES.map((scene) => [scene.id, scene] as const));
}

