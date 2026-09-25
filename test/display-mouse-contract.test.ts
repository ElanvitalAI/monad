import { describe, expect, test } from 'bun:test';
import {
  isDismissGraceMouseEventType,
  isDiscreteClickMouseEventType,
  isCaptureSessionEndMouseEventType,
  isCaptureSessionMouseEventType,
  isDismissMouseEventType,
  isModalChromeMouseEventType,
  isPointerFocusMouseEventType,
  isPrimaryButtonClickMouseEventType,
  isPrimaryDiscreteClickMouseEventType,
  isPtyForwardMouseEventType,
  isSecondaryClickMouseEventType,
  isPreCaptureResetMouseEventType,
} from '../src/display/types.js';

describe('display mouse contract helpers', () => {
  test('modal chrome helper accepts only host-owned title rail events', () => {
    expect(isModalChromeMouseEventType('click')).toBe(true);
    expect(isModalChromeMouseEventType('double-click')).toBe(true);
    expect(isModalChromeMouseEventType('drag')).toBe(true);
    expect(isModalChromeMouseEventType('release')).toBe(true);

    expect(isModalChromeMouseEventType('right-click')).toBe(false);
    expect(isModalChromeMouseEventType('scroll-up')).toBe(false);
    expect(isModalChromeMouseEventType('scroll-down')).toBe(false);
    expect(isModalChromeMouseEventType('motion')).toBe(false);
  });

  test('capture session helper accepts only drag lifecycle continuation', () => {
    expect(isCaptureSessionMouseEventType('drag')).toBe(true);
    expect(isCaptureSessionMouseEventType('release')).toBe(true);

    expect(isCaptureSessionMouseEventType('click')).toBe(false);
    expect(isCaptureSessionMouseEventType('double-click')).toBe(false);
    expect(isCaptureSessionMouseEventType('right-click')).toBe(false);
    expect(isCaptureSessionMouseEventType('scroll-up')).toBe(false);
    expect(isCaptureSessionMouseEventType('scroll-down')).toBe(false);
    expect(isCaptureSessionMouseEventType('motion')).toBe(false);
  });

  test('capture session end helper accepts only release', () => {
    expect(isCaptureSessionEndMouseEventType('release')).toBe(true);

    expect(isCaptureSessionEndMouseEventType('drag')).toBe(false);
    expect(isCaptureSessionEndMouseEventType('click')).toBe(false);
    expect(isCaptureSessionEndMouseEventType('double-click')).toBe(false);
    expect(isCaptureSessionEndMouseEventType('right-click')).toBe(false);
    expect(isCaptureSessionEndMouseEventType('scroll-up')).toBe(false);
    expect(isCaptureSessionEndMouseEventType('scroll-down')).toBe(false);
    expect(isCaptureSessionEndMouseEventType('motion')).toBe(false);
  });

  test('dismiss helper matches outside-close host semantics', () => {
    expect(isDismissMouseEventType('click')).toBe(true);
    expect(isDismissMouseEventType('double-click')).toBe(true);
    expect(isDismissMouseEventType('right-click')).toBe(true);
    expect(isDismissMouseEventType('release')).toBe(true);

    expect(isDismissMouseEventType('drag')).toBe(false);
    expect(isDismissMouseEventType('scroll-up')).toBe(false);
    expect(isDismissMouseEventType('scroll-down')).toBe(false);
    expect(isDismissMouseEventType('motion')).toBe(false);
  });

  test('dismiss grace helper accepts only release', () => {
    expect(isDismissGraceMouseEventType('release')).toBe(true);

    expect(isDismissGraceMouseEventType('click')).toBe(false);
    expect(isDismissGraceMouseEventType('double-click')).toBe(false);
    expect(isDismissGraceMouseEventType('right-click')).toBe(false);
    expect(isDismissGraceMouseEventType('drag')).toBe(false);
    expect(isDismissGraceMouseEventType('scroll-up')).toBe(false);
    expect(isDismissGraceMouseEventType('scroll-down')).toBe(false);
    expect(isDismissGraceMouseEventType('motion')).toBe(false);
  });

  test('pre-capture reset helper matches drag-source threshold reset semantics', () => {
    expect(isPreCaptureResetMouseEventType('click')).toBe(true);
    expect(isPreCaptureResetMouseEventType('release')).toBe(true);

    expect(isPreCaptureResetMouseEventType('double-click')).toBe(false);
    expect(isPreCaptureResetMouseEventType('right-click')).toBe(false);
    expect(isPreCaptureResetMouseEventType('drag')).toBe(false);
    expect(isPreCaptureResetMouseEventType('scroll-up')).toBe(false);
    expect(isPreCaptureResetMouseEventType('scroll-down')).toBe(false);
    expect(isPreCaptureResetMouseEventType('motion')).toBe(false);
  });

  test('pointer-focus helper matches host retarget semantics', () => {
    expect(isPointerFocusMouseEventType('click')).toBe(true);
    expect(isPointerFocusMouseEventType('double-click')).toBe(true);
    expect(isPointerFocusMouseEventType('drag')).toBe(true);
    expect(isPointerFocusMouseEventType('motion')).toBe(true);

    expect(isPointerFocusMouseEventType('right-click')).toBe(false);
    expect(isPointerFocusMouseEventType('release')).toBe(false);
    expect(isPointerFocusMouseEventType('scroll-up')).toBe(false);
    expect(isPointerFocusMouseEventType('scroll-down')).toBe(false);
  });

  test('discrete click helper matches click publication semantics', () => {
    expect(isDiscreteClickMouseEventType('click')).toBe(true);
    expect(isDiscreteClickMouseEventType('double-click')).toBe(true);
    expect(isDiscreteClickMouseEventType('right-click')).toBe(true);

    expect(isDiscreteClickMouseEventType('drag')).toBe(false);
    expect(isDiscreteClickMouseEventType('release')).toBe(false);
    expect(isDiscreteClickMouseEventType('scroll-up')).toBe(false);
    expect(isDiscreteClickMouseEventType('scroll-down')).toBe(false);
    expect(isDiscreteClickMouseEventType('motion')).toBe(false);
  });

  test('primary discrete click helper excludes right-click from the primary lane', () => {
    expect(isPrimaryDiscreteClickMouseEventType('click')).toBe(true);
    expect(isPrimaryDiscreteClickMouseEventType('double-click')).toBe(true);

    expect(isPrimaryDiscreteClickMouseEventType('right-click')).toBe(false);
    expect(isPrimaryDiscreteClickMouseEventType('drag')).toBe(false);
    expect(isPrimaryDiscreteClickMouseEventType('release')).toBe(false);
    expect(isPrimaryDiscreteClickMouseEventType('scroll-up')).toBe(false);
    expect(isPrimaryDiscreteClickMouseEventType('scroll-down')).toBe(false);
    expect(isPrimaryDiscreteClickMouseEventType('motion')).toBe(false);
  });

  test('secondary click helper isolates context-menu trigger semantics', () => {
    expect(isSecondaryClickMouseEventType('right-click')).toBe(true);

    expect(isSecondaryClickMouseEventType('click')).toBe(false);
    expect(isSecondaryClickMouseEventType('double-click')).toBe(false);
    expect(isSecondaryClickMouseEventType('drag')).toBe(false);
    expect(isSecondaryClickMouseEventType('release')).toBe(false);
    expect(isSecondaryClickMouseEventType('scroll-up')).toBe(false);
    expect(isSecondaryClickMouseEventType('scroll-down')).toBe(false);
    expect(isSecondaryClickMouseEventType('motion')).toBe(false);
  });

  test('primary button click helper isolates left-click-only host triggers', () => {
    expect(isPrimaryButtonClickMouseEventType('click')).toBe(true);

    expect(isPrimaryButtonClickMouseEventType('double-click')).toBe(false);
    expect(isPrimaryButtonClickMouseEventType('right-click')).toBe(false);
    expect(isPrimaryButtonClickMouseEventType('drag')).toBe(false);
    expect(isPrimaryButtonClickMouseEventType('release')).toBe(false);
    expect(isPrimaryButtonClickMouseEventType('scroll-up')).toBe(false);
    expect(isPrimaryButtonClickMouseEventType('scroll-down')).toBe(false);
    expect(isPrimaryButtonClickMouseEventType('motion')).toBe(false);
  });

  test('pty forward helper accepts only native transportable mouse signals', () => {
    expect(isPtyForwardMouseEventType('click')).toBe(true);
    expect(isPtyForwardMouseEventType('right-click')).toBe(true);
    expect(isPtyForwardMouseEventType('scroll-up')).toBe(true);
    expect(isPtyForwardMouseEventType('scroll-down')).toBe(true);
    expect(isPtyForwardMouseEventType('drag')).toBe(true);
    expect(isPtyForwardMouseEventType('release')).toBe(true);

    expect(isPtyForwardMouseEventType('double-click')).toBe(false);
    expect(isPtyForwardMouseEventType('motion')).toBe(false);
  });
});
