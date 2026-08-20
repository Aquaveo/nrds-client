/**
 * Pins the flowpath color ramp.
 *
 * deck.gl calls this once per flowpath per animation frame, so it writes into the reusable
 * target array deck.gl supplies rather than returning a new one. The RGB values below were
 * captured from the original implementation, before the scale was hoisted to module scope
 * and before the target rewrite, so any drift in the ramp shows up here.
 */
import { writeColorInto, computeBounds } from 'features/DataStream/lib/layers';

const B = { min: 0, max: 50 };
const color = (value, bounds = B) => writeColorInto(value, bounds, [0, 0, 0, 0]);

describe('writeColorInto', () => {
  // [name, value, bounds, expected rgb] -- alpha is asserted separately below.
  const cases = [
    ['at min', 0, B, [0, 119, 187]],
    ['at max', 50, B, [208, 0, 0]],
    ['quarter', 12.5, B, [200, 205, 124]],
    ['half', 25, B, [255, 144, 32]],
    ['three quarters', 37.5, B, [239, 72, 36]],
    ['small', 0.7, B, [0, 155, 204]],
    ['degenerate bounds', 5, { min: 3, max: 3 }, [0, 119, 187]],
    ['no bounds', 5, null, [0, 119, 187]],
  ];

  it.each(cases)('%s', (_name, value, bounds, rgb) => {
    expect(color(value, bounds)).toEqual([...rgb, 255]);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['missing sentinel', -9999],
    ['the sentinel boundary', -9998],
  ])('draws %s as the missing color', (_name, value) => {
    expect(color(value)).toEqual([100, 100, 100, 150]);
  });

  // Out of range used to index past the end of the scale and throw inside a deck.gl accessor.
  it.each([
    ['above max', 60, [208, 0, 0]],
    ['below min', -5, [0, 119, 187]],
    ['NaN', NaN, [0, 119, 187]],
  ])('clamps %s instead of throwing', (_name, value, rgb) => {
    expect(() => color(value)).not.toThrow();
    expect(color(value)).toEqual([...rgb, 255]);
  });

  it('writes into the array it is given rather than allocating', () => {
    const target = [0, 0, 0, 0];
    expect(writeColorInto(25, B, target)).toBe(target);
    expect(target).toEqual([255, 144, 32, 255]);
  });

  it('always writes alpha, so a reused target cannot leak the previous value', () => {
    const target = [0, 0, 0, 0];
    writeColorInto(-9999, B, target);
    expect(target[3]).toBe(150);
    writeColorInto(25, B, target);
    expect(target[3]).toBe(255);
  });

  it('never produces a non-finite channel across the range', () => {
    const bounds = computeBounds(Float32Array.from([0, 10, 25, 50, -9999]));
    const target = [0, 0, 0, 0];
    for (let v = -20; v <= 70; v += 0.5) {
      writeColorInto(v, bounds, target);
      expect(target.every((channel) => Number.isFinite(channel))).toBe(true);
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
