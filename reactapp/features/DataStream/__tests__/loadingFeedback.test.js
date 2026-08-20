/**
 * Regression tests for catchment-click feedback.
 *
 * Two defects made a click look like nothing happened. A `loading` guard in the click
 * handler and in both fetch effects discarded any selection made while a fetch was in
 * flight, and the status line rendered its text only while `loading` was true -- so the
 * failure message written in `catch` was erased by the `set_loading(false)` in `finally`
 * before a user could read it.
 */
import { render, screen, act } from '@testing-library/react';

import useTimeSeriesStore from 'features/DataStream/store/Timeseries';
import useDataStreamStore from 'features/DataStream/store/Datastream';

// The map and menu subtrees pull maplibre, deck.gl and duckdb-wasm, none of which run in
// jsdom, and none of which these assertions touch.
jest.mock('features/DataStream/components/map/Mapg.js', () => function Mapg() { return null; });
jest.mock('features/DataStream/components/menus/MainMenu', () => function MainMenu() { return null; });
jest.mock('features/DataStream/lib/duckdbClient', () => ({ terminateDatabase: jest.fn() }));
jest.mock('features/DataStream/lib/opfsCache', () => ({ getCacheKey: () => 'vpu-01' }));
jest.mock('features/DataStream/lib/s3Utils', () => ({
  initialS3Data: jest.fn(async () => ({})),
  makePrefix: () => 'prefix/',
  getOptionsFromURL: jest.fn(async () => []),
}));
jest.mock('features/DataStream/lib/queryData', () => ({
  getTimeseries: jest.fn(async () => []),
  checkForTable: jest.fn(async () => true),
  loadVpuData: jest.fn(async () => 0),
  getFeatureIDs: jest.fn(async () => []),
  getVariables: jest.fn(async () => ['flow']),
  getDistinctFeatureIds: jest.fn(async () => []),
  getDistinctTimes: jest.fn(async () => []),
  getVpuVariableFlat: jest.fn(async () => []),
}));

const { TimeseriesLoader } = require('features/DataStream/views/DatastreamView');
const { DataMenuLoading } = require('features/DataStream/components/forecast/dataMenu');

const queryData = require('features/DataStream/lib/queryData');
const initialTimeseriesState = useTimeSeriesStore.getState();
const initialDataStreamState = useDataStreamStore.getState();

beforeEach(() => {
  // Both stores, because a cache_key surviving one test lets the VPU effect run in the next.
  useTimeSeriesStore.setState(initialTimeseriesState, true);
  useDataStreamStore.setState(initialDataStreamState, true);
  queryData.getTimeseries.mockResolvedValue([{ time: '2022-08-01T00:00:00Z', flow: 1.5 }]);
  queryData.checkForTable.mockResolvedValue(true);
  queryData.getFeatureIDs.mockResolvedValue([]);
  queryData.getVariables.mockResolvedValue(['flow']);
  queryData.getDistinctFeatureIds.mockResolvedValue([]);
  queryData.getDistinctTimes.mockResolvedValue([]);
  queryData.getVpuVariableFlat.mockResolvedValue([]);
});

describe('status line', () => {
  it('keeps a failure message visible after loading turns false', () => {
    render(<DataMenuLoading />);

    // The order a failed fetch writes these in: message during the catch, flag in the finally.
    act(() => {
      useTimeSeriesStore.getState().set_loading(true);
      useTimeSeriesStore.getState().set_loading_text('Failed to load timeseries for id: wb-101');
    });
    expect(screen.getByText(/Failed to load timeseries/)).toBeInTheDocument();

    act(() => {
      useTimeSeriesStore.getState().set_loading(false);
    });
    expect(screen.getByText(/Failed to load timeseries/)).toBeInTheDocument();
  });

  it('shows nothing once the text is cleared', () => {
    render(<DataMenuLoading />);
    act(() => {
      useTimeSeriesStore.getState().set_loading_text('');
      useTimeSeriesStore.getState().set_loading(false);
    });
    expect(screen.queryByText(/Failed/)).not.toBeInTheDocument();
  });
});

