/**
 * Changing variable used to re-query the flat value array every time, including for a
 * variable the vpu store was already holding. Measured against duckdb-wasm at 4.8M rows that
 * query costs about 800 ms, most of it the ORDER BY, so a repeat visit paid it again for
 * data already in memory.
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';

import useTimeSeriesStore from 'features/DataStream/store/Timeseries';
import useDataStreamStore from 'features/DataStream/store/Datastream';
import { useVPUStore } from 'features/DataStream/store/Layers';

// react-select renders its options through a virtualized list, which is awkward to drive and
// beside the point: what matters here is what the change handler does.
jest.mock('features/DataStream/components/SelectComponent', () => function SelectComponent({ optionsList, onChangeHandler }) {
  return (
    <div>
      {optionsList.map((opt) => (
        <button key={opt.value} onClick={() => onChangeHandler(opt)}>{`pick ${opt.value}`}</button>
      ))}
    </div>
  );
});
jest.mock('features/DataStream/lib/queryData', () => ({
  getVpuVariableFlat: jest.fn(),
  getTimeseries: jest.fn(),
}));

const queryData = require('features/DataStream/lib/queryData');
const VariablesMenu = require('features/DataStream/components/forecast/variablesMenu').default;

const initial = {
  ts: useTimeSeriesStore.getState(),
  ds: useDataStreamStore.getState(),
  vpu: useVPUStore.getState(),
};

beforeEach(() => {
  useTimeSeriesStore.setState(initial.ts, true);
  useDataStreamStore.setState(initial.ds, true);
  useVPUStore.setState(initial.vpu, true);
  queryData.getVpuVariableFlat.mockResolvedValue(Float32Array.from([1, 2, 3]));
  queryData.getTimeseries.mockResolvedValue([{ time: '2022-08-01T00:00:00Z', flow: 1 }]);

  useDataStreamStore.setState({ cache_key: 'vpu-01', variables: ['flow', 'precipitation'] });
  useTimeSeriesStore.setState({ feature_id: 'wb-404' });
});

const pick = async (variable) => {
  await act(async () => {
    screen.getByText(`pick ${variable}`).click();
  });
};

describe('changing variable', () => {
  it('queries for a variable the store has not loaded', async () => {
    render(<VariablesMenu />);

    await pick('flow');

    expect(queryData.getVpuVariableFlat).toHaveBeenCalledWith('vpu-01', 'flow');
    expect(useVPUStore.getState().valuesByVar.flow).toHaveLength(3);
  });

  it('reuses what the vpu store already holds instead of querying again', async () => {
    const alreadyLoaded = Float32Array.from([7, 8, 9]);
    act(() => {
      useVPUStore.getState().setVarData('precipitation', alreadyLoaded);
    });
    render(<VariablesMenu />);

    await pick('precipitation');

    expect(queryData.getVpuVariableFlat).not.toHaveBeenCalled();
    // Still selected, and still the same array rather than a re-read copy.
    expect(useTimeSeriesStore.getState().variable).toBe('precipitation');
    expect(useVPUStore.getState().valuesByVar.precipitation).toBe(alreadyLoaded);
  });

  it('still charts the series when the flat array came from the cache', async () => {
    act(() => {
      useVPUStore.getState().setVarData('precipitation', Float32Array.from([7]));
    });
    render(<VariablesMenu />);

    await pick('precipitation');

    // The chart is the store's job and must not be skipped along with the query.
    expect(queryData.getTimeseries).toHaveBeenCalledWith('404', 'vpu-01', 'precipitation');
    expect(useTimeSeriesStore.getState().series).toHaveLength(1);
  });

  it('queries again for that variable once the vpu is reset', async () => {
    act(() => {
      useVPUStore.getState().setVarData('precipitation', Float32Array.from([7]));
      useVPUStore.getState().resetVPU();
    });
    render(<VariablesMenu />);

    await pick('precipitation');

    // resetVPU empties the cache, so a hit can never be another vpu's data.
    expect(queryData.getVpuVariableFlat).toHaveBeenCalledWith('vpu-01', 'precipitation');
  });
});
