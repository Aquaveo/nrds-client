/**
 * Deleting a cached file drops its duckdb table, and nothing outside the cache store knew it
 * had gone. Clicking a catchment in the same vpu went straight to getTimeseries and queried a
 * table that no longer existed, which surfaced as a raw catalog error:
 *
 *   Catalog Error: Table with name cfe_nom_..._VPU_16_troute_output_... does not exist!
 *
 * and after that nothing loaded at all. Two things guard it: the series load rebuilds the vpu
 * when the table is missing, and the delete forgets the state that was derived from it.
 */
jest.mock('features/DataStream/lib/queryData', () => ({
  checkForTable: jest.fn(),
  getTimeseries: jest.fn(),
  dropAllVpuDataTables: jest.fn(),
}));
jest.mock('features/DataStream/lib/opfsCache', () => ({
  deleteFileFromCache: jest.fn(),
  clearCache: jest.fn(),
  getFilesFromCache: jest.fn(),
  tableNameForKey: (key) => String(key).replace(/\.(arrow|parquet)$/i, ''),
}));
jest.mock('features/DataStream/lib/duckdbClient', () => ({ terminateDatabase: jest.fn() }));
jest.mock('features/DataStream/actions/loadVpu', () => ({ loadVpu: jest.fn() }));

const queryData = require('features/DataStream/lib/queryData');
const opfs = require('features/DataStream/lib/opfsCache');
const { loadVpu } = require('features/DataStream/actions/loadVpu');
const { loadTimeseries } = require('features/DataStream/actions/loadTimeseries');
const { useCacheTablesStore } = require('features/DataStream/store/CacheTables');
const useTimeSeriesStore = require('features/DataStream/store/Timeseries').default;
const useDataStreamStore = require('features/DataStream/store/Datastream').default;
const { useVPUStore } = require('features/DataStream/store/Layers');

const KEY = 'cfe_nom_ngen_20260819_short_range_00_VPU_16_troute_output.parquet';
const initial = {
  ts: useTimeSeriesStore.getState(),
  ds: useDataStreamStore.getState(),
  vpu: useVPUStore.getState(),
};

beforeEach(() => {
  useTimeSeriesStore.setState(initial.ts, true);
  useDataStreamStore.setState(initial.ds, true);
  useVPUStore.setState(initial.vpu, true);
  useCacheTablesStore.setState({ cacheTables: [{ id: KEY, name: KEY, size: '4.5 MB' }] });
  opfs.getFilesFromCache.mockResolvedValue([]);
  useDataStreamStore.setState({ cache_key: KEY, variables: ['flow'] });
  useTimeSeriesStore.setState({ feature_id: 'cat-2884494', variable: 'flow' });
  queryData.getTimeseries.mockResolvedValue([{ time: '2022-08-01T00:00:00Z', flow: 1 }]);
  require('features/DataStream/lib/duckdbClient').terminateDatabase.mockResolvedValue(undefined);
  opfs.deleteFileFromCache.mockResolvedValue(true);
});

describe('clicking a catchment after its cache was deleted', () => {
  test('rebuilds the vpu rather than querying a table that is gone', async () => {
    queryData.checkForTable.mockResolvedValue(false);

    await loadTimeseries({ featureId: 'cat-2884494' });

    expect(loadVpu).toHaveBeenCalledTimes(1);
    expect(queryData.getTimeseries).not.toHaveBeenCalled();
  });

  test('queries directly when the table is still registered', async () => {
    queryData.checkForTable.mockResolvedValue(true);

    await loadTimeseries({ featureId: 'cat-2884494' });

    expect(loadVpu).not.toHaveBeenCalled();
    expect(queryData.getTimeseries).toHaveBeenCalledWith('2884494', KEY, 'flow');
  });

  test('does not recurse: the call loadVpu makes goes straight to the query', async () => {
    // loadVpu creates the table before charting, and passes its generation to say so.
    queryData.checkForTable.mockResolvedValue(false);

    await loadTimeseries({ featureId: 'cat-2884494', vpuGeneration: 1 });

    expect(loadVpu).not.toHaveBeenCalled();
    expect(queryData.getTimeseries).toHaveBeenCalled();
  });

  test('clears last_loaded_key, so the same feature is not treated as already charted', async () => {
    queryData.checkForTable.mockResolvedValue(false);
    useTimeSeriesStore.setState({ last_loaded_key: `${KEY}|flow|cat-2884494` });

    await loadTimeseries({ featureId: 'cat-2884494' });

    expect(useTimeSeriesStore.getState().last_loaded_key).toBeNull();
  });
});

describe('clearing the cache forgets what was derived from it', () => {
  test('drops the animation arrays and the charted key', async () => {
    queryData.dropAllVpuDataTables.mockResolvedValue(undefined);
    opfs.clearCache.mockResolvedValue(undefined);
    useVPUStore.getState().setVarData('flow', Float32Array.from([1, 2, 3]));
    useTimeSeriesStore.setState({ last_loaded_key: `${KEY}|flow|cat-2884494` });

    await useCacheTablesStore.getState().clear();

    expect(useVPUStore.getState().valuesByVar?.flow).toBeUndefined();
    expect(useTimeSeriesStore.getState().last_loaded_key).toBeNull();
    expect(useCacheTablesStore.getState().cacheTables).toEqual([]);
  });

  test('a click after clearing rebuilds rather than erroring', async () => {
    queryData.dropAllVpuDataTables.mockResolvedValue(undefined);
    opfs.clearCache.mockResolvedValue(undefined);
    await useCacheTablesStore.getState().clear();

    queryData.checkForTable.mockResolvedValue(false);
    await loadTimeseries({ featureId: 'cat-2884494' });

    expect(loadVpu).toHaveBeenCalledTimes(1);
    expect(queryData.getTimeseries).not.toHaveBeenCalled();
  });
});
