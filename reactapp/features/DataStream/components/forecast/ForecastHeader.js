
import React,{ useState } from 'react';
import { MdLocationPin, MdClose, MdInfoOutline } from "react-icons/md";
import { Row, IconLabel, SButton } from '../styles/Styles';
import { DataInfoModel } from '../Modals';


export const ForecastHeader = ({ title, onClick }) =>{
  const [ modalDataInfoShow, setModalDataInfoShow ] = useState(false);
  return (
    <div>
      <Row>
        <IconLabel as="h2" $fontSize={16}>
          <MdLocationPin size={18} style={{ color: 'var(--nav-pill-active-bg)' }} />
          {title}
        </IconLabel>
        <SButton
          bsPrefix="btn2"
          onClick={() => setModalDataInfoShow(true)}
          aria-label="About this data"
          title="About this data"
        >
          <MdInfoOutline size={15} />
        </SButton>
        <SButton onClick={onClick} aria-label="Clear selection" title="Clear selection">
          <MdClose />
        </SButton>
      </Row>
      <DataInfoModel
        show={modalDataInfoShow}
        onHide={() => setModalDataInfoShow(false)}
      />
    </div>
)};



