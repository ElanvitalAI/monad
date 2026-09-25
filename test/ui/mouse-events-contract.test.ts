import { describe, expect, test } from 'bun:test';
import {
  isCaptureEndMouseEventType,
  isCaptureMoveMouseEventType,
  isClickIntentMouseEventType,
  isCaptureMouseEventType,
  isIntentMouseEventType,
  isPrimaryClickMouseEventType,
  isRawCaptureBoundaryMouseEventType,
  toWidgetMouseEventType,
} from '../../src/ui/mouse-events.js';

describe('mouse event contract helpers', () => {
  test('intent events exclude raw capture boundaries', () => {
    expect(isIntentMouseEventType('click')).toBe(true);
    expect(isIntentMouseEventType('double-click')).toBe(true);
    expect(isIntentMouseEventType('right-click')).toBe(true);
    expect(isIntentMouseEventType('scroll-up')).toBe(true);
    expect(isIntentMouseEventType('drag')).toBe(true);
    expect(isIntentMouseEventType('mouse-down')).toBe(false);
    expect(isIntentMouseEventType('release')).toBe(false);
    expect(isPrimaryClickMouseEventType('click')).toBe(true);
    expect(isPrimaryClickMouseEventType('double-click')).toBe(false);
    expect(isPrimaryClickMouseEventType('right-click')).toBe(false);
    expect(isClickIntentMouseEventType('click')).toBe(true);
    expect(isClickIntentMouseEventType('double-click')).toBe(true);
    expect(isClickIntentMouseEventType('right-click')).toBe(false);
    expect(isClickIntentMouseEventType('drag')).toBe(false);
  });

  test('capture helpers distinguish boundary from full capture lifecycle', () => {
    expect(isCaptureMouseEventType('mouse-down')).toBe(true);
    expect(isCaptureMouseEventType('drag')).toBe(true);
    expect(isCaptureMouseEventType('release')).toBe(true);
    expect(isCaptureMoveMouseEventType('drag')).toBe(true);
    expect(isCaptureMoveMouseEventType('mouse-down')).toBe(false);
    expect(isCaptureMoveMouseEventType('release')).toBe(false);
    expect(isCaptureEndMouseEventType('release')).toBe(true);
    expect(isCaptureEndMouseEventType('mouse-down')).toBe(false);
    expect(isCaptureEndMouseEventType('drag')).toBe(false);
    expect(isRawCaptureBoundaryMouseEventType('mouse-down')).toBe(true);
    expect(isRawCaptureBoundaryMouseEventType('release')).toBe(true);
    expect(isRawCaptureBoundaryMouseEventType('drag')).toBe(false);
  });

  test('widget mouse type mapper translates motion to hover-over', () => {
    expect(toWidgetMouseEventType('motion')).toBe('hover-over');
    expect(toWidgetMouseEventType('click')).toBe('click');
    expect(toWidgetMouseEventType('double-click')).toBe('double-click');
    expect(toWidgetMouseEventType('drag')).toBe('drag');
    expect(toWidgetMouseEventType('release')).toBe('release');
  });
});
