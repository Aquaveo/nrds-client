import React from 'react';
import { render, waitFor, act } from '@testing-library/react';

import DataStreamView from 'features/DataStream/views/DatastreamView';

import useDataStreamStore from 'features/DataStream/store/Datastream';
import useTimeSeriesStore from 'features/DataStream/store/Timeseries';
import useS3DataStreamBucketStore from 'features/DataStream/store/s3Store';
import { useCacheTablesStore } from 'features/DataStream/store/CacheTables';
import { useVPUStore, useFeatureStore } from 'features/DataStream/store/Layers';

import { initialS3Data, makePrefix } from 'features/DataStream/lib/s3Utils';
import { getCacheKey } from 'features/DataStream/lib/opfsCache';
import {
  checkForTable,
  getTimeseries,
  loadVpuData,
  getFeatureIDs,
  getDistinctFeatureIds,
  getDistinctTimes,
  getVpuVariableFlat,
  getVariables,
} from 'features/DataStream/lib/queryData';
import { terminateDatabase } from 'features/DataStream/lib/duckdbClient';
import { makeTitle } from 'features/DataStream/lib/utils';

jest.mock('features/DataStream/components/map/Mapg.js', () => () => (
  <div data-testid="map" />
));

jest.mock('features/DataStream/components/menus/MainMenu', () => () => (
  <div data-testid="main-menu" />
));

jest.mock('react-toastify', () => ({
  ToastContainer: () => <div data-testid="toast" />,
}));

jest.mock('features/DataStream/lib/s3Utils', () => {
  const actual = jest.requireActual('features/DataStream/lib/s3Utils');
  return {
    ...actual,
    initialS3Data: jest.fn(),
  };
});

jest.mock('features/DataStream/lib/opfsCache', () => ({
  getCacheKey: jest.fn(),
}));

jest.mock('features/DataStream/lib/queryData', () => ({
  checkForTable: jest.fn(),
  getTimeseries: jest.fn(),
  loadVpuData: jest.fn(),
  getFeatureIDs: jest.fn(),
  getDistinctFeatureIds: jest.fn(),
  getDistinctTimes: jest.fn(),
  getVpuVariableFlat: jest.fn(),
  getVariables: jest.fn(),
}));

jest.mock('features/DataStream/lib/duckdbClient', () => ({
  terminateDatabase: jest.fn(),
}));

const resetStores = () => {
  useDataStreamStore.getState().reset();
  useTimeSeriesStore.getState().reset();
  useTimeSeriesStore.setState({ loading: false, loadingText: '' });
  useS3DataStreamBucketStore.getState().reset();
  useCacheTablesStore.setState({ cacheTables: [] });
  useVPUStore.setState({
    featureIds: [],
    featureIdToIndex: {},
    times: [],
    valuesByVar: {},
    varDataOrder: [],
  });
  useFeatureStore.setState({ hovered_feature: null, selected_feature: null });
};

beforeEach(() => {
  resetStores();
  terminateDatabase.mockResolvedValue();
  checkForTable.mockResolvedValue(true);
  loadVpuData.mockResolvedValue(0);
  getFeatureIDs.mockResolvedValue([]);
  getVariables.mockResolvedValue(['flow']);
  getDistinctFeatureIds.mockResolvedValue([]);
  getDistinctTimes.mockResolvedValue([]);
  getVpuVariableFlat.mockResolvedValue([]);
  getTimeseries.mockResolvedValue([]);
});

