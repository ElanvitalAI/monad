import { expect, test } from 'bun:test';
import { buildRetainPlan } from '../src/ad-pipeline/retain.js';

const now = '2026-09-11T12:00:00.000Z';
const options = { workDir: '/retained', s3Available: true, now };

test('plans canonical retention downloads and vendor-specific estimated expiries without execution', () => {
  const plan = buildRetainPlan([
    { beatIndex: 0, vendor: 'higgsfield', url: 'https://cdn.example/higgs.mp4?token=x', createdAt: '2026-09-01T12:00:00.000Z' },
    { beatIndex: 1, vendor: 'topview', url: 'https://cdn.example/topview.mov', createdAt: '2026-09-01T12:00:00.000Z' },
  ], options);

  expect(plan.commands).toEqual([
    expect.objectContaining({
      beatIndex: 0,
      download: ['curl', '-fsSL', '--globoff', '--create-dirs', '-o', expect.stringMatching(/^\/retained\/beat-0-higgsfield-[a-f0-9]{64}\.mp4$/), '--', 'https://cdn.example/higgs.mp4?token=x'],
      localPath: expect.stringMatching(/^\/retained\/beat-0-higgsfield-[a-f0-9]{64}\.mp4$/),
      s3Key: expect.stringMatching(/^monad\/.+\/ad-assets\/higgsfield\/beat-0-[a-f0-9]{64}\.mp4$/),
    }),
    expect.objectContaining({ localPath: expect.stringMatching(/^\/retained\/beat-1-topview-[a-f0-9]{64}\.mov$/) }),
  ]);
  expect(plan.estimatedExpiry).toEqual([
    expect.objectContaining({ beatIndex: 0, expiresAtIso: '2026-10-01T12:00:00.000Z', basis: expect.stringContaining('Higgsfield') }),
    expect.objectContaining({ beatIndex: 1, expiresAtIso: '2026-09-08T12:00:00.000Z', basis: expect.stringContaining('Topview') }),
  ]);
  expect(plan).toMatchObject({ expiredEstimatedExpiry: [1], unknownExpiry: [], blocked: [], s3Skipped: false });
});

test('distinguishes future, expired estimated, and unknown expiry without suppressing downloads', () => {
  const plan = buildRetainPlan([
    { beatIndex: 0, vendor: 'higgsfield', url: 'https://cdn.example/future.mp4', createdAt: '2026-09-01T12:00:00.000Z' },
    { beatIndex: 1, vendor: 'topview', url: 'https://cdn.example/expired.mp4', createdAt: '2026-09-01T12:00:00.000Z' },
    { beatIndex: 2, vendor: 'topview', url: 'https://cdn.example/unknown.mp4' },
    { beatIndex: 3, vendor: 'topview', url: 'https://cdn.example/expiry-now.mp4', createdAt: '2026-09-04T12:00:00.000Z' },
  ], options);

  expect(plan.expiredEstimatedExpiry).toEqual([1]);
  expect(plan.unknownExpiry).toEqual([2]);
  expect(plan.estimatedExpiry.map(({ beatIndex }) => beatIndex)).toEqual([0, 1, 3]);
  expect(plan.estimatedExpiry.find(({ beatIndex }) => beatIndex === 3)?.expiresAtIso).toBe(now);
  expect(plan.commands.map(({ beatIndex }) => beatIndex)).toEqual([0, 1, 2, 3]);
});

test('blocks an explicitly empty createdAt rather than treating it as an absent creation time', () => {
  const plan = buildRetainPlan([
    { beatIndex: 3, vendor: 'topview', url: 'https://cdn.example/empty-created-at.mp4', createdAt: '' },
  ], options);

  expect(plan).toEqual({
    commands: [],
    estimatedExpiry: [],
    expiredEstimatedExpiry: [],
    unknownExpiry: [],
    blocked: ['invalid-created-at:beat-3'], s3Skipped: false,
  });
});

test('distinguishes default policy expiry evidence from user-configured retention estimates', () => {
  const asset = { beatIndex: 4, vendor: 'topview' as const, url: 'https://cdn.example/retention.mp4', createdAt: '2026-09-01T12:00:00.000Z' };

  const defaultPlan = buildRetainPlan([asset], options);
  const configuredPlan = buildRetainPlan([asset], {
    ...options,
    retentionDays: { higgsfield: 30, topview: 14 },
  });

  expect(defaultPlan.estimatedExpiry).toEqual([expect.objectContaining({
    expiresAtIso: '2026-09-08T12:00:00.000Z',
    basis: expect.stringContaining('Topview API storage documentation'),
  })]);
  expect(configuredPlan.estimatedExpiry).toEqual([expect.objectContaining({
    expiresAtIso: '2026-09-15T12:00:00.000Z',
    basis: 'User-configured retention estimate: createdAt plus 14 days.',
  })]);
  expect(configuredPlan.estimatedExpiry[0]!.basis).not.toContain('Topview API storage documentation');
});

