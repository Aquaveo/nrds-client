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

beforeEach(() => {
  // resetMocks is on for this project, which strips the factory implementations above.
  useTimeSeriesStore.setState(initialTimeseriesState, true);
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
