import PropTypes from 'prop-types';
import { MdClose, MdInfoOutline } from 'react-icons/md';

import { SButton } from './styles/Styles';

/**
 * The control that opens an inline note.
 *
 * Its open state lives with the caller rather than here, because the note it opens has to
 * render somewhere else: the toggle sits on a heading row and the note belongs underneath it,
 * full width. A component owning both would have to render them as siblings, which is not
 * where either of them goes.
 *
 * aria-expanded and aria-controls are what make this a disclosure rather than a button that
 * happens to change something. The icon turns into a close glyph so the second press is
 * obviously the undo of the first.
 */
export const InfoToggle = ({ open, onToggle, controls, label, size = 15 }) => (
  <SButton
    bsPrefix="btn2"
    type="button"
    onClick={() => onToggle(!open)}
    aria-expanded={open}
    aria-controls={controls}
    aria-label={open ? `Hide ${label}` : `Show ${label}`}
    title={open ? `Hide ${label}` : `Show ${label}`}
  >
    {open ? <MdClose size={size} aria-hidden="true" /> : <MdInfoOutline size={size} aria-hidden="true" />}
  </SButton>
);

InfoToggle.propTypes = {
  open: PropTypes.bool,
  onToggle: PropTypes.func.isRequired,
  controls: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  size: PropTypes.number,
};

export default InfoToggle;