test('keeps local downloads and expiry planning when S3 is unavailable', () => {
  const assets = [
    { beatIndex: 0, vendor: 'higgsfield' as const, url: 'https://cdn.example/higgs.mp4', createdAt: '2026-09-01T12:00:00.000Z' },
    { beatIndex: 1, vendor: 'topview' as const, url: 'https://cdn.example/topview.mov', createdAt: '2026-09-01T12:00:00.000Z' },
    { beatIndex: 2, vendor: 'topview' as const, url: 'https://cdn.example/unknown.mp4' },
  ];
  const s3Enabled = buildRetainPlan(assets, options);
  const s3Unavailable = buildRetainPlan(assets, { ...options, s3Available: false });

  expect(s3Unavailable).toMatchObject({ blocked: [], s3Skipped: true });
  expect(s3Unavailable.commands).toHaveLength(3);
  expect(s3Unavailable.commands.map(({ download, localPath }) => ({ download, localPath }))).toEqual(
    s3Enabled.commands.map(({ download, localPath }) => ({ download, localPath })),
  );
  expect(s3Unavailable.commands.map(({ s3Key }) => s3Key)).toEqual(s3Enabled.commands.map(({ s3Key }) => s3Key));
  expect(s3Unavailable.estimatedExpiry).toEqual(s3Enabled.estimatedExpiry);
  expect(s3Unavailable.expiredEstimatedExpiry).toEqual(s3Enabled.expiredEstimatedExpiry);
  expect(s3Unavailable.unknownExpiry).toEqual(s3Enabled.unknownExpiry);
});

test('keeps invalid-now blocking ahead of S3 skip state', () => {
  const plan = buildRetainPlan([
    { beatIndex: 0, vendor: 'higgsfield', url: 'https://cdn.example/higgs.mp4', createdAt: now },
  ], { ...options, s3Available: false, now: 'not-a-date' });

  expect(plan).toEqual({
    commands: [], estimatedExpiry: [], expiredEstimatedExpiry: [], unknownExpiry: [], blocked: ['invalid-now'], s3Skipped: true,
  });
});

test('uses injected now for both future-creation blocking and valid command planning', () => {
  const asset = { beatIndex: 0, vendor: 'topview' as const, url: 'https://cdn.example/asset.mp4', createdAt: '2026-09-12T00:00:00.000Z' };

  expect(buildRetainPlan([asset], { ...options, now: 'not-a-date' })).toMatchObject({ commands: [], blocked: ['invalid-now'] });
  expect(buildRetainPlan([asset], { ...options, now: '2026-09-11T12:00:00.000Z' })).toMatchObject({ commands: [], blocked: ['created-at-after-now:beat-0'] });
  expect(buildRetainPlan([asset], { ...options, now: '2026-09-12T12:00:00.000Z' })).toMatchObject({ blocked: [] });
  expect(buildRetainPlan([asset], { ...options, now: '2026-09-12T12:00:00.000Z' }).commands).toHaveLength(1);
});

test('accepts any nonzero fractional-second precision with Z and offset timezones', () => {
  const createdAts = [
    '2026-09-10T18:02:07Z',
    '2026-09-10T18:02:07.954Z',
    '2026-09-10T18:02:07.954409Z',
    '2026-09-10T18:02:07.954409123+09:00',
  ];

  const plan = buildRetainPlan(createdAts.map((createdAt, beatIndex) => ({
    beatIndex,
    vendor: 'topview' as const,
    url: `https://cdn.example/fractional-${beatIndex}.mp4`,
    createdAt,
  })), options);

  expect(plan.commands).toHaveLength(createdAts.length);
  expect(plan.estimatedExpiry).toHaveLength(createdAts.length);
  expect(plan).toMatchObject({ blocked: [] });
});

test('rejects timezone-less now and createdAt values rather than depending on the process timezone', () => {
  const timezoneLess = '2026-09-01T12:00:00';
  const asset = { beatIndex: 6, vendor: 'topview' as const, url: 'https://cdn.example/timezone.mp4', createdAt: timezoneLess };

  expect(buildRetainPlan([asset], { ...options, now: timezoneLess })).toEqual({
    commands: [], estimatedExpiry: [], expiredEstimatedExpiry: [], unknownExpiry: [], blocked: ['invalid-now'], s3Skipped: false,
  });
  expect(buildRetainPlan([asset], options)).toEqual(expect.objectContaining({
    commands: [], estimatedExpiry: [], expiredEstimatedExpiry: [], unknownExpiry: [], blocked: ['invalid-created-at:beat-6'],
  }));
  expect(buildRetainPlan([{ ...asset, createdAt: '2026-09-01T12:00:00+00:00' }], options).commands).toHaveLength(1);
});

test('rejects calendar-invalid now and createdAt while accepting a valid leap day', () => {
  const asset = { beatIndex: 7, vendor: 'topview' as const, url: 'https://cdn.example/calendar.mp4', createdAt: '2026-02-28T12:00:00Z' };

  expect(buildRetainPlan([asset], { ...options, now: '2026-02-30T12:00:00Z' })).toEqual({
    commands: [], estimatedExpiry: [], expiredEstimatedExpiry: [], unknownExpiry: [], blocked: ['invalid-now'], s3Skipped: false,
  });
  expect(buildRetainPlan([{ ...asset, createdAt: '2026-02-30T12:00:00Z' }], options)).toEqual(expect.objectContaining({
    commands: [], estimatedExpiry: [], expiredEstimatedExpiry: [], unknownExpiry: [], blocked: ['invalid-created-at:beat-7'],
  }));
  expect(buildRetainPlan([{ ...asset, createdAt: '2024-02-29T12:00:00Z' }], { ...options, now: '2024-03-01T12:00:00Z' }).commands).toHaveLength(1);
});

