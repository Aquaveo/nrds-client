import { Fragment, useCallback, useState } from 'react';
import { IoLayers, IoClose } from 'react-icons/io5';

import { LayerControl } from '../map/LayersControl';
import { LayersContainer, LayerButton } from '../styles/Styles';

/**
 * The layer panel, and the control that reveals it.
 *
 * A disclosure, declared as one. It was two icon-only buttons with no accessible name at all,
 * announcing themselves as "button", and they were how the layer panel is reached. The panel
 * also took an isOpen prop it never used, and which styled-components filtered out before it
 * could reach the DOM, so it did nothing in either direction.
 */
export const LayersMenu = () => {
  const [open, setIsOpen] = useState(false);
  const toggle = useCallback(() => setIsOpen((o) => !o), []);

  return (
    <Fragment>
      <LayerButton
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="layer-options"
        aria-label={open ? 'Hide layer options' : 'Show layer options'}
        title={open ? 'Hide layer options' : 'Show layer options'}
        $bgColor={open ? 'transparent' : undefined}
      >
        {open ? <IoClose size={20} aria-hidden="true" /> : <IoLayers size={20} aria-hidden="true" />}
      </LayerButton>

      {open && (
        <LayersContainer id="layer-options">
          <LayerControl />
        </LayersContainer>
      )}
    </Fragment>
  );
};
