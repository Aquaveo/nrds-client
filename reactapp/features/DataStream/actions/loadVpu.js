import {
  checkForTable,
  loadVpuData,
  getFeatureIDs,
  getVariables,
  getDistinctFeatureIds,
  getDistinctTimes,
  getVpuVariableFlat,
} from 'features/DataStream/lib/queryData';
import useDataStreamStore from 'features/DataStream/store/Datastream';
import useTimeSeriesStore from 'features/DataStream/store/Timeseries';
import { loadTimeseries } from 'features/DataStream/actions/loadTimeseries';
import useS3DataStreamBucketStore from 'features/DataStream/store/s3Store';
import { useVPUStore, useFeatureStore } from 'features/DataStream/store/Layers';
import { useCacheTablesStore } from 'features/DataStream/store/CacheTables';

// Only the newest request may write. This replaces the alive flag the effect closed over.
let latestRequest = 0;

/**
 * Bring the currently selected vpu's data into the stores, then chart the selected feature.
 *
 * This was an effect keyed on cache_key, which meant re-requesting the same vpu after a
 * failure changed no state and so could not re-run: the fix at the time was a request
 * counter whose only job was to make a repeat visible to a dependency array. Pressing
 * visualize is an event, and so is picking a vpu on the map, so both call this instead and a
 * repeat call is simply a repeat.
 *
 * It lives outside the stores because it spans six of them. Reading each with getState at
 * the point of use also means late steps see current state rather than whatever a render
 * closure captured when the load began.
 */
export async function loadVpu() {
  const { cache_key: cacheKey, vpu, set_variables } = useDataStreamStore.getState();
  if (!cacheKey) return;

  const requestId = ++latestRequest;
  const superseded = () => requestId !== latestRequest;
  const timeseries = useTimeSeriesStore.getState();

  timeseries.reset();
  useVPUStore.getState().resetVPU();
  timeseries.set_loading(true);
  timeseries.set_loading_text('Loading feature properties...');

  try {
    const tableExists = await checkForTable(cacheKey);
    if (superseded()) return;

    if (!tableExists) {
      try {
        const { prefix } = useS3DataStreamBucketStore.getState();
        const fileSize = await loadVpuData(cacheKey, prefix);
        if (superseded()) return;
        useCacheTablesStore.getState().add_cacheTable({
          id: cacheKey,
          name: cacheKey.replaceAll('_', ' '),
          size: fileSize,
        });
      } catch (err) {
        if (superseded()) return;
        console.error('No data for VPU', vpu, err);
        timeseries.set_loading_text('No data available for selected VPU');
        return;
      }
    }

    const featureIDs = await getFeatureIDs(cacheKey);
    if (superseded()) return;
    useVPUStore.getState().set_feature_ids(featureIDs);

    const variables = await getVariables({ cacheKey });
    if (superseded()) return;
    set_variables(variables);
    timeseries.set_variable(variables[0]);
    const currentVariable = variables[0];

    const [featureIds, times, flat] = await Promise.all([
      getDistinctFeatureIds(cacheKey),
      getDistinctTimes(cacheKey),
      getVpuVariableFlat(cacheKey, currentVariable),
    ]);
    if (superseded()) return;
    useVPUStore.getState().setAnimationIndex(featureIds, times);
    useVPUStore.getState().setVarData(currentVariable, flat);

    // Read at the point of use: the selection can have moved on while the vpu was loading.
    const { selected_feature } = useFeatureStore.getState();
    await loadTimeseries({ featureId: selected_feature?._id ?? null });
    if (superseded()) return;

    timeseries.set_loading_text('');
  } catch (err) {
    if (superseded()) return;
    timeseries.set_loading_text(`Failed to load VPU data for cacheKey: ${cacheKey}`);
    console.error('Failed to load VPU data for cacheKey:', cacheKey, err);
  } finally {
    // A plain if: returning from finally would discard a propagating exception.
    if (!superseded()) timeseries.set_loading(false);
  }
}
