import { create } from 'zustand';

export const useLayersStore = create((set) => ({
    nexus: {
        visible: false,
    },
    catchments: {
        visible: true,
    },
    flowpaths: {
        visible: true
    },
    conus_gauges: {
        visible: false
    },
    colorBounds: {
        flow: { min: 0, max: 100 },
        velocity: { min: 0, max: 5 },
        depth: { min: 0, max: 3 },
    },
    hovered_enabled: false,
    set_hovered_enabled: (isEnabled) => set({ hovered_enabled: isEnabled }),
    get_nexus_visibility: () => get().nexus.visible,
    get_catchments_visibility: () => get().catchments.visible,
    set_nexus_visibility: (isVisible) => set((state) => ({
        nexus: {
            ...state.nexus,
            visible: isVisible,
        },
    })),
    set_catchments_visibility: (isVisible) => set((state) => ({
        catchments: {
            ...state.catchments,
            visible: isVisible,
        },
    })),
    set_flowpaths_visibility: (isVisible) => set((state) => ({
        flowpaths: {
            ...state.flowpaths,
            visible: isVisible
        }
    })),
    set_conus_gauges_visibility: (isVisible) => set((state) => ({
        conus_gauges: {
            ...state.conus_gauges,
            visible: isVisible
        }
    }))
}));


export const useFeatureStore = create((set) => ({
    hovered_feature: null,
    selected_feature: null,
    
    set_selected_feature: (feature) =>
        set(() => ({
            selected_feature: feature,
        })),
    set_hovered_feature: (feature) =>
        set(() => ({
            hovered_feature: feature,
        })),
}));

const sameArray = (a, b) =>
  a === b || (a?.length === b?.length && a.every((v, i) => v === b[i]));

export const useVPUStore = create((set) => ({
  featureIds: [],
  featureIdToIndex: {},
  times: [],
  valuesByVar: {},
  set_feature_ids: (featureIds) => set({ featureIds }),
  setAnimationIndex: (featureIds, times) =>
    set((s) => {
      if (sameArray(s.featureIds, featureIds) && sameArray(s.times, times)) return s;

      const featureIdToIndex = {};
      featureIds.forEach((id, idx) => {
        featureIdToIndex[id] = idx;
        featureIdToIndex[`wb-${id}`] = idx;
      });

      return { featureIds, times, featureIdToIndex };
    }),

  setVarData: (variable, flatValues) =>
    set((s) => {
      if (s.valuesByVar?.[variable] === flatValues) return s; // same ref => no update
      return { valuesByVar: { ...s.valuesByVar, [variable]: flatValues } };
    }),
}));