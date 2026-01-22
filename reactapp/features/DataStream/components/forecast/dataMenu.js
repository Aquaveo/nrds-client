import React, { useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { Spinner } from 'react-bootstrap';
import { XButton, LoadingMessage, Row, IconLabel } from '../styles/Styles';
import SelectComponent from '../SelectComponent';
import { toast } from 'react-toastify';

import { loadVpuData, getVariables, getTimeseries, checkForTable } from 'features/DataStream/lib/queryData';
import { makeGpkgUrl, getOptionsFromURL } from 'features/DataStream/lib/s3Utils';
import { getCacheKey } from 'features/DataStream/lib/opfsCache';
import useTimeSeriesStore from 'features/DataStream/store/Timeseries';
import useDataStreamStore from 'features/DataStream/store/Datastream';
import { makeTitle } from 'features/DataStream/lib/utils';

import {
  ModelIcon,
  DateIcon,
  ForecastIcon,
  CycleIcon,
  EnsembleIcon,
  VariableIcon,
} from 'features/DataStream/lib/layers';

const firstOpt = (v) => (Array.isArray(v) ? v[0] : v);

const pickDefault = (opts, { index = 0, preferValue } = {}) => {
  if (!Array.isArray(opts) || opts.length === 0) return null;
  if (preferValue) {
    const found = opts.find((o) => o.value === preferValue);
    if (found) return found;
  }
  const safe = Math.min(Math.max(index, 0), opts.length - 1);
  return opts[safe] ?? opts[0] ?? null;
};

const findSelected = (opts, value) => opts.find((o) => o.value === value) ?? null;

export default function DataMenu() {
  // ─────────────────────────────────────
  // Stores
  // ─────────────────────────────────────
  const vpu = useDataStreamStore((s) => s.vpu);
  const model = useDataStreamStore((s) => s.model);
  const date = useDataStreamStore((s) => s.date);
  const forecast = useDataStreamStore((s) => s.forecast);
  const cycle = useDataStreamStore((s) => s.cycle);
  const ensemble = useDataStreamStore((s) => s.ensemble);
  const variables = useDataStreamStore((s) => s.variables);

  const set_model = useDataStreamStore((s) => s.set_model);
  const set_date = useDataStreamStore((s) => s.set_date);
  const set_forecast = useDataStreamStore((s) => s.set_forecast);
  const set_cycle = useDataStreamStore((s) => s.set_cycle);
  const set_ensemble = useDataStreamStore((s) => s.set_ensemble);
  const set_vpu = useDataStreamStore((s) => s.set_vpu);
  const set_variables = useDataStreamStore((s) => s.set_variables);

  const variable = useTimeSeriesStore((s) => s.variable);
  const set_variable = useTimeSeriesStore((s) => s.set_variable);
  const set_series = useTimeSeriesStore((s) => s.set_series);
  const set_table = useTimeSeriesStore((s) => s.set_table);
  const set_layout = useTimeSeriesStore((s) => s.set_layout);
  const feature_id = useTimeSeriesStore((s) => s.feature_id);
  const loading = useTimeSeriesStore((s) => s.loading);
  const setLoading = useTimeSeriesStore((s) => s.set_loading);

  const [loadingText, setLoadingText] = useState('');
  const [modelsList, setModelsList] = useState([]);
  const [datesList, setDatesList] = useState([]);
  const [forecastList, setForecastList] = useState([]);
  const [cyclesList, setCyclesList] = useState([]);
  const [ensembleList, setEnsembleList] = useState([]);
  const [vpuList, setVpuList] = useState([]);
  const [outputFilesList, setOutputFilesList] = useState([]);
  const [outputFile, setOutputFile] = useState('');
  const [activeStepKey, setActiveStepKey] = useState('model');

  const didBootstrapRef = useRef(false);
  const isMedium = forecast === 'medium_range';

  const fetchOpts = useCallback(async (path) => {
    const opts = await getOptionsFromURL(path);
    return Array.isArray(opts) ? opts : [];
  }, []);



  const vpuBasePath = useMemo(() => {
    if (!model || !date || !forecast || !cycle) return '';
    if (forecast === 'medium_range') {
      if (!ensemble) return '';
      return `outputs/${model}/v2.2_hydrofabric/${date}/${forecast}/${cycle}/${ensemble}/`;
    }
    return `outputs/${model}/v2.2_hydrofabric/${date}/${forecast}/${cycle}/`;
  }, [model, date, forecast, cycle, ensemble]);

  const troutePath = useMemo(() => {
    if (!vpuBasePath || !vpu) return '';
    return `${vpuBasePath}${vpu}/ngen-run/outputs/troute/`;
  }, [vpuBasePath, vpu]);
  const availableVariablesList = useMemo(
    () => (variables || []).map((vv) => ({ value: vv, label: vv })),
    [variables]
  );


  const steps = useMemo(() => {
    const modelStep = {
      key: 'model',
      label: 'Model',
      icon: <ModelIcon />,
      options: modelsList,
      selected: findSelected(modelsList, model),
      enabled: modelsList.length > 0,
      onChange: async (v) => {
        const opt = firstOpt(v);
        if (!opt) return;

        set_model(opt.value);
        resetFromKey('model', { includeSelf: false });
        setActiveStepKey('date');

        const dOpts = await fetchOpts(`outputs/${opt.value}/v2.2_hydrofabric/`);
        setDatesList(dOpts);
      },
    };

    const dateStep = {
      key: 'date',
      label: 'Date',
      icon: <DateIcon />,
      options: datesList,
      selected: findSelected(datesList, date),
      enabled: !!model && datesList.length > 0,
      onChange: async (v) => {
        const opt = firstOpt(v);
        if (!opt) return;

        set_date(opt.value);
        resetFromKey('date', { includeSelf: false });
        setActiveStepKey('forecast');

        const fOpts = await fetchOpts(`outputs/${model}/v2.2_hydrofabric/${opt.value}/`);
        setForecastList(fOpts);
      },
    };

    const forecastStep = {
      key: 'forecast',
      label: 'Forecast',
      icon: <ForecastIcon />,
      options: forecastList,
      selected: findSelected(forecastList, forecast),
      enabled: !!model && !!date && forecastList.length > 0,
      onChange: async (v) => {
        const opt = firstOpt(v);
        if (!opt) return;

        set_forecast(opt.value);
        resetFromKey('forecast', { includeSelf: false });
        setActiveStepKey('cycle');

        const cOpts = await fetchOpts(`outputs/${model}/v2.2_hydrofabric/${date}/${opt.value}/`);
        setCyclesList(cOpts);
      },
    };

    const cycleStep = {
      key: 'cycle',
      label: 'Cycle',
      icon: <CycleIcon />,
      options: cyclesList,
      selected: findSelected(cyclesList, cycle),
      enabled: !!model && !!date && !!forecast && cyclesList.length > 0,
      onChange: async (v) => {
        const opt = firstOpt(v);
        if (!opt) return;

        set_cycle(opt.value);
        resetFromKey('cycle', { includeSelf: false });

        if (forecast === 'medium_range') {
          setActiveStepKey('ensemble');
          const eOpts = await fetchOpts(`outputs/${model}/v2.2_hydrofabric/${date}/${forecast}/${opt.value}/`);
          setEnsembleList(eOpts);
        } else {
          set_ensemble(null);
          setEnsembleList([]);
          setActiveStepKey('vpu');

          const vOpts = await fetchOpts(`outputs/${model}/v2.2_hydrofabric/${date}/${forecast}/${opt.value}/`);
          setVpuList(vOpts);
        }
      },
    };

    const ensembleStep = {
      key: 'ensemble',
      label: 'Ensemble',
      icon: <EnsembleIcon />,
      options: ensembleList,
      selected: findSelected(ensembleList, ensemble),
      enabled: isMedium && !!model && !!date && !!forecast && !!cycle && ensembleList.length > 0,
      onChange: async (v) => {
        const opt = firstOpt(v);
        if (!opt) return;

        set_ensemble(opt.value);
        resetFromKey('ensemble', { includeSelf: false });

        setActiveStepKey('vpu');
        const vOpts = await fetchOpts(
          `outputs/${model}/v2.2_hydrofabric/${date}/${forecast}/${cycle}/${opt.value}/`
        );
        setVpuList(vOpts);
      },
    };

    const vpuStep = {
      key: 'vpu',
      label: 'VPU',
      icon: <EnsembleIcon />,
      options: vpuList,
      selected: findSelected(vpuList, vpu),
      enabled: !!vpuBasePath && vpuList.length > 0,
      onChange: async (v) => {
        const opt = firstOpt(v);
        if (!opt) return;

        set_vpu(opt.value);
        resetFromKey('vpu', { includeSelf: false });

        setActiveStepKey('outputFile');
        const files = await fetchOpts(`${vpuBasePath}${opt.value}/ngen-run/outputs/troute/`);
        setOutputFilesList(files);
      },
    };

    const outputFileStep = {
      key: 'outputFile',
      label: 'Output File',
      icon: <VariableIcon />,
      options: outputFilesList,
      selected: findSelected(outputFilesList, outputFile),
      enabled: !!troutePath && outputFilesList.length > 0,
      onChange: (v) => {
        const opt = firstOpt(v);
        if (!opt) return;
        setOutputFile(opt.value);
      },
    };

    const arr = [modelStep, dateStep, forecastStep, cycleStep];
    if (isMedium) arr.push(ensembleStep);
    arr.push(vpuStep, outputFileStep);

    if (availableVariablesList.length > 0) {
      arr.push({
        key: 'variable',
        label: 'Variable',
        icon: <VariableIcon />,
        options: availableVariablesList,
        selected: findSelected(availableVariablesList, variable),
        enabled: true,
        onChange: (v) => {
          const opt = firstOpt(v);
          if (!opt) return;
          set_variable(opt.value);
        },
      });
    }

    return arr;
  }, [
    modelsList,
    datesList,
    forecastList,
    cyclesList,
    ensembleList,
    vpuList,
    outputFilesList,
    model,
    date,
    forecast,
    cycle,
    ensemble,
    vpu,
    outputFile,
    isMedium,
    vpuBasePath,
    troutePath,
    availableVariablesList,
    variable,
    fetchOpts,
    set_model,
    set_date,
    set_forecast,
    set_cycle,
    set_ensemble,
    set_vpu,
    set_variable,
    resetFromKey,
  ]);

  const activeStep = steps.find((s) => s.key === activeStepKey) ?? steps[0];

  return (
    <Fragment>
      {/* Breadcrumb */}
      <div style={{ fontFamily: 'monospace', fontSize: 12, padding: '6px 10px', borderRadius: 6 }}>
        {breadcrumbSegments.map((seg, i) => (
          <span key={`${seg.label}-${i}`}>
            {i > 0 ? ' / ' : ''}
            <button
              type="button"
              onClick={() => handleBreadcrumbClick(seg)}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                textDecoration: 'underline',
                fontFamily: 'inherit',
                fontSize: 'inherit',
              }}
              title="Click to jump"
            >
              {seg.label}
            </button>
          </span>
        ))}
        <span> /</span>
      </div>

      {/* Single active dropdown */}
      <Row>
        <IconLabel>
          {activeStep.icon} {activeStep.label}
        </IconLabel>
        <SelectComponent
          optionsList={activeStep.options}
          value={activeStep.selected}
          onChangeHandler={activeStep.onChange}
          width={240}
        />
      </Row>

      <div style={{ marginTop: '10px', paddingLeft: '100px', paddingRight: '100px' }}>
        <XButton onClick={handleVisulization}>Update</XButton>
      </div>

      <LoadingMessage>
        {loading && (
          <>
            <Spinner as="span" size="sm" animation="border" role="status" aria-hidden="true" />
            &nbsp; {loadingText}
          </>
        )}
      </LoadingMessage>
    </Fragment>
  );
}