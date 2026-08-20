import React, { useEffect, useCallback, useRef, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { useShallow } from 'zustand/react/shallow';
import maplibregl from 'maplibre-gl';
import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer } from "@deck.gl/layers";
import Map, { Source, useControl } from 'react-map-gl/maplibre';
import { Protocol } from 'pmtiles';
import useTimeSeriesStore from '../../store/Timeseries';
import { loadTimeseries } from '../../actions/loadTimeseries';
import useDataStreamStore from '../../store/Datastream';
import { useVPUStore } from '../../store/Layers';
import { useLayersStore, useFeatureStore } from '../../store/Layers';
import CustomPopUp from './Popup';
import { 
  dividesOutlineColor, 
  dividesHighlightFillColor, 
  dividesHighlightOutlineColor, 
  flowpathsLineColor, 
  gaugesCircleColor, 
  nexusCircleColor, 
  nexusStrokeColor, 
  nexusHighlightCircleColor,
  reorderLayers, 
  computeBounds, 
  convertFeaturesToPaths, 
} from '../../lib/layers';
import { layerIdToFeatureType } from '../../lib/utils';
import { getCentroid, flowpathsSignature, mapStyleUrl } from '../../lib/layers';
import { flowPathLayerProps } from './flowPathLayer';

import {
  useCatchmentLayers,
  useFlowPathsLayer,
  useConusGaugesLayer,
  useNexusLayers,
} from './MapLayers';


