import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BotlabPanel, botWallUrl } from './BotlabPanel';

// 2026-09-25: 벽 호스트는 «설정»이다 — 시험은 자리표 호스트를 «기억된 값»으로 준다.
const HOST = 'cloud-vm.tailnet-example.ts.net';

function render(search: string, remembered: string | null = HOST): string {
  return renderToStaticMarkup(<BotlabPanel search={search} remembered={remembered} />);
}

describe('🖥️ Botlab — §22 A0·A1', () => {
  it('① ⛔ 문서는 «하나»다 — iframe 이 넷이면 비번을 네 번 친다(§22n ⑵ 실측)', () => {
    const markup = render('');
    const frames = markup.split('<iframe').length - 1;
    expect(frames).toBe(1);
  });

  it('② ⛔ 주소는 serve 경유 «https» 로만 — http 는 Mixed Content 로 막힌다(§22n ⑷)', () => {
    const markup = render('');
    expect(botWallUrl(HOST)).toBe(`https://${HOST}/bot3/bot-wall.html`);
    expect(markup).toContain(`https://${HOST}/bot3/bot-wall.html`);
    // 🩸 http:// 주소가 «한 자리도» 없어야 한다 — 있으면 그 기기에서 조용히 막힌다.
    expect(markup).not.toContain('http://');
  });

  it('③ ⛔⭐ 비번을 «싣지 않는다» — 웹소켓엔 CORS 가 없다(bot-wall.html R2)', () => {
    const markup = render('');
    for (const leak of ['password=', 'vncpassword', 'passwd=']) {
      expect(markup.toLowerCase()).not.toContain(leak);
    }
  });

  it('④ ⛔ 기본은 «보기 전용» — control 을 켜지 않는다(§22n ④)', () => {
    expect(render('')).not.toContain('control=1');
  });

  it('⑤ ⭐ 「쓴 주소」를 «항상» 보여 준다 — 안 보일 때 사람이 그것으로 가른다', () => {
    const markup = render('');
    expect(markup).toContain('botlab-wall-url');
    expect(markup).toContain('Open the wall in a new tab');
  });

  it('⑥ ?host= 를 받고, 「어디서 왔는지」를 «말한다»', () => {
    const mine = render('?host=other.ts.net');
    expect(mine).toContain('https://other.ts.net/bot3/bot-wall.html');
    expect(mine).toContain('?host= query parameter');
    expect(render('')).toContain('remembered on this device');
  });

  it('⑦ ⛔ 계약 밖 host 는 «무시했다고 말한다» — 조용히 안 떨어진다', () => {
    const markup = render('?host=https://evil.example');
    expect(markup).toContain('botlab-host-rejected');
    expect(markup).toContain(`https://${HOST}/bot3/bot-wall.html`);
  });

  it('⑧ ⛔⭐ 「빈 화면」의 이유 «셋»을 말한다 — 고장으로 읽히지 않게', () => {
    const markup = render('');
    expect(markup).toContain('outside the tailnet');
    expect(markup).toContain('deploy-bot-wall.sh');
    expect(markup).toContain('loaded but did not connect');
  });

  it('⑨ ⛔ 「아직 없는 것」을 «말한다» — 없는 것을 버튼으로 만들지 않는다', () => {
    const markup = render('');
    expect(markup).toContain('Not wired yet');
    // 🔑 POST 라우트가 없으므로 실행 버튼이 «한 개도» 없어야 한다.
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<form');
  });

  it('⑩ ⛔ 호스트가 «없으면» 벽을 안 띄우고 「?host= 를 달라」고 말한다 — 남의 기계로 붙지 않는다', () => {
    const markup = render('', null);
    expect(markup).toContain('No wall host is configured');
    expect(markup).not.toContain('<iframe');
    expect(markup).not.toContain('Open the wall in a new tab');
  });
});