describe('DataStreamView', () => {
  it('loads initial S3 data and seeds stores', async () => {
    const models = [{ value: 'test' }, { value: 'modelA' }];
    const dates = [{ value: 'ngen.20250101' }, { value: 'ngen.20250102' }];
    const forecasts = [{ value: 'short_range' }];
    const cycles = [{ value: '00' }];
    const ensembles = [{ value: 'ens1' }];
    const outputFiles = [{ value: 'output1' }];

    initialS3Data.mockResolvedValue({
      models,
      dates,
      forecasts,
      cycles,
      ensembles,
      outputFiles,
    });
    getCacheKey.mockReturnValue('cache-1');

    act(() => {
      useDataStreamStore.setState({ vpu: 'VPU01' });
    });

    render(<DataStreamView />);

    await waitFor(() => expect(getCacheKey).toHaveBeenCalled());

    expect(getCacheKey).toHaveBeenCalledWith(
      'modelA',
      'ngen.20250102',
      'short_range',
      '00',
      'ens1',
      'VPU01',
      'output1'
    );

    const dsState = useDataStreamStore.getState();
    expect(dsState.model).toBe('modelA');
    expect(dsState.date).toBe('ngen.20250102');
    expect(dsState.forecast).toBe('short_range');
    expect(dsState.cycle).toBe('00');
    expect(dsState.ensemble).toBe('ens1');
    expect(dsState.outputFile).toBe('output1');
    expect(dsState.cache_key).toBe('cache-1');

    const expectedPrefix = makePrefix(
      'modelA',
      'ngen.20250102',
      'short_range',
      '00',
      'ens1',
      'VPU01',
      'output1'
    );

    const s3State = useS3DataStreamBucketStore.getState();
    expect(s3State.models).toEqual([{ value: 'modelA' }]);
    expect(s3State.dates).toEqual(dates);
    expect(s3State.forecasts).toEqual(forecasts);
    expect(s3State.cycles).toEqual(cycles);
    expect(s3State.outputFiles).toEqual(outputFiles);
    expect(s3State.prefix).toBe(expectedPrefix);
  });

  it('loads VPU data on cacheKey and updates stores', async () => {
    checkForTable.mockResolvedValue(false);
    loadVpuData.mockResolvedValue(42);
    getFeatureIDs.mockResolvedValue(['fid-1', 'fid-2']);
    getVariables.mockResolvedValue(['flow', 'velocity']);
    getDistinctFeatureIds.mockResolvedValue(['fid-1', 'fid-2']);
    getDistinctTimes.mockResolvedValue([1000, 2000]);
    getVpuVariableFlat.mockResolvedValue([1, 2, 3, 4]);

    act(() => {
      useDataStreamStore.setState({
        cache_key: 'cache_vpu',
        forecast: 'short_range',
      });
      useS3DataStreamBucketStore.setState({ prefix: 'prefix-path' });
      useFeatureStore.setState({ selected_feature: { _id: 'wb-9' } });
    });

    render(<DataStreamView />);

    await waitFor(() => expect(getVariables).toHaveBeenCalled());

    expect(loadVpuData).toHaveBeenCalledWith('cache_vpu', 'prefix-path');

    const cacheTables = useCacheTablesStore.getState().cacheTables;
    expect(cacheTables).toHaveLength(1);
    expect(cacheTables[0]).toMatchObject({
      id: 'cache_vpu',
      size: 42,
    });

    const vpuState = useVPUStore.getState();
    expect(vpuState.featureIds).toEqual(['fid-1', 'fid-2']);
    expect(vpuState.valuesByVar.flow).toEqual([1, 2, 3, 4]);

    const dsState = useDataStreamStore.getState();
    expect(dsState.variables).toEqual(['flow', 'velocity']);

    const tsState = useTimeSeriesStore.getState();
    expect(tsState.variable).toBe('flow');
    expect(tsState.feature_id).toBe('wb-9');
  });

  it('loads timeseries when a feature is selected', async () => {
    checkForTable.mockResolvedValue(true);
    getFeatureIDs.mockResolvedValue([]);
    getVariables.mockResolvedValue(['flow']);
    getDistinctFeatureIds.mockResolvedValue([]);
    getDistinctTimes.mockResolvedValue([]);
    getVpuVariableFlat.mockResolvedValue([]);

    getTimeseries.mockResolvedValue([
      { time: 0, flow: 10 },
      { time: 3600000, flow: 20 },
    ]);

    act(() => {
      useDataStreamStore.setState({
        cache_key: 'cache_ts',
        forecast: 'short_range',
      });
      useS3DataStreamBucketStore.setState({ prefix: 'prefix-path' });
      useTimeSeriesStore.setState({
        variable: 'flow',
        feature_id: null,
        loading: true,
        loadingText: '',
      });
    });

    render(<DataStreamView />);

    act(() => {
      useTimeSeriesStore.setState({ feature_id: 'wb-123', loading: false });
    });

    await waitFor(() =>
      expect(getTimeseries).toHaveBeenCalledWith('123', 'cache_ts', 'flow')
    );
    await waitFor(() =>
      expect(useTimeSeriesStore.getState().series).toHaveLength(2)
    );

    const tsState = useTimeSeriesStore.getState();
    expect(tsState.series[0].x).toBeInstanceOf(Date);
    expect(tsState.series[0].y).toBe(10);
    expect(tsState.series[1].y).toBe(20);
    expect(tsState.layout.title).toBe(makeTitle('short_range', 'wb-123'));
  });

  it('terminates duckdb worker on unmount', () => {
    const { unmount } = render(<DataStreamView />);
    unmount();
    expect(terminateDatabase).toHaveBeenCalledTimes(1);
  });
});
