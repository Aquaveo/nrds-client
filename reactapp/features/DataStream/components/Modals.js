import Modal from 'react-bootstrap/Modal';
import PropTypes from 'prop-types';
import { useId } from 'react';
import { MdClose } from 'react-icons/md';

import { ThemedModal, ModalCloseButton } from './styles/Styles';
import { GeneralInfoContent } from './InfoContent';

/**
 * The shell for the one dialog that is still a dialog.
 *
 * The three of them each carried their own copy of the header, the title row's inline flex
 * styles, and the close button, and all three hard-coded the same element id into
 * aria-labelledby, so two open at once would have pointed at each other's heading. useId gives
 * each instance its own.
 *
 * A backdrop, where there was none. Without it the dialog floated over a live map with nothing
 * separating them, it was unclear whether the map was still interactive, and there was no way
 * to dismiss by clicking away or pressing escape.
 */
const InfoModal = ({ title, children, onHide, ...props }) => {
  const titleId = useId();

  return (
    <ThemedModal
      {...props}
      onHide={onHide}
      size="lg"
      centered
      scrollable
      aria-labelledby={titleId}
    >
      <Modal.Header>
        <Modal.Title as="h2" id={titleId}>
          {title}
        </Modal.Title>
        <ModalCloseButton type="button" onClick={onHide} aria-label={`Close ${title}`}>
          <MdClose size={20} aria-hidden="true" />
        </ModalCloseButton>
      </Modal.Header>

      <Modal.Body>{children}</Modal.Body>
    </ThemedModal>
  );
};

InfoModal.propTypes = {
  title: PropTypes.string.isRequired,
  children: PropTypes.node,
  onHide: PropTypes.func,
};

export const GeneralInfoModal = (props) => (
  <InfoModal {...props} title="Ngen Research DataStream">
    <GeneralInfoContent />
  </InfoModal>
);
