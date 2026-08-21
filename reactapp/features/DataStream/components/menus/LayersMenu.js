import { Fragment, useCallback, useState } from 'react';
import { IoLayers, IoClose } from 'react-icons/io5';

import { LayerControl } from '../map/LayersControl';
import { LayersContainer, LayerButton } from '../styles/Styles';
import { IoLayers } from "react-icons/io5";

export const LayersMenu = ({ inline = false }) => {
  const [open, setIsOpen] = useState(false);
  const toggle = useCallback(() => setIsOpen(o => !o), []);
  const buttonStyle = inline
    ? { position: 'static', top: 'auto', right: 'auto', marginTop: 0 }
    : undefined;

  return (
    <Fragment>
      {open ? (
        <>
          <LayerButton
            $bgColor="#ffffff00"
            onClick={toggle}
            aria-label="Close layer options"
            title="Close layer options"
            style={buttonStyle}
          >
            <IoLayers size={20} />
          </LayerButton>

          <LayersContainer isOpen={open}>
            <LayerControl />
          </LayersContainer>
        </>
      ) : (
        <LayerButton
          onClick={() => setIsOpen(prev => !prev)}
          aria-label="Open layer options"
          title="Open layer options"
          style={buttonStyle}
        >
          <IoLayers size={20} />
        </LayerButton>
      )}
    </Fragment>
  );
};
