export type AssetProvenance = 'real' | 'generated' | 'unresolved';

export interface GeneratedAssetDisclosure {
  readonly step: string;
  readonly text: string;
}

export const GENERATED_ASSET_DISCLOSURE: GeneratedAssetDisclosure = {
  step: 'generated-asset-disclosure',
  text: '생성된 이미지·영상이 포함되어 있습니다.',
};

export function resolveAssetProvenance(kind: string): AssetProvenance {
  switch (kind) {
    case 'url':
    case 'image':
      return 'real';
    case 'text':
      return 'generated';
    default:
      return 'unresolved';
  }
}

export function hasWiredGeneratedProduction(
  productionReadiness: readonly { readonly step: string; readonly status: string }[],
): boolean {
  return productionReadiness.some((step) => step.step === 'cut' && step.status === 'wired');
}

export function requiresGeneratedAssetDisclosure(
  provenance: AssetProvenance,
  hasGeneratedProduction: boolean,
): boolean {
  return provenance === 'generated' || hasGeneratedProduction;
}

export function validateProvenancePlan(plan: {
  readonly provenance: AssetProvenance;
  readonly disclosure?: GeneratedAssetDisclosure;
}): void {
  if (plan.provenance === 'unresolved') {
    throw new Error('Asset provenance is unresolved; the advertising plan cannot be completed.');
  }
  if (plan.provenance === 'generated') {
    if (!plan.disclosure || !plan.disclosure.step.trim() || !plan.disclosure.text.trim()) {
      throw new Error('Generated assets require a non-empty disclosure step and text.');
    }
  }
}
