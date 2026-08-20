import { getValueAtTimeFlat, writeColorInto } from '../../lib/layers';

// Stands in for the frame index while the layer is hidden. deck.gl gates drawing on `visible`
// but not attribute updates, so with a live index it would keep recomputing colour and width
// for every path on every frame of a playback nobody can see. Freezing costs one recompute
// when the layer is toggled rather than one per frame while it is off.
const HIDDEN = 'hidden';

/**
 * The props for the animated flowpath layer, or null when there is nothing to draw.
 *
 * Returns plain props rather than a PathLayer, and lives apart from the map component, so the
 * update-trigger behaviour can be asserted without maplibre, deck.gl, or a canvas.
 */
export function flowPathLayerProps({
  visible,
  valuesByVar,
  timesArr,
  variable,
  bounds,
  pathData,
  currentTimeIndex,
  pathTick,
}) {
  const numTimes = timesArr?.length || 0;
  if (!valuesByVar || !numTimes || !pathData?.length) return null;

  const frame = visible ? currentTimeIndex : HIDDEN;
  return {
    id: 'flowpaths-anim',
    data: pathData,
    // Toggled, not removed: deck.gl keeps a hidden layer's GPU resources.
    visible,
    getPath: (d) => d.path,
    getColor: (d, { target }) => {
      const v = getValueAtTimeFlat(valuesByVar, numTimes, d.featureIndex, currentTimeIndex);
      return writeColorInto(v, bounds, target);
    },
    getWidth: (d) => {
      const v = getValueAtTimeFlat(valuesByVar, numTimes, d.featureIndex, currentTimeIndex);
      if (v === null || v <= -9998) return 2;
      const t = Math.max(0, Math.min(1, (v - bounds.min) / (bounds.max - bounds.min)));
      return 3 + t * 8;
    },
    widthUnits: 'pixels',
    widthMinPixels: 2,
    widthMaxPixels: 12,
    capRounded: true,
    jointRounded: true,
    pickable: false,
    updateTriggers: {
      getColor: [frame, variable, pathTick],
      getWidth: [frame, variable, pathTick],
    },
  };
}
