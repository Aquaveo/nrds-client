// DataMenu.nav.js
export const HYDROFABRIC_VERSION = 'v2.2_hydrofabric';

export const firstOpt = (v) => (Array.isArray(v) ? v[0] : v);

export const pickDefault = (opts, { index = 0, preferValue } = {}) => {
  if (!Array.isArray(opts) || opts.length === 0) return null;
  if (preferValue) {
    const found = opts.find((o) => o.value === preferValue);
    if (found) return found;
  }
  const safe = Math.min(Math.max(index, 0), opts.length - 1);
  return opts[safe] ?? opts[0] ?? null;
};

export const findSelected = (opts, value) => opts.find((o) => o.value === value) ?? null;

export const getStepOrder = (forecast) => {
  const base = ['model', 'date', 'forecast', 'cycle'];
  if (forecast === 'medium_range') base.push('ensemble');
  base.push('vpu', 'outputFile');
  return base;
};

export const deriveActiveKey = ({ model, date, forecast, cycle, ensemble, vpu }) => {
  if (!model) return 'model';
  if (!date) return 'date';
  if (!forecast) return 'forecast';
  if (!cycle) return 'cycle';

  if (forecast === 'medium_range') {
    if (!ensemble) return 'ensemble';
    if (!vpu) return 'vpu';
    return 'outputFile';
  }

  if (!vpu) return 'vpu';
  return 'outputFile';
  // return 'variables'
};

// Builds the S3 "list options" path for a given step based on current selections.
// IMPORTANT: v2.2_hydrofabric stays here (used for data), but we never display it.
export const getPathForStep = (stepKey, s) => {
  const H = HYDROFABRIC_VERSION;

  if (stepKey === 'model') return 'outputs/';
  if (stepKey === 'date') {
    if (!s.model) return '';
    return `outputs/${s.model}/${H}/`;
  }
  if (stepKey === 'forecast') {
    if (!s.model || !s.date) return '';
    return `outputs/${s.model}/${H}/${s.date}/`;
  }
  if (stepKey === 'cycle') {
    if (!s.model || !s.date || !s.forecast) return '';
    return `outputs/${s.model}/${H}/${s.date}/${s.forecast}/`;
  }
  if (stepKey === 'ensemble') {
    if (!s.model || !s.date || s.forecast !== 'medium_range' || !s.cycle) return '';
    return `outputs/${s.model}/${H}/${s.date}/${s.forecast}/${s.cycle}/`;
  }

  // vpu base (depends on medium vs short)
  const vpuBase =
    s.forecast === 'medium_range'
      ? s.model && s.date && s.forecast && s.cycle && s.ensemble
        ? `outputs/${s.model}/${H}/${s.date}/${s.forecast}/${s.cycle}/${s.ensemble}/`
        : ''
      : s.model && s.date && s.forecast && s.cycle
        ? `outputs/${s.model}/${H}/${s.date}/${s.forecast}/${s.cycle}/`
        : '';

  if (stepKey === 'vpu') return vpuBase;

  if (stepKey === 'outputFile') {
    if (!vpuBase || !s.vpu) return '';
    return `${vpuBase}${s.vpu}/ngen-run/outputs/troute/`;
  }

  return '';
};
