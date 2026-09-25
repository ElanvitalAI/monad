function buildDashboardMediaSampleImageText(): string {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">`,
    `<rect width="960" height="540" fill="#101418"/>`,
    `<rect x="40" y="40" width="880" height="460" rx="24" fill="#17324d"/>`,
    `<text x="84" y="156" fill="#f4f8fb" font-size="46" font-family="Menlo, monospace">Monad media sink sample</text>`,
    `<text x="84" y="230" fill="#d6e1ea" font-size="26" font-family="Menlo, monospace">picture-ref via data URL</text>`,
    `<text x="84" y="284" fill="#d6e1ea" font-size="26" font-family="Menlo, monospace">/media open should prefer preview modal first</text>`,
    `<circle cx="756" cy="250" r="96" fill="#7ac8ff"/>`,
    `<path d="M730 220l52 30-52 30z" fill="#17324d"/>`,
    `</svg>`,
  ].join('');
  return `![Monad media sink sample](data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)})`;
}

function buildDashboardMediaSampleVideoText(url?: string): string {
  const target = url?.trim() || 'https://samplelib.com/lib/preview/mp4/sample-5s.mp4';
  return `[Monad media sink sample video](${target})`;
}

export function buildDashboardMediaSampleText(
  kind: 'picture' | 'video',
  url?: string,
): string {
  return kind === 'picture'
    ? buildDashboardMediaSampleImageText()
    : buildDashboardMediaSampleVideoText(url);
}
