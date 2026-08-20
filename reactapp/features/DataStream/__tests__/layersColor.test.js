/**
 * Pins valueToColor's output after hoisting its color scale to module scope.
 *
 * The scale and the missing-value color were rebuilt on every call, and deck.gl calls this
 * once per flowpath per animation frame. The expected values below were captured from the
 * previous implementation, so any drift in the ramp shows up here.
 */
import { valueToColor, computeBounds } from 'features/DataStream/lib/layers';

const B = { min: 0, max: 50 };

describe('valueToColor', () => {
  // [name, value, bounds, expected] captured from the pre-hoist implementation.
  const cases = [
    ['null', null, B, [100, 100, 100, 150]],
    ['undefined', undefined, B, [100, 100, 100, 150]],
    ['missing sentinel', -9999, B, [100, 100, 100, 150]],
    ['exactly the sentinel boundary', -9998, B, [100, 100, 100, 150]],
    ['degenerate bounds', 5, { min: 3, max: 3 }, [0, 119, 187]],
    ['no bounds', 5, null, [0, 119, 187]],
    ['at min', 0, B, [0, 119, 187]],
    ['at max', 50, B, [208, 0, 0]],
    ['quarter', 12.5, B, [200, 205, 124]],
    ['half', 25, B, [255, 144, 32]],
    ['three quarters', 37.5, B, [239, 72, 36]],
    ['small', 0.7, B, [0, 155, 204]],
  ];

  it.each(cases)('%s', (_name, value, bounds, expected) => {
    expect(valueToColor(value, bounds)).toEqual(expected);
  });

  // Out of range used to index past the end of the scale and throw inside a deck.gl accessor.
  it.each([
    ['above max', 60, [208, 0, 0]],
    ['below min', -5, [0, 119, 187]],
    ['NaN', NaN, [0, 119, 187]],
  ])('clamps %s instead of throwing', (_name, value, expected) => {
    expect(() => valueToColor(value, B)).not.toThrow();
    expect(valueToColor(value, B)).toEqual(expected);
  });

  it('never returns a color the scale cannot express', () => {
    const bounds = computeBounds(Float32Array.from([0, 10, 25, 50, -9999]));
    for (let v = -20; v <= 70; v += 0.5) {
      const c = valueToColor(v, bounds);
      expect(c.every((channel) => Number.isFinite(channel))).toBe(true);
    }
  });
});

describe('computeBounds', () => {
  it('ignores the missing-value sentinel', () => {
    expect(computeBounds(Float32Array.from([-9999, 4, 8, -9998]))).toEqual({ min: 4, max: 8 });
  });

  it('falls back to 0..1 when nothing is valid', () => {
    expect(computeBounds(Float32Array.from([-9999, -9999]))).toEqual({ min: 0, max: 1 });
    expect(computeBounds(new Float32Array())).toEqual({ min: 0, max: 1 });
  });
});
