import { describe, expect, test } from 'bun:test';
import { S3_FEATURE_PREFIXES, s3MonadKey, type S3FeatureKey } from './s3.js';

describe('S3 feature prefixes', () => {
  test('preserves existing feature prefixes and adds the retained ad-assets prefix', () => {
    expect(S3_FEATURE_PREFIXES).toEqual({
      notesMetrics: 'notes-metrics',
      ocrPrefs: 'ocr-prefs',
      sessions: 'sessions',
      reflectionHistory: 'reflection-history',
      discoveryCache: 'discovery-cache',
      discoveryHistory: 'discovery-history',
      debugBundle: 'debug-bundle',
      memoryArchive: 'memory-archive',
      spill: 'spill',
      morning: 'morning',
      adAssets: 'ad-assets',
    });
  });

  test('accepts adAssets as a feature key and builds its canonical retained asset key', () => {
    const feature: S3FeatureKey = 'adAssets';

    expect(s3MonadKey(feature, 'creative.png')).toEndWith('/ad-assets/creative.png');
  });
});
