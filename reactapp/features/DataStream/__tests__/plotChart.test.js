/**
 * The chart was previously impossible to test at all: d3 and its dependencies publish
 * untranspiled esm that this jest setup would not transform, so importing Plot threw a syntax
 * error from node_modules before any assertion ran.
 *
 * These are deliberately shallow -- an svg line chart's real output is geometry, and asserting
 * path coordinates would break on every legitimate styling change. What is worth pinning is
 * that it renders at all for a normal series, and that it says so rather than throwing when
 * there is nothing to draw.
 */
import { render, screen } from '@testing-library/react';

import LineChart from 'features/DataStream/components/forecast/Plot';

/* eslint-disable testing-library/no-container, testing-library/no-node-access --
   an svg chart exposes no roles or text for its geometry; the path element is the assertion. */

// Same shape TimeseriesCard builds: one entry per series, each holding its own points.
const series = [
  {
    label: 'flow',
    data: [
      { x: new Date('2022-08-01T00:00:00Z'), y: 1.5 },
      { x: new Date('2022-08-01T01:00:00Z'), y: 2.5 },
      { x: new Date('2022-08-01T02:00:00Z'), y: 0.5 },
    ],
  },
];
const empty = [{ label: 'flow', data: [] }];
const layout = { yaxis: 'flow', xaxis: '', title: 'wb-404' };

describe('LineChart', () => {
  it('draws a series', () => {
    const { container } = render(
      <LineChart width={800} height={400} data={series} layout={layout} />
    );

    expect(container.querySelector('svg')).toBeInTheDocument();
    // One path per series, with real coordinates rather than an empty d attribute.
    const paths = [...container.querySelectorAll('path')].filter((p) => p.getAttribute('d'));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].getAttribute('d')).toMatch(/^M[\d.]/);
  });

  it('labels the y axis with the variable and its units', () => {
    render(<LineChart width={800} height={400} data={series} layout={layout} />);

    expect(screen.getByText(/flow/i)).toBeInTheDocument();
  });

  it('tells you what to do rather than only that there is nothing', () => {
    render(<LineChart width={800} height={400} data={empty} layout={layout} />);

    // The empty state used to read "No data to display", which describes the chart's problem
    // rather than the reader's next move.
    expect(screen.getByText(/select a catchment/i)).toBeInTheDocument();
  });

  it('survives a zero-width container', () => {
    // The chart mounts before measurement, so this is the first render every time.
    expect(() =>
      render(<LineChart width={0} height={0} data={series} layout={layout} />)
    ).not.toThrow();
  });
});
