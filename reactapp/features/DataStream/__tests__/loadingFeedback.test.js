/**
 * Regression tests for catchment-click feedback.
 *
 * Three defects made a click look like nothing had happened: a loading guard discarded any
 * selection made while a fetch was in flight, the status line rendered its text only while
 * loading was true so the failure message was erased before it could be read, and there was
 * no way to retry because the fetch was driven by an effect keyed on the feature id.
 *
 * Loading is now a store action called straight from the event that asks for it, so most of
 * this exercises the action rather than a rendered component.
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
  getTimeseries: jest.fn(),
  checkForTable: jest.fn(),
  loadVpuData: jest.fn(),
  getFeatureIDs: jest.fn(),
  getVariables: jest.fn(),
  getDistinctFeatureIds: jest.fn(),
  getDistinctTimes: jest.fn(),
  getVpuVariableFlat: jest.fn(),
}));

const queryData = require('features/DataStream/lib/queryData');
const { TimeseriesLoader } = require('features/DataStream/views/DatastreamView');
const { DataMenuLoading } = require('features/DataStream/components/forecast/dataMenu');

const initialTimeseriesState = useTimeSeriesStore.getState();
const initialDataStreamState = useDataStreamStore.getState();

const load = (args) => act(async () => {
  await useTimeSeriesStore.getState().loadTimeseries(args);
});

beforeEach(() => {
  // Both stores, because a cache_key surviving one test lets the vpu effect run in the next.
  useTimeSeriesStore.setState(initialTimeseriesState, true);
  useDataStreamStore.setState(initialDataStreamState, true);
  // resetMocks is on for this project, which strips the factory implementations above.
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

    // The order a failed load writes these in: message first, flag cleared after.
    act(() => {
      useTimeSeriesStore.setState({ loading: true, loadingText: 'Failed to load timeseries for id: wb-101' });
    });
    expect(screen.getByText(/Failed to load timeseries/)).toBeInTheDocument();

    act(() => {
      useTimeSeriesStore.setState({ loading: false });
    });
    expect(screen.getByText(/Failed to load timeseries/)).toBeInTheDocument();
  });

  it('shows nothing once the text is cleared', () => {
    render(<DataMenuLoading />);
    act(() => {
      useTimeSeriesStore.setState({ loading: false, loadingText: '' });
    });
    expect(screen.queryByText(/Failed/)).not.toBeInTheDocument();
  });
});

describe('loadTimeseries', () => {
  it('records the selection and charts it', async () => {
    await load({ featureId: 'wb-202' });

    expect(queryData.getTimeseries.mock.calls[0][0]).toBe('202');
    expect(useTimeSeriesStore.getState().feature_id).toBe('wb-202');
    expect(useTimeSeriesStore.getState().series).toHaveLength(1);
    expect(useTimeSeriesStore.getState().loading).toBe(false);
  });

  it('loads even when a load is already in flight', async () => {
    act(() => {
      useTimeSeriesStore.setState({ loading: true });
    });

    await load({ featureId: 'wb-202' });

    // A loading guard here used to drop the selection with nothing on screen to explain it.
    expect(queryData.getTimeseries).toHaveBeenCalled();
    expect(useTimeSeriesStore.getState().series).toHaveLength(1);
  });

  it('leaves the selected variable to the caller', async () => {
    await load({ featureId: 'wb-202', variable: 'precipitation' });

    expect(queryData.getTimeseries.mock.calls[0][2]).toBe('precipitation');
    // The flowpath layer looks up data by store variable, so the action must not move it
    // ahead of the values arriving.
    expect(useTimeSeriesStore.getState().variable).toBe('');
  });

  it('reports a failure and leaves the message on screen', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    queryData.getTimeseries.mockRejectedValueOnce(new Error('network down'));

    await load({ featureId: 'wb-303' });

    expect(useTimeSeriesStore.getState().loadingText).toMatch(/Failed to load timeseries/);
    expect(useTimeSeriesStore.getState().loading).toBe(false);
    consoleError.mockRestore();
  });

  it('retries after a failure, because asking again is all it takes', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    queryData.getTimeseries.mockRejectedValueOnce(new Error('network down'));

    await load({ featureId: 'wb-303' });
    expect(queryData.getTimeseries).toHaveBeenCalledTimes(1);

    await load({ featureId: 'wb-303' });

    expect(queryData.getTimeseries).toHaveBeenCalledTimes(2);
    expect(useTimeSeriesStore.getState().series).toHaveLength(1);
    expect(useTimeSeriesStore.getState().loadingText).toBe('');
    consoleError.mockRestore();
  });
});

describe('suppressing redundant loads', () => {
  it('does not reload the feature whose series is already charted', async () => {
    await load({ featureId: 'wb-404' });
    expect(queryData.getTimeseries).toHaveBeenCalledTimes(1);

    await load({ featureId: 'wb-404' });
    expect(queryData.getTimeseries).toHaveBeenCalledTimes(1);
  });

  it('reloads on return, because another feature replaced the series in between', async () => {
    await load({ featureId: 'wb-404' });
    await load({ featureId: 'wb-505' });
    await load({ featureId: 'wb-404' });

    // Suppressing the third would leave wb-505's points on screen labelled wb-404.
    expect(queryData.getTimeseries.mock.calls.map((c) => c[0])).toEqual(['404', '505', '404']);
  });

  it('reloads the same feature when the variable changed underneath it', async () => {
    await load({ featureId: 'wb-404' });
    expect(queryData.getTimeseries).toHaveBeenCalledTimes(1);

    // Keying suppression on the feature alone would skip this and chart the old variable.
    await load({ featureId: 'wb-404', variable: 'precipitation' });

    expect(queryData.getTimeseries).toHaveBeenCalledTimes(2);
    expect(queryData.getTimeseries.mock.calls[1][2]).toBe('precipitation');
  });

  it('reloads the same feature when the vpu changed underneath it', async () => {
    await load({ featureId: 'wb-404' });
    expect(queryData.getTimeseries).toHaveBeenCalledTimes(1);

    act(() => {
      useDataStreamStore.getState().set_cache_key('vpu-16');
    });
    await load({ featureId: 'wb-404' });

    expect(queryData.getTimeseries).toHaveBeenCalledTimes(2);
    expect(queryData.getTimeseries.mock.calls[1][1]).toBe('vpu-16');
  });

  it('reloads after the series is cleared', async () => {
    await load({ featureId: 'wb-404' });
    act(() => {
      useTimeSeriesStore.getState().reset_series();
    });

    await load({ featureId: 'wb-404' });
    expect(queryData.getTimeseries).toHaveBeenCalledTimes(2);
  });

  it('still records the selection when the load is suppressed', async () => {
    await load({ featureId: 'wb-404' });
    useTimeSeriesStore.setState({ feature_id: null });

    await load({ featureId: 'wb-404' });

    expect(useTimeSeriesStore.getState().feature_id).toBe('wb-404');
    expect(queryData.getTimeseries).toHaveBeenCalledTimes(1);
  });
});

describe('superseded loads', () => {
  it('lets the newest request win', async () => {
    let releaseFirst;
    queryData.getTimeseries
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve; }))
      .mockResolvedValueOnce([
        { time: '2022-08-01T00:00:00Z', flow: 9 },
        { time: '2022-08-01T01:00:00Z', flow: 9 },
      ]);

    const first = useTimeSeriesStore.getState().loadTimeseries({ featureId: 'wb-1' });
    await load({ featureId: 'wb-2' });

    await act(async () => {
      releaseFirst([{ time: '2022-08-01T00:00:00Z', flow: 1 }]);
      await first;
    });

    // wb-2 is the selection, so the late wb-1 result must not overwrite its series.
    expect(useTimeSeriesStore.getState().series).toHaveLength(2);
    expect(useTimeSeriesStore.getState().feature_id).toBe('wb-2');
  });
});

describe('vpu load failures', () => {
  it('can be retried by requesting the same cache key again', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    queryData.checkForTable.mockRejectedValueOnce(new Error('s3 unreachable'));

    render(<TimeseriesLoader />);

    await act(async () => {
      useDataStreamStore.getState().set_cache_key('vpu-01');
    });
    expect(queryData.checkForTable).toHaveBeenCalledTimes(1);
    expect(useTimeSeriesStore.getState().loadingText).toMatch(/Failed to load VPU data/);

    // Same cache key: without a request counter this is a no-op and the load can never rerun.
    await act(async () => {
      useDataStreamStore.getState().set_cache_key('vpu-01');
    });
    expect(queryData.checkForTable).toHaveBeenCalledTimes(2);
    expect(useTimeSeriesStore.getState().loadingText).toBe('');

    consoleError.mockRestore();
  });
});
