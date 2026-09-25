import { describe, expect, mock, test } from 'bun:test';

import { bootDashboardWidgetHost } from '../src/dashboard/widget-host-boot.js';

describe('bootDashboardWidgetHost', () => {
  test('discovers widgets and attaches the widget host to the plugin host', async () => {
    const discover = mock(async () => {});
    const setWidgetHost = mock((_host: unknown) => {});
    const widgetHost = { discover };

    await bootDashboardWidgetHost({
      widgetHost: widgetHost as never,
      pluginHost: { setWidgetHost } as never,
      pushDebugLine: mock((_line: string) => {}),
    });

    expect(discover).toHaveBeenCalled();
    expect(setWidgetHost).toHaveBeenCalledWith(widgetHost);
  });

  test('formats discover errors into warning lines and still attaches the widget host', async () => {
    const discover = mock(async () => {
      throw new Error('boom');
    });
    const setWidgetHost = mock((_host: unknown) => {});
    const pushDebugLine = mock((_line: string) => {});
    const widgetHost = { discover };

    await bootDashboardWidgetHost({
      widgetHost: widgetHost as never,
      pluginHost: { setWidgetHost } as never,
      pushDebugLine,
    });

    expect(pushDebugLine).toHaveBeenCalledWith(expect.stringContaining('widget discovery failed: boom'));
    expect(setWidgetHost).toHaveBeenCalledWith(widgetHost);
  });
});