test('rejects non-HTTP remote URLs and places valid URLs after curl option boundary', () => {
  const invalidAssets = [
    { beatIndex: 8, vendor: 'topview' as const, url: '--config=/tmp/curlrc' },
    { beatIndex: 9, vendor: 'topview' as const, url: 'file:///tmp/asset.mp4' },
  ];

  expect(buildRetainPlan(invalidAssets, options)).toEqual(expect.objectContaining({
    commands: [], blocked: ['invalid-remote-url:beat-8', 'invalid-remote-url:beat-9'],
  }));
  expect(buildRetainPlan([{ beatIndex: 10, vendor: 'topview' as const, url: 'https://cdn.example/asset.mp4' }], options).commands[0]!.download).toEqual([
    'curl', '-fsSL', '--globoff', '--create-dirs', '-o', expect.any(String), '--', 'https://cdn.example/asset.mp4',
  ]);
});

test('disables curl URL globbing while preserving bracketed and braced HTTP URLs as single arguments', () => {
  const urls = [
    'https://cdn.example/asset.mp4?part=[1-3]',
    'https://cdn.example/asset.mp4?variant={low,high}',
  ];
  const commands = buildRetainPlan(urls.map((url, beatIndex) => ({ beatIndex, vendor: 'topview' as const, url })), options).commands;

  expect(commands).toHaveLength(urls.length);
  for (const [index, url] of urls.entries()) {
    const download = commands[index]!.download;
    expect(download).toEqual(['curl', '-fsSL', '--globoff', '--create-dirs', '-o', commands[index]!.localPath, '--', url]);
    expect(download.filter((argument) => argument === url)).toHaveLength(1);
    expect(download.indexOf('--globoff')).toBeLessThan(download.indexOf('--'));
  }
});

test('distinguishes destination paths for different URLs at the same vendor and beat', () => {
  const plan = buildRetainPlan([
    { beatIndex: 4, vendor: 'higgsfield', url: 'https://cdn.example/first.mp4', createdAt: now },
    { beatIndex: 4, vendor: 'higgsfield', url: 'https://cdn.example/second.mp4', createdAt: now },
  ], options);

  expect(plan.commands).toHaveLength(2);
  expect(plan.commands[0]!.localPath).not.toBe(plan.commands[1]!.localPath);
  expect(plan.commands[0]!.s3Key).not.toBe(plan.commands[1]!.s3Key);
});

test('uses fixed-length URL hashes so long signed URLs do not leak into local or S3 destinations', () => {
  const token = 'secret-token-should-never-be-retained';
  const firstUrl = `https://cdn.example/assets/first.mp4?signature=${token}&padding=${'x'.repeat(4_000)}`;
  const secondUrl = `https://cdn.example/assets/second.mp4?signature=${token}&padding=${'x'.repeat(4_000)}`;
  const plan = buildRetainPlan([
    { beatIndex: 5, vendor: 'higgsfield', url: firstUrl, createdAt: now },
    { beatIndex: 5, vendor: 'higgsfield', url: secondUrl, createdAt: now },
  ], options);
  const [first, second] = plan.commands;

  expect(first!.download).toContain(firstUrl);
  expect(first!.localPath.length).toBeLessThanOrEqual(255);
  expect(first!.s3Key.length).toBeLessThanOrEqual(1_024);
  expect(first!.localPath).not.toContain(token);
  expect(first!.s3Key).not.toContain(token);
  expect(first!.localPath).not.toContain(encodeURIComponent(token));
  expect(first!.s3Key).not.toContain(encodeURIComponent(token));
  expect(first!.localPath).not.toBe(second!.localPath);
  expect(first!.s3Key).not.toBe(second!.s3Key);
});

test('serializes negative timestamps and blocks expiry outside Date range', () => {
  const beforeEpoch = buildRetainPlan([
    { beatIndex: 3, vendor: 'topview', url: 'https://cdn.example/old.mp4', createdAt: '1969-12-31T23:59:59.001Z' },
  ], { ...options, now: '1970-01-01T00:00:00.000Z' });
  expect(beforeEpoch.estimatedExpiry[0]!.expiresAtIso).toBe('1970-01-07T23:59:59.001Z');

  const outsideDateRange = buildRetainPlan([
    { beatIndex: 5, vendor: 'higgsfield', url: 'https://cdn.example/future.mp4', createdAt: '1970-01-01T00:00:00.000Z' },
  ], { ...options, now, retentionDays: { higgsfield: Number.MAX_VALUE, topview: 7 } });
  expect(outsideDateRange).toEqual(expect.objectContaining({ commands: [], estimatedExpiry: [], blocked: ['expiry-out-of-range:beat-5'] }));
});
