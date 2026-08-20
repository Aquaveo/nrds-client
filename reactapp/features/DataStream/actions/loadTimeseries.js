import { getTimeseries } from 'features/DataStream/lib/queryData';
import { makeTitle } from 'features/DataStream/lib/utils';
import useDataStreamStore from 'features/DataStream/store/Datastream';
import useTimeSeriesStore from 'features/DataStream/store/Timeseries';
import {
  beginLoading,
  currentVpuGeneration,
  endLoading,
  vpuLoadInFlight,
} from 'features/DataStream/actions/loadState';

// Orders series loads against each other. Ordering against a vpu load is a separate
// question, answered by the shared vpu generation in loadState.
let latestRequest = 0;

/**
 * Load and chart the series for one feature.
 *
 * Called straight from the map click, the search box, the variable menu, and the end of a vpu
 * load. A repeat call is a retry, so a failed load needs no special path, and the guard below
 * means asking for the feature already on screen costs nothing.
 *
 * ``variable`` applies to this request only. The caller owns the store's variable, so the
 * flowpath layer is never left looking up data that has not arrived yet.
 *
 * Kept out of the store so that importing the store does not drag in duckdb and arrow: every
 * component reading a timeseries value would otherwise pull the whole query layer with it.
 */
export async function loadTimeseries({ featureId, variable, vpuGeneration } = {}) {
  const store = useTimeSeriesStore;
  const state = store.getState();
  const targetId = featureId ?? store.getState().feature_id;
  if (!targetId) return;
  if (targetId !== state.feature_id) store.setState({ feature_id: targetId });

  // A vpu load is rebuilding the table this would read, so record the selection and leave the
  // fetching to that load's own closing call, which reads the selection when it gets there.
  if (vpuGeneration === undefined && vpuLoadInFlight()) return;

  const generation = vpuGeneration ?? currentVpuGeneration();
  const { cache_key: cacheKey, forecast, variables } = useDataStreamStore.getState();
  const requestedVariable = variable || state.variable || variables[0];
  const requestKey = `${cacheKey}|${requestedVariable}|${targetId}`;
  // This exact series is already charted, so there is nothing to fetch.
  if (requestKey === state.last_loaded_key) return;

  const requestId = ++latestRequest;
  // Superseded by a newer series load, or by a vpu load that replaced the table underneath.
  const superseded = () => requestId !== latestRequest || generation !== currentVpuGeneration();
  const id = targetId.split('-')[1];
  store.getState().reset_series();
  beginLoading();
  store.setState({ loadingText: 'Loading feature properties...' });
  try {
    const rows = await getTimeseries(id, cacheKey, requestedVariable);
    if (superseded()) return;
    store.getState().set_series(rows.map((d) => ({ x: new Date(d.time), y: d[requestedVariable] })));
    store.getState().set_layout({
      yaxis: requestedVariable,
      xaxis: '',
      title: makeTitle(forecast, targetId),
    });
    store.setState({ last_loaded_key: requestKey, loadingText: '' });
  } catch (err) {
    if (superseded()) return;
    store.setState({ loadingText: `Failed to load timeseries for id: ${targetId}` });
    console.error('Failed to load timeseries for', targetId, err);
  } finally {
    endLoading();
  }
}
