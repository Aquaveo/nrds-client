import { useSyncExternalStore } from 'react';

/**
 * Whether the viewport is at or below the chart's single label-sizing breakpoint.
 *
 * The chart used to read window.innerWidth during render, which was a layout read on every
 * render and was not reactive either: a chart mounted on a narrow window kept narrow labels
 * for the rest of the session. Subscribing to the media query instead means a re-render only
 * when the breakpoint is actually crossed, rather than on every pixel of a drag.
 *
 * useSyncExternalStore is React's supported way to read an external source like this, so no
 * effect is involved. It lives in its own module so it can be tested without pulling in the
 * chart's d3 and visx dependencies.
 */
const NARROW_QUERY = '(max-width: 1300px)';
const NARROW_MAX_PX = 1300;

// One MediaQueryList is built and reused, keyed on the matchMedia function it came from, so
// replacing matchMedia -- a polyfill loading late, or a test supplying its own -- produces a
// new list rather than handing back one bound to the old implementation.
let queryListSource;
let narrowQueryList = null;
const getNarrowQueryList = () => {
  if (queryListSource !== window.matchMedia) {
    queryListSource = window.matchMedia;
    narrowQueryList = queryListSource ? queryListSource.call(window, NARROW_QUERY) : null;
  }
  return narrowQueryList;
};

const subscribeToNarrow = (onChange) => {
  const mql = getNarrowQueryList();
  if (!mql) return () => {};
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
};

// Falls back to a direct read where matchMedia is missing, which is the case under jsdom.
const isNarrowSnapshot = () =>
  getNarrowQueryList()?.matches ?? window.innerWidth <= NARROW_MAX_PX;

export const useIsNarrowViewport = () =>
  useSyncExternalStore(subscribeToNarrow, isNarrowSnapshot);

export default useIsNarrowViewport;
