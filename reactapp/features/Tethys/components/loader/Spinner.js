import PropTypes from 'prop-types';
import styled, { keyframes } from 'styled-components';

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

/**
 * One ring with a gap in it, turning.
 *
 * It replaced a two-ring orbiting animation, six arcs and four moons across 163 lines of Sass,
 * which read as a logo rather than as progress and could only ever appear on the boot screen it
 * was sized for. This is one element that takes its colour from the text beside it and its size
 * from a prop, so the same indicator serves the boot screen, the header status, the search
 * button and the cache control. Wherever a spinner appears in this app, it is this one.
 *
 * Under prefers-reduced-motion it slows rather than stopping. A still ring next to the words
 * "Loading" reads as something that has broken; the point of honouring the setting is to remove
 * fast motion, and one slow revolution does that while still saying the app is working.
 */
const Ring = styled.span`
  display: inline-block;
  flex: none;
  box-sizing: border-box;
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  border: ${({ $thickness }) => $thickness}px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: ${spin} 0.7s linear infinite;

  @media (prefers-reduced-motion: reduce) {
    animation-duration: 2.4s;
  }
`;

/**
 * A loading indicator.
 *
 * Decorative by default, because every place it is used already announces itself: the status
 * strip is a live region carrying the message, and the buttons carry an accessible name that
 * says what they are doing. Pass ``label`` only when the spinner is the announcement, which is
 * the boot screen and nothing else.
 */
export const Spinner = ({ size = 16, thickness = 2, label, className }) =>
  label ? (
    <Ring
      className={className}
      role="status"
      aria-label={label}
      $size={size}
      $thickness={thickness}
    />
  ) : (
    <Ring className={className} aria-hidden="true" $size={size} $thickness={thickness} />
  );

Spinner.propTypes = {
  size: PropTypes.number,
  thickness: PropTypes.number,
  label: PropTypes.string,
  className: PropTypes.string,
};

export default Spinner;
