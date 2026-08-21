import { Fragment, useMemo, useCallback } from 'react';
import { TimeSeriesContainer } from '../styles/Styles';
import useTimeSeriesStore from 'features/DataStream/store/Timeseries';
import ParentSize from '@visx/responsive/lib/components/ParentSize';
import LineChart from 'features/DataStream/components/forecast/Plot';
import { useShallow } from 'zustand/react/shallow';


const TimeSeriesCard = () => {
  const { series, variable, layout, featureId } = useTimeSeriesStore(useShallow((state) => ({
      series: state.series,
      variable: state.variable,
      layout: state.layout,
      featureId: state.feature_id,
  })));

  /**
   * What an empty chart says.
   *
   * The message was fixed text asking the reader to select a catchment, which is wrong in the
   * case that matters: a catchment is selected, the panel is open because of it, and the chart
   * is empty because this selection has nothing to read. Being told to do the thing already
   * done reads as the app having lost track.
   */
  const emptyMessage = featureId
    ? `No data to chart for ${featureId} in this selection`
    : 'Select a catchment to see its timeseries';

  const chartData = useMemo(() => {
    return [
      {
        label: variable,
        data: series,
      },
    ];
  }, [series, variable]);

  const renderChart = useCallback(
    ({ width, height }) => (
      <LineChart
        width={width}
        height={height}
        data={chartData}
        layout={layout}
        emptyMessage={emptyMessage}
      />
    ),
    [chartData, layout, emptyMessage]
  );


  return (
    <Fragment>
          <TimeSeriesContainer>
            <ParentSize>
              {renderChart}
            </ParentSize>
          </TimeSeriesContainer>

    </Fragment>
  );
};

export default TimeSeriesCard;
