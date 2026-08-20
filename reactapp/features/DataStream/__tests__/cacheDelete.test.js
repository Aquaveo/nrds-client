/**
 * Deleting one cached parquet confirmed success and the file was still there after a reload.
 *
 * Three things were wrong. duckdb registers each cached file with BROWSER_FSACCESS and holds a
 * sync access handle, so OPFS refused removeEntry with NoModificationAllowedError -- proven in
 * a browser, and fixed by dropping the file from duckdb first. The table was dropped by the id,
 * which still carries the .parquet the table name does not, so DROP TABLE IF EXISTS matched
 * nothing and said nothing. And the row was removed from the list either way, which is what
 * made a failed delete look like a successful one.
 */
jest.mock('features/DataStream/lib/opfsCache', () => ({
  deleteFileFromCache: jest.fn(),
  clearCache: jest.fn(),
  tableNameForKey: (key) => String(key).replace(/\.(arrow|parquet)$/i, ''),
}));
jest.mock('features/DataStream/lib/queryData', () => ({
  deleteTable: jest.fn(),
  dropAllVpuDataTables: jest.fn(),
}));
jest.mock('features/DataStream/lib/duckdbClient', () => ({ terminateDatabase: jest.fn() }));

const opfs = require('features/DataStream/lib/opfsCache');
const { deleteTable } = require('features/DataStream/lib/queryData');
const { useCacheTablesStore } = require('features/DataStream/store/CacheTables');
const useTimeSeriesStore = require('features/DataStream/store/Timeseries').default;

const KEY = 'cfe_nom_ngen_20260819_short_range_00_VPU_01_troute_output.parquet';
const initialTs = useTimeSeriesStore.getState();

beforeEach(() => {
  useCacheTablesStore.setState({ cacheTables: [{ id: KEY, name: KEY, size: '4.5 MB' }] });
  useTimeSeriesStore.setState(initialTs, true);
  opfs.deleteFileFromCache.mockResolvedValue(true);
  deleteTable.mockResolvedValue(undefined);
});

describe('deleting one cached file', () => {
  it('drops the table under the name it was actually created with', async () => {
    await useCacheTablesStore.getState().delete_cacheTable(KEY);

    // The id keeps the extension; the table never had it.
    expect(deleteTable).toHaveBeenCalledWith(KEY.replace('.parquet', ''));
  });

  it('removes the row once the file is really gone', async () => {
    const ok = await useCacheTablesStore.getState().delete_cacheTable(KEY);

    expect(ok).toBe(true);
    expect(opfs.deleteFileFromCache).toHaveBeenCalledWith(KEY);
    expect(useCacheTablesStore.getState().cacheTables).toHaveLength(0);
  });

  it('keeps the row and says so when the file could not be deleted', async () => {
    opfs.deleteFileFromCache.mockResolvedValue(false);

    const ok = await useCacheTablesStore.getState().delete_cacheTable(KEY);

    expect(ok).toBe(false);
    // Leaving the row is the honest outcome: the file is still on disk.
    expect(useCacheTablesStore.getState().cacheTables).toHaveLength(1);
    expect(useTimeSeriesStore.getState().loadingText).toMatch(/Could not delete the cached file/);
    expect(useTimeSeriesStore.getState().last_error).toEqual({ kind: 'cache-delete', tableId: KEY });
  });

  it('treats a rejection the same as a refusal', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    opfs.deleteFileFromCache.mockRejectedValue(new Error('NoModificationAllowedError'));

    const ok = await useCacheTablesStore.getState().delete_cacheTable(KEY);

    expect(ok).toBe(false);
    expect(useCacheTablesStore.getState().cacheTables).toHaveLength(1);
    warn.mockRestore();
  });

  it('drops the table before releasing the file', async () => {
    const order = [];
    deleteTable.mockImplementation(async () => { order.push('table'); });
    opfs.deleteFileFromCache.mockImplementation(async () => { order.push('file'); return true; });

    await useCacheTablesStore.getState().delete_cacheTable(KEY);

    // The table is what holds the file open, so it has to go first.
    expect(order).toEqual(['table', 'file']);
  });
});
