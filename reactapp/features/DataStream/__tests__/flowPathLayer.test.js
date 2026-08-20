/**
 * deck.gl gates drawing on `visible` but not attribute updates, so a hidden layer fed a live
 * frame index would recompute colour and width for every path on every step of a playback
 * nobody can see. The props builder is separated from the component so that can be asserted
 * without a canvas or a deck.gl instance.
 */
import { flowPathLayerProps } from 'features/DataStream/components/map/flowPathLayer';

const base = {
  visible: true,
  valuesByVar: Float32Array.from([1, 2, 3, 4]),
  timesArr: ['t0', 't1'],
  variable: 'flow',
  bounds: { min: 0, max: 4 },
  pathData: [{ path: [[0, 0], [1, 1]], featureIndex: 0 }],
  currentTimeIndex: 0,
  pathTick: 0,
};

const triggersOf = (overrides) => flowPathLayerProps({ ...base, ...overrides }).updateTriggers;

describe('flowPathLayerProps', () => {
  it('has nothing to draw without values, times or paths', () => {
    expect(flowPathLayerProps({ ...base, valuesByVar: null })).toBe(null);
    expect(flowPathLayerProps({ ...base, timesArr: [] })).toBe(null);
    expect(flowPathLayerProps({ ...base, pathData: [] })).toBe(null);
  });

  it('advances the triggers with the frame while visible', () => {
    expect(triggersOf({ currentTimeIndex: 4 })).not.toEqual(triggersOf({ currentTimeIndex: 5 }));
  });

  it('freezes the triggers while hidden, so no frame causes a recompute', () => {
    const atFour = triggersOf({ visible: false, currentTimeIndex: 4 });
    const atFive = triggersOf({ visible: false, currentTimeIndex: 5 });

    expect(atFour).toEqual(atFive);
    expect(atFour.getColor).toEqual(atFive.getColor);
    expect(atFour.getWidth).toEqual(atFive.getWidth);
  });

  it('recomputes once when the layer is shown again', () => {
    const hidden = triggersOf({ visible: false, currentTimeIndex: 7 });
    const shown = triggersOf({ visible: true, currentTimeIndex: 7 });

    // A changed trigger is what makes deck.gl rebuild the attributes it skipped while hidden.
    expect(hidden).not.toEqual(shown);
  });

  it('keeps the layer mounted when hidden rather than dropping it', () => {
    const props = flowPathLayerProps({ ...base, visible: false });

    expect(props).not.toBe(null);
    expect(props.visible).toBe(false);
  });

  it('still varies with the variable and the path tick while visible', () => {
    expect(triggersOf({ variable: 'precipitation' })).not.toEqual(triggersOf({ variable: 'flow' }));
    expect(triggersOf({ pathTick: 1 })).not.toEqual(triggersOf({ pathTick: 0 }));
  });
});
