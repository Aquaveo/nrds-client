import React, { memo, useMemo } from 'react';
import './Breadcrumb.css';
/**
 * segments example:
 * [
 *   { id: 'root', label: 'outputs', kind: 'root_outputs' },
 *   { id: 'model', label: model, kind: 'value', resetKey: 'model' },
 *   { id: 'hf', label: 'hydrofabric', kind: 'value', resetKey: 'date' }, // display label != internal folder
 *   ...
 * ]
 */
function Breadcrumb({ segments, onClick }) {
  const normalized = useMemo(() => (segments || []).filter(Boolean), [segments]);
  const lastIdx = normalized.length - 1;

  return (
    <div className="breadcrumb">
      {normalized.map((seg, i) => {
        const isLast = i === lastIdx;
        const clickable = !!onClick && !isLast && (seg.kind === 'root_outputs' || seg.kind === 'value');

        return (
          <React.Fragment key={seg.id ?? `${seg.label}-${i}`}>
            {i > 0 && <span className="breadcrumb-sep">/</span>}

            {clickable ? (
              <button
                type="button"
                className="breadcrumb-item"
                onClick={() => onClick(seg)}
                title="Navigate here"
              >
                {seg.label}
              </button>
            ) : (
              <span className={`breadcrumb-item ${isLast ? 'active' : ''}`}>
                {seg.label}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default memo(Breadcrumb);
