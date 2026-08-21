
import React,{ useState } from 'react';
import { MdLocationPin, MdClose } from "react-icons/md";
import { Row, IconLabel, SButton, InfoPanel } from '../styles/Styles';
import { InfoToggle } from '../InfoDisclosure';
import { DataInfoContent } from '../InfoContent';


export const ForecastHeader = ({ title, onClick }) =>{
  const [ dataInfoOpen, setDataInfoOpen ] = useState(false);
  return (
    <div>
      <Row>
        <IconLabel as="h2" $fontSize={16}>
          <MdLocationPin size={18} style={{ color: 'var(--nav-pill-active-bg)' }} />
          {title}
        </IconLabel>
        <InfoToggle
          open={dataInfoOpen}
          onToggle={setDataInfoOpen}
          controls="data-info"
          label="notes on this data"
        />
        <SButton onClick={onClick} aria-label="Clear selection" title="Clear selection">
          <MdClose />
        </SButton>
      </Row>
      {dataInfoOpen && (
        <InfoPanel id="data-info">
          <DataInfoContent />
        </InfoPanel>
      )}
    </div>
)};



