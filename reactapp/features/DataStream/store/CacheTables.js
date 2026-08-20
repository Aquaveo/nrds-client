import { create } from 'zustand';
import { deleteFileFromCache, clearCache, tableNameForKey } from '../lib/opfsCache';
import useTimeSeriesStore from './Timeseries';
import { deleteTable, dropAllVpuDataTables } from '../lib/queryData';
import { terminateDatabase } from '../lib/duckdbClient';

const EMPTY_TABLE = [];

export const useCacheTablesStore = create((set) => ({
  cacheTables: EMPTY_TABLE,

  add_cacheTable: (newCacheTable) =>
    set((state) => ({
      cacheTables: [...state.cacheTables, newCacheTable],
    })),

  delete_cacheTable: async (tableId) => {
    // The table first: it holds the file open, and its name is the id without the extension.
    await deleteTable(tableNameForKey(tableId)).catch((e) => {
      console.warn('[cacheTables] deleteTable failed:', tableId, e);
    });

    const deleted = await deleteFileFromCache(tableId).catch((e) => {
      console.warn('[cacheTables] deleteFileFromCache failed:', tableId, e);
      return false;
    });

    if (!deleted) {
      // Saying nothing here is what let a delete look successful and come back on reload.
      useTimeSeriesStore.setState({
        loadingText: `Could not delete the cached file for ${tableNameForKey(tableId)}`,
        last_error: { kind: 'cache-delete', tableId },
      });
      return false;
    }

    set((state) => ({
      cacheTables: state.cacheTables.filter((table) => table.id !== tableId),
    }));

    return true;
  },

  reset: async () => {
    // best-effort: attempt both regardless of failures
    await dropAllVpuDataTables().catch((e) => {
      console.warn('[cacheTables] dropAllVpuDataTables failed:', e);
    });

    await clearCache().catch((e) => {
      console.warn('[cacheTables] clearCache failed:', e);
    });

    // Release worker/database memory; next query will lazily recreate the DB.
    await terminateDatabase().catch((e) => {
      console.warn('[cacheTables] terminateDatabase failed:', e);
    });

    set({ cacheTables: EMPTY_TABLE });
    return true;
  },

  set_cacheTables: (newCacheTables) => set({ cacheTables: newCacheTables }),
}));
