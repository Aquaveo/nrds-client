/**
 * The cache used to be a floating folder button opening a table of files, one delete control
 * per row, because up to ten files could be held. One file is held now, so there is nothing to
 * choose between and the whole panel reduces to this.
 */
import { render, screen, act } from '@testing-library/react';

jest.mock('features/DataStream/store/CacheTables', () => {
  const refresh = jest.fn();
  const clear = jest.fn();
  const state = { cacheTables: [], refresh, clear };
  const useCacheTablesStore = (selector) => selector(state);
  useCacheTablesStore.__state = state;
  return { useCacheTablesStore };
});

const { useCacheTablesStore } = require('features/DataStream/store/CacheTables');
const ClearCacheButton = require('features/DataStream/components/cache/ClearCacheButton').default;

const state = useCacheTablesStore.__state;
const button = () => screen.getByRole('button');

beforeEach(() => {
  state.cacheTables = [];
  state.refresh.mockResolvedValue([]);
  state.clear.mockResolvedValue(true);
});

describe('the clear cache button', () => {
  test('reads what is on disk on mount, since a cached file outlives the session', async () => {
    await act(async () => { render(<ClearCacheButton />); });

    expect(state.refresh).toHaveBeenCalled();
  });

  test('offers nothing to clear when the cache is empty', async () => {
    await act(async () => { render(<ClearCacheButton />); });

    expect(button()).toBeDisabled();
    expect(button()).toHaveAccessibleName(/no cached data/i);
  });

  test('names the file size, so the cost of clearing is visible before the click', async () => {
    state.cacheTables = [{ id: 'vpu_16.parquet', name: 'vpu 16', size: '6.2 MB' }];

    await act(async () => { render(<ClearCacheButton />); });

    expect(button()).toBeEnabled();
    expect(button()).toHaveAccessibleName(/clear cached data \(6\.2 MB\)/i);
  });

  test('clears when pressed', async () => {
    state.cacheTables = [{ id: 'vpu_16.parquet', name: 'vpu 16', size: '6.2 MB' }];
    await act(async () => { render(<ClearCacheButton />); });

    await act(async () => { button().click(); });

    expect(state.clear).toHaveBeenCalledTimes(1);
  });

  test('cannot be pressed twice into a double clear', async () => {
    state.cacheTables = [{ id: 'vpu_16.parquet', name: 'vpu 16', size: '6.2 MB' }];
    let release;
    state.clear.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    await act(async () => { render(<ClearCacheButton />); });

    await act(async () => { button().click(); });
    expect(button()).toBeDisabled();
    expect(button()).toHaveAttribute('aria-busy', 'true');

    await act(async () => { release(true); });
    expect(state.clear).toHaveBeenCalledTimes(1);
  });

  test('re-enables after a failed clear rather than staying stuck', async () => {
    state.cacheTables = [{ id: 'vpu_16.parquet', name: 'vpu 16', size: '6.2 MB' }];
    state.clear.mockRejectedValue(new Error('OPFS said no'));
    await act(async () => { render(<ClearCacheButton />); });

    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => { button().click(); });

    expect(button()).toBeEnabled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
