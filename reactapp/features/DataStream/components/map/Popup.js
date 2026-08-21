import React,{ useMemo } from 'react';
import { Popup } from 'react-map-gl/maplibre';
import { PopupContent } from '../styles/Styles';
import { hoverRows } from 'features/DataStream/actions/hoverFeature';
import { formatLabel } from 'features/DataStream/lib/utils';

const CustomPopUp = React.memo(({ hovered_feature, enabledHovering }) => {
  // hoverId, longitude and latitude are ours, added so the popup can place itself: they were
  // being listed back to the reader as if they were properties of the feature.
  const rows = useMemo(() => hoverRows(hovered_feature), [hovered_feature]);

    if (!enabledHovering || !hovered_feature?.hoverId) return null;

  return (
    <Popup
      longitude={hovered_feature.longitude}
      latitude={hovered_feature.latitude}
      offset={[0, -10]}
      closeButton={false}
    >
      <PopupContent>
        <div className="popup-title">Feature</div>
        {rows.map(([k, v]) => (
          <div className="popup-row" key={k}>
            <span className="popup-label">{formatLabel(k)}</span>
            <span className="popup-value">{String(v)}</span>
          </div>
        ))}
      </PopupContent>
    </Popup>
  );
});

export default CustomPopUp;