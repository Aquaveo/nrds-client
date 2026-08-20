import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { getTimeseries } from 'features/DataStream/lib/queryData';
import { makeTitle } from 'features/DataStream/lib/utils';
import useDataStreamStore from 'features/DataStream/store/Datastream';

// Only the newest load may write to the store. Selecting a feature used to set state that an
// effect watched, which meant a counter to make repeat selections visible and a per-effect
// alive flag to drop superseded work. Selecting is an event, so it calls an action directly
// and this is the whole of the bookkeeping that replaced both.
let latestRequest = 0;

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const EMPTY_SERIES = [];
const DEFAULT_LAYOUT = Object.freeze({
  yaxis: 'Streamflow',
  xaxis: 'Simulation Time Period (YYYY-MM-DD)',
  title: 'TimeSeries',
});

function seriesFingerprint(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 'empty';
  const first = arr[0];
  const last = arr[arr.length - 1];
  const fx = first?.x instanceof Date ? first.x.getTime() : first?.x;
  const lx = last?.x instanceof Date ? last.x.getTime() : last?.x;
  return `${arr.length}|${fx}|${first?.y}|${lx}|${last?.y}`;
}

const useTimeSeriesStore = create(
  subscribeWithSelector((set, get ) => ({
      series: EMPTY_SERIES,
      feature_id: null,
      variable: '',
      layout: DEFAULT_LAYOUT,
      
      loading: false,
      loadingText: '' ,
      // Identifies whose data `series` currently holds, as vpu|variable|feature. A repeat
      // click on that same combination has nothing to fetch. Null means nothing is loaded,
      // so a failed or cleared load is always retried.
      last_loaded_key: null,
      currentTimeIndex: 0,

      isPlaying: false,
      playSpeed: 10,       
      baseFrameMs: 2500,   
      set_series: (nextSeries) => {
        set((s) => {
          const prev = s.series;

          // same ref => no update
          if (prev === nextSeries) return s;

          // both empty => no update (this is the one your screenshot screams about)
          const prevEmpty = !prev || prev.length === 0;
          const nextEmpty = !nextSeries || nextSeries.length === 0;
          if (prevEmpty && nextEmpty) return s;

          // "equal by value" guard (cheap)
          if (seriesFingerprint(prev) === seriesFingerprint(nextSeries)) return s;

          // A shorter series can leave the playback index past the end. Clamping here means
          // no component has to notice afterwards and correct it in an effect.
          const maxIdx = Math.max(0, (nextSeries?.length || 0) - 1);
          if (s.currentTimeIndex > maxIdx) {
            return { series: nextSeries, currentTimeIndex: maxIdx };
          }
          return { series: nextSeries };
        });
      },
      set_layout: (next) =>
        set((s) => {
          const prev = s.layout;
          if (
            prev?.title === next?.title &&
            prev?.xaxis === next?.xaxis &&
            prev?.yaxis === next?.yaxis
          ) {
            return s;
          }
          return { layout: next };
        }),    
      setCurrentTimeIndex: (idx) => {
        set((s) => {
          const maxIdx = Math.max(0, (s.series?.length || 0) - 1);
          const next = clamp(Number(idx) || 0, 0, maxIdx);
          if (next === s.currentTimeIndex) return s;   // IMPORTANT
          return { currentTimeIndex: next };
        });
      },

      setPlaySpeed: (speed) => {
        const s = clamp(Number(speed) || 1, 1, 20);
        set({ playSpeed: s });
      },

      toggleIsPlaying: () => set((s) => ({ isPlaying: !s.isPlaying })),

      // --- stepping used by back/forward buttons + autoplay ---
      stepForward: () => {
        const { series, currentTimeIndex } = get();
        const maxIdx = series.length - 1;
        if (maxIdx < 0) return;
        set({ currentTimeIndex: (currentTimeIndex + 1) % (maxIdx + 1) });
      },

      stepBackward: () => {
        const { series, currentTimeIndex } = get();
        const maxIdx = series.length - 1;
        if (maxIdx < 0) return;
        set({ currentTimeIndex: currentTimeIndex === 0 ? maxIdx : currentTimeIndex - 1 });
      },

      // returns "T+Nh" assuming 1-hour timesteps;
      getCurrentTimeLabel: () => {
        const { series, currentTimeIndex } = get();
        const t0 = series?.[0]?.time;
        const t = series?.[currentTimeIndex]?.time;
        if (typeof t0 !== "number" || typeof t !== "number") return "T+0h";
        const hours = Math.round((t - t0) / 3600000); // ms -> hours
        return `T+${hours}h`;
      },
      set_loading: (isLoading) => set({ loading: isLoading }),
      set_loading_text: (newLoadingText) => set({ loadingText: newLoadingText }),
      /**
       * Load and chart the series for one feature.
       *
       * Called straight from the map click, the search box, the variable menu, and the end of
       * a vpu load, rather than by an effect watching feature_id. A repeat call is a retry, so
       * a failed load needs no special path, and the guard below means clicking the feature
       * already on screen costs nothing.
       *
       * ``variable`` is only used for this request; the caller owns the store's variable, so
       * the flowpath layer is not left looking up data that has not arrived yet.
       */
      loadTimeseries: async ({ featureId, variable } = {}) => {
        const state = get();
        const targetId = featureId ?? state.feature_id;
        if (!targetId) return;
        if (targetId !== state.feature_id) set({ feature_id: targetId });

        const { cache_key: cacheKey, forecast, variables } = useDataStreamStore.getState();
        const requestedVariable = variable || state.variable || variables[0];
        const requestKey = `${cacheKey}|${requestedVariable}|${targetId}`;
        // This exact series is already charted, so there is nothing to fetch.
        if (requestKey === state.last_loaded_key) return;

        const requestId = ++latestRequest;
        const id = targetId.split('-')[1];
        get().reset_series();
        set({ loading: true, loadingText: 'Loading feature properties...' });
        try {
          const rows = await getTimeseries(id, cacheKey, requestedVariable);
          if (requestId !== latestRequest) return;
          get().set_series(rows.map((d) => ({ x: new Date(d.time), y: d[requestedVariable] })));
          get().set_layout({
            yaxis: requestedVariable,
            xaxis: '',
            title: makeTitle(forecast, targetId),
          });
          set({ last_loaded_key: requestKey, loadingText: '' });
        } catch (err) {
          if (requestId !== latestRequest) return;
          set({ loadingText: `Failed to load timeseries for id: ${targetId}` });
          console.error('Failed to load timeseries for', targetId, err);
        } finally {
          if (requestId === latestRequest) set({ loading: false });
        }
      },
      set_last_loaded_key: (key) => set({ last_loaded_key: key }),
      
      set_chart_layout: (newLayout) => set({ chart_layout: newLayout }),
      set_variable: (newVariable) => set({ variable: newVariable }),
      reset_series: () =>
        set((s) => {
          if (
            s.series === EMPTY_SERIES &&
            s.currentTimeIndex === 0 &&
            s.isPlaying === false &&
            s.last_loaded_key === null
          ) {
            return s;
          }
          return { series: EMPTY_SERIES, currentTimeIndex: 0, isPlaying: false, last_loaded_key: null };
        }),

      reset: () =>
        set((s) => ({
          ...s,
          series: EMPTY_SERIES,
          feature_id: null,
          variable: '',
          layout: DEFAULT_LAYOUT,
          currentTimeIndex: 0,
          isPlaying: false,
          last_loaded_key: null,
        })),
  }))
);
export default useTimeSeriesStore;