import React, { Fragment, useState } from 'react';
import { IconLabel, FieldBlock, FieldValue, FieldsGrid, FieldLabel, HeaderRow, InfoPanel } from '../styles/Styles';
import { useFeatureStore } from 'features/DataStream/store/Layers';
import { formatLabel } from 'features/DataStream/lib/utils';
import { BasinSymbol } from 'features/DataStream/lib/layers';
import { InfoToggle } from '../InfoDisclosure';
import { LayerInfoContent } from '../InfoContent';

export const FeatureInformation = React.memo(() => {
  const selectedFeature = useFeatureStore((state) => state.selected_feature);
  const [ layerInfoOpen, setLayerInfoOpen ] = useState(false);
  
  if (!selectedFeature) {
    return null; 
  }

  const { lat, latitude, lon, longitude, ...restProps } = selectedFeature;
  const latVal = lat ?? latitude;
  const lonVal = lon ?? longitude;

  const fields = [];

  if (latVal != null && lonVal != null) {
    const latNum = Number(latVal);
    const lonNum = Number(lonVal);
    const latLon =
      !Number.isNaN(latNum) && !Number.isNaN(lonNum)
        ? `${latNum.toFixed(6)}, ${lonNum.toFixed(6)}`
        : `${latVal}, ${lonVal}`;

    fields.push({
      label: 'Lat/Long',
      value: latLon,
    });
  }

  // Add remaining properties dynamically
  Object.entries(restProps).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    let displayValue = value;

    if (typeof value === 'boolean') {
        displayValue = value ? 'Yes' : 'No';
    }else if (typeof value === 'number') {
        displayValue = value.toFixed(4);
    }

    fields.push({
      label: formatLabel(key),
      value: displayValue,
    });
  });

  return (
    <Fragment>
      <HeaderRow>
        <IconLabel $fontSize={14}>
          <span style={{ fontWeight: 600 }}>Feature Information</span>
          <IconLabel>
            <InfoToggle
              open={layerInfoOpen}
              onToggle={setLayerInfoOpen}
              controls="feature-layer-info"
              label="layer information"
            />
          </IconLabel>
        </IconLabel>
      </HeaderRow>

      {layerInfoOpen && (
        <InfoPanel id="feature-layer-info">
          <LayerInfoContent />
        </InfoPanel>
      )}

      <FieldsGrid>
        {fields.map(({ label, value }) => (
          <FieldBlock key={label}>
            <FieldLabel>
              {
                label.includes('km2') ?
                (
                  <BasinSymbol stroke ={'#009989'} fill={'#009989'} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                ) : null
                
              }
              {label}
              </FieldLabel>
            <FieldValue>{value}</FieldValue>
          </FieldBlock>
        ))}
      </FieldsGrid>
    </Fragment>
  );
});
