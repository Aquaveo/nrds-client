/**
 * handleVisulization refuses to load under three conditions and explains each one. Those
 * messages used to be cleared on the line after they were set, so none of them ever appeared;
 * this pins that they survive, and that a stale one cannot be mistaken for the current answer.
 */
import { act, render, screen } from '@testing-library/react';

import useTimeSeriesStore from 'features/DataStream/store/Timeseries';
import useDataStreamStore from 'features/DataStream/store/Datastream';
import { useFeatureStore } from 'features/DataStream/store/Layers';

jest.mock('features/DataStream/actions/loadVpu', () => ({ loadVpu: jest.fn() }));
jest.mock('features/DataStream/lib/opfsCache', () => ({ getCacheKey: () => 'vpu-01' }));
jest.mock('features/DataStream/lib/duckdbClient', () => ({ terminateDatabase: jest.fn() }));
jest.mock('features/DataStream/lib/s3Utils', () => ({
  getOptionsFromURL: jest.fn(async () => []),
  makePrefix: () => 'prefix/',
}));
jest.mock('features/DataStream/components/SelectComponent', () => function SelectComponent() {
  return null;
});

const { loadVpu } = require('features/DataStream/actions/loadVpu');
const { DataMenuControls } = require('features/DataStream/components/forecast/dataMenu');

const initial = {
  ts: useTimeSeriesStore.getState(),
  ds: useDataStreamStore.getState(),
  fs: useFeatureStore.getState(),
};

beforeEach(() => {
  useTimeSeriesStore.setState(initial.ts, true);
  useDataStreamStore.setState(initial.ds, true);
  useFeatureStore.setState(initial.fs, true);
  loadVpu.mockResolvedValue(undefined);
});

const press = async () => {
  await act(async () => {
    screen.getByRole('button', { name: /update|visuali/i }).click();
  });
};

describe('the visualize button', () => {
  it('asks for a feature when none is selected, and leaves the message up', async () => {
    render(<DataMenuControls />);

    await press();

    expect(useTimeSeriesStore.getState().loadingText).toBe('Please select a feature on the map first');
    expect(loadVpu).not.toHaveBeenCalled();
  });

  it('asks for an output file once a feature and vpu are chosen', async () => {
    useFeatureStore.setState({ selected_feature: { _id: 'cat-1' } });
    useDataStreamStore.setState({ vpu: 'VPU_01', outputFile: null });
    render(<DataMenuControls />);

    await press();

    expect(useTimeSeriesStore.getState().loadingText).toBe('No Output File selected');
    expect(loadVpu).not.toHaveBeenCalled();
  });

  it('says a load is already running rather than starting a second', async () => {
    useFeatureStore.setState({ selected_feature: { _id: 'cat-1' } });
    useDataStreamStore.setState({ vpu: 'VPU_01', outputFile: 'troute.parquet' });
    useTimeSeriesStore.setState({ loading: true });
    render(<DataMenuControls />);

    await press();

    expect(useTimeSeriesStore.getState().loadingText).toBe('Data is already loading, please wait...');
    expect(loadVpu).not.toHaveBeenCalled();
  });

  it('loads when everything it needs is there', async () => {
    useFeatureStore.setState({ selected_feature: { _id: 'cat-1' } });
    useDataStreamStore.setState({ vpu: 'VPU_01', outputFile: 'troute.parquet' });
    render(<DataMenuControls />);

    await press();

    expect(loadVpu).toHaveBeenCalled();
    expect(useDataStreamStore.getState().cache_key).toBe('vpu-01');
  });

  it('drops the previous complaint when pressed again', async () => {
    render(<DataMenuControls />);
    await press();
    expect(useTimeSeriesStore.getState().loadingText).toMatch(/select a feature/);

    // Inside act, so the handler sees the new values rather than the render it closed over.
    await act(async () => {
      useFeatureStore.setState({ selected_feature: { _id: 'cat-1' } });
      useDataStreamStore.setState({ vpu: 'VPU_01', outputFile: 'troute.parquet' });
    });
    await press();

    // A stale refusal must not read as the answer to this press.
    expect(useTimeSeriesStore.getState().loadingText).not.toMatch(/select a feature/);
  });
});
