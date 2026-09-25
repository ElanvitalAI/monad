import { test, expect, describe } from 'bun:test';
import { mdToHtml, renderHtmlPage } from './md-to-html.js';

describe('md-to-html — mdToHtml', () => {
  test('헤딩', () => {
    expect(mdToHtml('# 제목')).toContain('<h1>제목</h1>');
    expect(mdToHtml('### 소제목')).toContain('<h3>소제목</h3>');
  });
  test('인라인 강조/코드/링크', () => {
    expect(mdToHtml('**굵게** *기울임* `코드`')).toContain('<strong>굵게</strong>');
    expect(mdToHtml('**굵게**')).toContain('<strong>굵게</strong>');
    expect(mdToHtml('[네이버](https://naver.com)')).toContain('<a href="https://naver.com">네이버</a>');
  });
  test('GFM 테이블', () => {
    const html = mdToHtml('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>1</td>');
  });
  test('목록', () => {
    const html = mdToHtml('- 하나\n- 둘');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>하나</li>');
  });
  test('펜스 코드블록 정렬 보존 + 이스케이프', () => {
    const html = mdToHtml('```\nbonds  -36.0  <down>\ncash   -11.8\n```');
    expect(html).toContain('<pre><code>');
    expect(html).toContain('&lt;down&gt;');
    expect(html).toContain('bonds  -36.0');
  });
  test('HTML 이스케이프', () => {
    expect(mdToHtml('S&P 500 <em>')).toContain('S&amp;P 500 &lt;em&gt;');
  });
});

describe('md-to-html — renderHtmlPage', () => {
  test('제목·본문·이미지 삽입', () => {
    const page = renderHtmlPage({ title: '아침 브리핑', bodyMd: '## 국면\n\nRISK_ON', imageUrl: 'https://x/heat.png' });
    expect(page).toContain('<!DOCTYPE html>');
    expect(page).toContain('<title>아침 브리핑</title>');
    expect(page).toContain('<h2>국면</h2>');
    expect(page).toContain('src="https://x/heat.png"');
  });
  test('이미지 없으면 img 태그 없음', () => {
    const page = renderHtmlPage({ title: 't', bodyMd: 'hi' });
    expect(page).not.toContain('class="heatmap"');
  });
});
