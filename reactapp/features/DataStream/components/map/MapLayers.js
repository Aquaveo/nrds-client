// mapLayers.js
import React, { useMemo } from 'react';
import { Layer } from 'react-map-gl/maplibre';
import { FLOWPATHS_LAYER_ID } from 'features/DataStream/lib/layers';

/**
 * Catchment (divides) layers
 */
export function useCatchmentLayers({
  isCatchmentsVisible,
  selectedFeatureId,
  dividesOutlineColor,
  dividesHighlightFillColor,
  dividesHighlightOutlineColor,
}) {
  return useMemo(() => {
    if (!isCatchmentsVisible) return null;

    const divides = (
      <Layer
        key="divides"
        id="divides"
        type="fill"
        source="hydrofabric"
        source-layer="conus_divides"
        paint={{
          'fill-color': ['rgba', 0, 0, 0, 0],
          'fill-outline-color': dividesOutlineColor,
          'fill-opacity': { stops: [[7, 0], [11, 1]] },
        }}
      />
    );

    const highlighted = (
      <Layer
        key="divides-highlight"
        id="divides-highlight"
        type="fill"
        source="hydrofabric"
        source-layer="conus_divides"
        beforeId="divides"
        filter={
          selectedFeatureId
            ? ['any', ['==', ['get', 'divide_id'], selectedFeatureId]]
            : ['==', ['get', 'divide_id'], '']
        }
        paint={{
          'fill-color': dividesHighlightFillColor,
          'fill-outline-color': dividesHighlightOutlineColor,
          'fill-opacity': { stops: [[7, 0], [11, 1]] },
        }}
      />
    );

    return [divides, highlighted];
  }, [
    isCatchmentsVisible,
    selectedFeatureId,
    dividesOutlineColor,
    dividesHighlightFillColor,
    dividesHighlightOutlineColor,
  ]);
}

/**
 * Flowpaths layer.
 *
 * Drawn from its own archive rather than from merged.pmtiles, which carries flowpaths only from
 * zoom 7 up. upstream_index/flowpaths.pmtiles carries them from zoom 1, which is what lets the
 * deck.gl animation draw over a wide view: its geometry is read back out of this layer with
 * queryRenderedFeatures, so wherever this renders, the animation can follow.
 *
 * Nothing clicks or hovers flowpaths, so the properties this archive drops (vpuid, divide_id,
 * lengthkm) cost nothing. Its numeric MVT feature ids match the value array through
 * buildFeatureIdToIndex, which registers both the bare id and the wb- form.
 *
 * The ramps stay modest at low zoom: every available reach across CONUS at once is a lot of
 * ink, and the animation's own colour is what should carry there.
 */
export function useFlowPathsLayer({ isFlowPathsVisible, flowpathsLineColor }) {
  return useMemo(() => {
    if (!isFlowPathsVisible) return null;

    return (
      <Layer
        key={FLOWPATHS_LAYER_ID}
        id={FLOWPATHS_LAYER_ID}
        type="line"
        source="flowpath-geometry"
        source-layer="flowpaths"
        paint={{
          'line-color': flowpathsLineColor,
          'line-width': { stops: [[2, 0.6], [7, 1], [10, 2]] },
          'line-opacity': { stops: [[2, 0.45], [7, 0.7], [10, 1]] },
        }}
      />
    );
  }, [isFlowPathsVisible, flowpathsLineColor]);
}

/**
 * CONUS gauges layer
 */
export function useConusGaugesLayer({
  isConusGaugesVisible,
  gaugesCircleColor,
}) {
  return useMemo(() => {
    if (!isConusGaugesVisible) return null;

    return (
      <Layer
        key="conus-gauges"
        id="conus-gauges"
        type="circle"
        source="hydrofabric"
        source-layer="conus_gages"
        paint={{
          'circle-radius': { stops: [[3, 2], [11, 5]] },
          'circle-color': gaugesCircleColor,
          'circle-opacity': { stops: [[3, 0], [9, 1]] },
        }}
      />
    );
  }, [isConusGaugesVisible, gaugesCircleColor]);
}

/**
 * Nexus point + highlight layers
 */
export function useNexusLayers({
  isNexusVisible,
  selectedFeatureId,
  nexusCircleColor,
  nexusStrokeColor,
  nexusHighlightCircleColor,
}) {
  return useMemo(() => {
    if (!isNexusVisible) return null;

    const pointsLayer = (
      <Layer
        key="nexus-points"
        id="nexus-points"
        type="circle"
        source="nexus"
        source-layer="nexus"
        filter={['!', ['has', 'point_count']]} // do not show the clusters
        minzoom={5}
        paint={{
          'circle-radius': 7,
          'circle-color': nexusCircleColor,
          'circle-stroke-width': 1,
          'circle-stroke-color': nexusStrokeColor,
        }}
      />
    );

    const nexusHighlightLayer = (
      <Layer
        key="nexus-highlight"
        id="nexus-highlight"
        type="circle"
        source="nexus"
        source-layer="nexus"
        minzoom={5}
        beforeId="nexus-points"
        filter={
          selectedFeatureId
            ? [
                'all',
                ['!', ['has', 'point_count']],
                ['==', ['get', 'id'], selectedFeatureId],
              ]
            : ['boolean', false]
        }
        paint={{
          'circle-radius': 10,
          'circle-stroke-width': 3,
          'circle-stroke-color': nexusStrokeColor,
          'circle-color': nexusHighlightCircleColor,
        }}
      />
    );

    return [pointsLayer, nexusHighlightLayer];
  }, [
    isNexusVisible,
    selectedFeatureId,
    nexusCircleColor,
    nexusStrokeColor,
    nexusHighlightCircleColor,
  ]);
}
