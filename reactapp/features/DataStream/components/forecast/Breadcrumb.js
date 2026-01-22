import React, { memo } from 'react';
import './Breadcrumb.css';

function Breadcrumb({ segments = [], onClick }) {
  const normalized = segments.filter(Boolean);
  const lastIdx = normalized.length - 1;

  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      {normalized.map((seg, i) => {
        const isLast = i === lastIdx;
        const clickable =
          !!onClick && !isLast && (seg.kind === 'root_outputs' || seg.kind === 'value');

        const key = seg.id ?? `${seg.label}-${i}`;

        return (
          <React.Fragment key={key}>
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
              <span className={`breadcrumb-item${isLast ? ' active' : ''}`}>
                {seg.label}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

export default memo(Breadcrumb);
