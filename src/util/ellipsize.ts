// 문자열을 max 글자 이내로 줄인다. 잘릴 때도 말줄임표를 같은 예산 안에 포함한다.
export function ellipsize(s: string, max: number): string {
  // Defensive boundary: an empty or negative display budget cannot show text.
  if (max <= 0) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