function DeckGLOverlay(props) {
  const overlay = useControl(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

const NO_LAYERS = [];

/**
 * The flowpath animation, isolated so that stepping through time re-renders only this.
 *
 * currentTimeIndex advances on an interval while playing. Reading it in MainMap re-ran that
 * whole component every frame, including a getComputedStyle call and every hook in it. The
 * frame index is read here instead, and nothing above this needs to re-render to animate.
 */
const FlowPathsOverlay = React.memo(function FlowPathsOverlay({
  visible,
  valuesByVar,
  timesArr,
  variable,
  pathDataRef,
  pathTick,
}) {
  const currentTimeIndex = useTimeSeriesStore((s) => s.currentTimeIndex);

  // Bounds describe the data, not the frame: about 9 ms per frame at 20k flowpaths.
  const bounds = useMemo(
    () => (valuesByVar ? computeBounds(valuesByVar) : null),
    [valuesByVar]
  );

  const layers = useMemo(() => {
    const props = flowPathLayerProps({
      visible,
      valuesByVar,
      timesArr,
      variable,
      bounds,
      pathData: pathDataRef.current,
      currentTimeIndex,
      pathTick,
    });
    return props ? [new PathLayer(props)] : NO_LAYERS;
  }, [visible, valuesByVar, bounds, variable, timesArr, currentTimeIndex, pathTick, pathDataRef]);

  return <DeckGLOverlay layers={layers} interleaved />;
});

FlowPathsOverlay.propTypes = {
  visible: PropTypes.bool,
  valuesByVar: PropTypes.object,
  timesArr: PropTypes.array,
  variable: PropTypes.string,
  pathDataRef: PropTypes.shape({ current: PropTypes.array }).isRequired,
  pathTick: PropTypes.number,
};

const MainMap = () => {
  const { 
    isNexusVisible, 
    isCatchmentsVisible, 
    isFlowPathsVisible, 
    isConusGaugesVisible, 
    enabledHovering 
  } = useLayersStore(
    useShallow((s) => ({
      isNexusVisible: s.nexus.visible,
      isCatchmentsVisible: s.catchments.visible,
      isFlowPathsVisible: s.flowpaths.visible,
      isConusGaugesVisible: s.conus_gauges.visible,
      enabledHovering: s.hovered_enabled,
    }))
  );
  const selectedFeatureId = useTimeSeriesStore((s) => s.feature_id);


  const {
    nexus_pmtiles,
    conus_pmtiles,
    vpu,
    set_vpu,
  } = useDataStreamStore(
    useShallow((s) => ({
      nexus_pmtiles: s.nexus_pmtiles,
      conus_pmtiles: s.community_pmtiles,
      vpu: s.vpu,
      set_vpu: s.set_vpu,
    }))
  );

  const { set_hovered_feature, set_selected_feature, selectedMapFeature, hovered_feature } = useFeatureStore(
    useShallow((s) => ({
      set_hovered_feature: s.set_hovered_feature,
      set_selected_feature: s.set_selected_feature,
      selectedMapFeature: s.selected_feature,
      hovered_feature: s.hovered_feature,
    }))
  );


  const variable = useTimeSeriesStore((s) => s.variable);

  const { featureIdToIndex, timesArr, valuesByVar } = useVPUStore(
    useShallow((s) => ({
      featureIdToIndex: s.featureIdToIndex,
      timesArr: s.times,
      valuesByVar: s.valuesByVar?.[variable],
    }))
  );


  const mapRef = useRef(null);
  const hoverMapRef = useRef(null);
  const lastSigRef = useRef("");
  const pathDataRef = useRef([]);

  const [pathTick, setPathTick] = useState(0);



  const hoverLayers = useMemo(() => ["divides", "nexus-points"], []);

  const isMapUsable = useCallback((map) => {
    if (!map || typeof map.on !== "function" || typeof map.off !== "function") return false;
    if (typeof map.getCanvas !== "function") return false;
    try {
      return !!map.getCanvas();
    } catch {
      return false;
    }
  }, []);

  const setPointerCursor = useCallback((e) => {
    const canvas = e?.target?.getCanvas?.();
    if (canvas?.style) canvas.style.cursor = "pointer";
  }, []);

  const resetPointerCursor = useCallback((e) => {
    const canvas = e?.target?.getCanvas?.();
    if (canvas?.style) canvas.style.cursor = "";
  }, []);

  const removeHoverListeners = useCallback((map) => {
    if (!isMapUsable(map)) return;
    hoverLayers.forEach((layer) => {
      map.off("mouseenter", layer, setPointerCursor);
      map.off("mouseleave", layer, resetPointerCursor);
    });
  }, [hoverLayers, isMapUsable, setPointerCursor, resetPointerCursor]);

  const handleMapLoad = useCallback((event) => {
    const map = event.target;
    if (!isMapUsable(map)) return;

    if (hoverMapRef.current && hoverMapRef.current !== map) {
      removeHoverListeners(hoverMapRef.current);
    }

    // De-dupe in case onLoad fires multiple times for the same map instance.
    removeHoverListeners(map);
    hoverLayers.forEach((layer) => {
      map.on("mouseenter", layer, setPointerCursor);
      map.on("mouseleave", layer, resetPointerCursor);
    });
    hoverMapRef.current = map;

    reorderLayers(map);

  }, [hoverLayers, isMapUsable, removeHoverListeners, resetPointerCursor, setPointerCursor]);

  useEffect(() => {
    return () => {
      removeHoverListeners(hoverMapRef.current);
      hoverMapRef.current = null;
    };
  }, [removeHoverListeners]);

  const onHover = useCallback((event) => {
    if (!enabledHovering) return;

    const { features, lngLat } = event;

    const prev = useFeatureStore.getState().hovered_feature;

    if (!features?.length) {
      if (prev !== null) set_hovered_feature(null);
      return;
    }

    const feature = features[0];
    const layerId = feature.layer.id;

    const hoverId =
      layerId === "divides"
        ? feature.properties?.divide_id
        : feature.properties?.id;

    if (!hoverId) {
      if (prev !== null) set_hovered_feature(null);
      return;
    }

    if (prev?.hoverId === hoverId) return;

    const next = {
      ...feature.properties,
      hoverId,
      longitude: lngLat.lng,
      latitude: lngLat.lat,
    };

    set_hovered_feature(next);
  }, [enabledHovering, set_hovered_feature]);


  const catchmentLayer = useCatchmentLayers({
    isCatchmentsVisible,
    selectedFeatureId,
    dividesOutlineColor,
    dividesHighlightFillColor,
    dividesHighlightOutlineColor,
  });

  const flowPathsLayer = useFlowPathsLayer({
    isFlowPathsVisible,
    flowpathsLineColor,
  });

  const conusGaugesLayer = useConusGaugesLayer({
    isConusGaugesVisible,
    gaugesCircleColor,
  });

  const nexusLayers = useNexusLayers({
    isNexusVisible,
    selectedFeatureId,
    nexusCircleColor,
    nexusStrokeColor,
    nexusHighlightCircleColor,
  });

  useEffect(() => {
    const protocol = new Protocol({ metadata: true });
    maplibregl.addProtocol('pmtiles', protocol.tile);

    const map = mapRef.current && mapRef.current.getMap ? mapRef.current.getMap() : mapRef.current;
    if (!map) return;

    return () => {
      maplibregl.removeProtocol('pmtiles');
    };
  }, []);

  useEffect(() => {
    const map =
      mapRef.current && mapRef.current.getMap
        ? mapRef.current.getMap()
        : mapRef.current;

    if (!map) return;

    reorderLayers(map);
  }, [isNexusVisible, isCatchmentsVisible, isFlowPathsVisible, isConusGaugesVisible]);

 
  useEffect(() => {
    const map = mapRef.current?.getMap?.() ?? mapRef.current;
    if (!map) return;

    const hasIndex = featureIdToIndex && Object.keys(featureIdToIndex).length > 0;
    if (!hasIndex) return;

    let raf = null;

    const run = () => {
      if (raf) cancelAnimationFrame(raf);

      raf = requestAnimationFrame(() => {
        if (!isFlowPathsVisible) return;

        const feats = map.queryRenderedFeatures({ layers: ["flowpaths"] });

        const matched = feats.filter(
          (f) => featureIdToIndex[f.properties?.id] !== undefined
        );

        const sig = flowpathsSignature(matched);
        if (sig === lastSigRef.current) {
          raf = null;
          return;
        }
        lastSigRef.current = sig;

        pathDataRef.current = convertFeaturesToPaths(matched, featureIdToIndex);
        setPathTick((t) => t + 1);

        raf = null;
      });
    };

    map.once("idle", run);
    map.on("moveend", run);
    map.on("zoomend", run);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      map.off("moveend", run);
      map.off("zoomend", run);
    };
  }, [featureIdToIndex, isFlowPathsVisible]);


  useEffect(() => {
    if (!selectedMapFeature) return;

    const map =
      mapRef.current && mapRef.current.getMap
        ? mapRef.current.getMap()
        : mapRef.current;

    if (!map) return;

    const lat = selectedMapFeature.lat || selectedMapFeature.latitude;
    const lon = selectedMapFeature.lon || selectedMapFeature.longitude;
    map.flyTo({
      center: [lon, lat],
      zoom: 11,
      essential: true,
    });
  }, [selectedMapFeature]);


  const layersToQuery = useMemo(() => {
    const layers = [];
    if (isNexusVisible) layers.push('nexus-points');
    if (isCatchmentsVisible) layers.push('divides');
    return layers;
  }, [isNexusVisible, isCatchmentsVisible]);

  const handleMapClick = async (event) => {
    // Deliberately unguarded by loading: a newer load supersedes an older one.
    const map = event.target;

    if (layersToQuery.length === 0) return;

    const features = map.queryRenderedFeatures(event.point, {
      layers: layersToQuery,
    });
    if (!features || !features.length) return;

    for (const feature of features) {
      const layerId = feature.layer.id;
      const featureIdProperty = layerIdToFeatureType(layerId);
      const unbiased_id = feature.properties[featureIdProperty];
 
      const {lon, lat} = getCentroid(feature);
      set_selected_feature({
        latitude: lat,
        longitude: lon,
        layerId: layerId,
        _id: unbiased_id,
        ...feature.properties,
      });
      const vpu_str = `VPU_${feature.properties.vpuid}`;
      if (vpu_str === vpu){
        loadTimeseries({ featureId: unbiased_id });
      }
      set_vpu(vpu_str);
      break;
    }
  };

  return (
    <Map
      ref={mapRef}
      initialViewState={{ longitude: -96, latitude: 40, zoom: 4 }}
      style={{ width: '100%', height: '100%' }}
      mapLib={maplibregl}
      mapStyle={mapStyleUrl}
      onClick={handleMapClick}
      onLoad={handleMapLoad}
      onMouseMove={onHover}
      interactiveLayerIds={['divides', 'nexus-points', 'flowpaths', 'conus-gauges']}
    >
      <Source key="conus" id="conus" type="vector" url={`pmtiles://${conus_pmtiles}`}>
        {catchmentLayer}
        {flowPathsLayer}
        {conusGaugesLayer}
      </Source>

      <Source key="nexus" id="nexus" type="vector" url={`pmtiles://${nexus_pmtiles}`}>
        {nexusLayers}
      </Source>
      <FlowPathsOverlay
        visible={isFlowPathsVisible}
        valuesByVar={valuesByVar}
        timesArr={timesArr}
        variable={variable}
        pathDataRef={pathDataRef}
        pathTick={pathTick}
      />
      <CustomPopUp hovered_feature={hovered_feature} enabledHovering={enabledHovering} />
    </Map>
  );
};


const MapComponent = React.memo(MainMap);

export default MapComponent;
