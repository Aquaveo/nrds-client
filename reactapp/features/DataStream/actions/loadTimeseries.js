import { getTimeseries } from 'features/DataStream/lib/queryData';
import { makeTitle } from 'features/DataStream/lib/utils';
import { createSequence } from 'features/DataStream/lib/sequence';
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
const series = createSequence();

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

  // A vpu load is rebuilding this table; its closing call charts whatever is selected then.
  if (vpuGeneration === undefined && vpuLoadInFlight()) return;

  const generation = vpuGeneration ?? currentVpuGeneration();
  const { cache_key: cacheKey, forecast, variables } = useDataStreamStore.getState();
  const requestedVariable = variable || state.variable || variables[0];
  const requestKey = `${cacheKey}|${requestedVariable}|${targetId}`;
  // This exact series is already charted, so there is nothing to fetch.
  if (requestKey === state.last_loaded_key) return;

  const ticket = series.next();
  // Superseded by a newer series load, or by a vpu load that replaced the table underneath.
  const superseded = () => !series.isCurrent(ticket) || generation !== currentVpuGeneration();
  const id = targetId.split('-')[1];
  store.getState().reset_series();
  beginLoading();
  store.setState({ loadingText: 'Loading feature properties...', last_error: null });
  try {
    const rows = await getTimeseries(id, cacheKey, requestedVariable);
    if (superseded()) return;
    const points = rows.map((d) => ({ x: new Date(d.time), y: d[requestedVariable] }));
    store.getState().set_series(points);
    store.getState().set_layout({
      yaxis: requestedVariable,
      xaxis: '',
      title: makeTitle(forecast, targetId),
    });
    // Say when a load found nothing; the chart's empty state cannot distinguish that.
    store.setState({
      last_loaded_key: requestKey,
      loadingText: points.length ? '' : `No ${requestedVariable} data for ${targetId}`,
      last_error: null,
    });
  } catch (err) {
    if (superseded()) return;
    store.setState({
      loadingText: `Failed to load timeseries for id: ${targetId}`,
      last_error: { kind: 'timeseries', featureId: targetId, variable: requestedVariable },
    });
    console.error('Failed to load timeseries for', targetId, err);
  } finally {
    endLoading();
  }
}
