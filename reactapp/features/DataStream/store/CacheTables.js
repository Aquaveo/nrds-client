import { create } from 'zustand';
import { clearCache, getFilesFromCache } from '../lib/opfsCache';
import useTimeSeriesStore from './Timeseries';
import { useVPUStore } from './Layers';
import { dropAllVpuDataTables } from '../lib/queryData';
import { terminateDatabase } from '../lib/duckdbClient';

const EMPTY_TABLE = [];

/**
 * Forget everything derived from a table that no longer exists.
 *
 * The animation arrays, the charted series, and last_loaded_key were all built from a table
 * the clear just dropped. Leaving them meant the map kept animating values with no table
 * behind them, and last_loaded_key made a re-click of the same feature look like a duplicate
 * request and return early.
 */
const invalidateDerivedState = () => {
  useVPUStore.getState().resetVPU();
  useTimeSeriesStore.setState({ last_loaded_key: null });
};

/**
 * What is on disk, and a way to throw it away.
 *
 * Reads the cache rather than tracking it. This store used to maintain its own list through
 * add and delete calls alongside the directory listing taken at mount, and the two disagreed:
 * the same file appeared once per load, each row with its own delete button. There is at most
 * one data file now, so the listing is cheap and it cannot drift from what OPFS actually holds.
 */
export const useCacheTablesStore = create((set) => ({
  cacheTables: EMPTY_TABLE,

  refresh: async () => {
    const files = await getFilesFromCache().catch((e) => {
      console.warn('[cacheTables] could not list the cache:', e);
      return null;
    });
    set({ cacheTables: files ?? EMPTY_TABLE });
    return files ?? EMPTY_TABLE;
  },

  clear: async () => {
    // Best effort in order: tables, then files, then the worker holding them open.
    await dropAllVpuDataTables().catch((e) => {
      console.warn('[cacheTables] dropAllVpuDataTables failed:', e);
    });

    await clearCache().catch((e) => {
      console.warn('[cacheTables] clearCache failed:', e);
    });

    await terminateDatabase().catch((e) => {
      console.warn('[cacheTables] terminateDatabase failed:', e);
    });

    set({ cacheTables: EMPTY_TABLE });
    invalidateDerivedState();
    return true;
  },
}));