describe('selection made during a load', () => {
  it('still fetches when loading is already true', async () => {
    act(() => {
      useTimeSeriesStore.getState().set_loading(true);
    });

    render(<TimeseriesLoader />);

    await act(async () => {
      useTimeSeriesStore.getState().set_feature_id('wb-202');
    });

    expect(queryData.getTimeseries).toHaveBeenCalled();
    expect(queryData.getTimeseries.mock.calls[0][0]).toBe('202');
    // The fetch ran to completion rather than bailing out at a guard.
    expect(useTimeSeriesStore.getState().series).toHaveLength(1);
    expect(useTimeSeriesStore.getState().loading).toBe(false);
  });
});

describe('suppressing redundant fetches', () => {
  const select = async (id) => {
    await act(async () => {
      useTimeSeriesStore.getState().set_feature_id(id);
    });
  };

  it('does not refetch the feature whose series is already displayed', async () => {
    render(<TimeseriesLoader />);

    await select('wb-404');
    expect(queryData.getTimeseries).toHaveBeenCalledTimes(1);

    await select('wb-404');
    expect(queryData.getTimeseries).toHaveBeenCalledTimes(1);
  });

  it('refetches on return, because another feature replaced the series in between', async () => {
    render(<TimeseriesLoader />);

    await select('wb-404');
    await select('wb-505');
    await select('wb-404');

    // Suppressing the third fetch would leave wb-505's points on screen labelled wb-404.
    expect(queryData.getTimeseries).toHaveBeenCalledTimes(3);
    expect(queryData.getTimeseries.mock.calls.map((c) => c[0])).toEqual(['404', '505', '404']);
  });

  it('refetches the same feature when the variable changed underneath it', async () => {
    render(<TimeseriesLoader />);

    await select('wb-404');
    expect(queryData.getTimeseries).toHaveBeenCalledTimes(1);

    act(() => {
      useTimeSeriesStore.getState().set_variable('precipitation');
    });

    // Keying suppression on the feature alone would skip this and chart the old variable.
    await select('wb-404');
    expect(queryData.getTimeseries).toHaveBeenCalledTimes(2);
    expect(queryData.getTimeseries.mock.calls[1][2]).toBe('precipitation');
  });

  it('refetches the same feature when the vpu changed underneath it', async () => {
    // Two things independently force this: the vpu is part of the key, and the vpu effect
    // calls reset(), which clears the key. Belt and braces, deliberately.
    render(<TimeseriesLoader />);

    await select('wb-404');
    expect(queryData.getTimeseries).toHaveBeenCalledTimes(1);

    await act(async () => {
      useDataStreamStore.getState().set_cache_key('vpu-16');
    });

    await select('wb-404');
    expect(queryData.getTimeseries).toHaveBeenCalledTimes(2);
    expect(queryData.getTimeseries.mock.calls[1][1]).toBe('vpu-16');
  });

  it('refetches after the series is cleared', async () => {
    render(<TimeseriesLoader />);

    await select('wb-404');
    expect(queryData.getTimeseries).toHaveBeenCalledTimes(1);

    await act(async () => {
      useTimeSeriesStore.getState().reset_series();
    });
    await select('wb-404');
    expect(queryData.getTimeseries).toHaveBeenCalledTimes(2);
  });
});

describe('re-selecting the same feature', () => {
  it('refetches after a failure, so a click is a retry', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    queryData.getTimeseries.mockRejectedValueOnce(new Error('network down'));

    render(<TimeseriesLoader />);

    await act(async () => {
      useTimeSeriesStore.getState().set_feature_id('wb-303');
    });
    expect(queryData.getTimeseries).toHaveBeenCalledTimes(1);
    expect(useTimeSeriesStore.getState().loadingText).toMatch(/Failed to load timeseries/);

    // Same id as before: the selection itself has to be what triggers the refetch.
    await act(async () => {
      useTimeSeriesStore.getState().set_feature_id('wb-303');
    });
    expect(queryData.getTimeseries).toHaveBeenCalledTimes(2);
    expect(useTimeSeriesStore.getState().series).toHaveLength(1);
    expect(useTimeSeriesStore.getState().loadingText).toBe('');

    consoleError.mockRestore();
  });
});
