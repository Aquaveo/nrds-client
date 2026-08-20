import React, { useMemo, Fragment, useCallback, useRef } from 'react';
import { Row, IconLabel } from '../styles/Styles';
import SelectComponent from '../SelectComponent';
import { getVpuVariableFlat } from 'features/DataStream/lib/queryData';
import useTimeSeriesStore from 'features/DataStream/store/Timeseries';
import { loadTimeseries } from 'features/DataStream/actions/loadTimeseries';
import useDataStreamStore from 'features/DataStream/store/Datastream';
import { useVPUStore } from 'features/DataStream/store/Layers';
import { useShallow } from 'zustand/react/shallow';
import {
  VariableIcon,
} from 'features/DataStream/lib/layers';

function VariablesMenu() {
  // No mounted flag: these writes all go to stores, so requestIdRef alone keeps ordering.
  const requestIdRef = useRef(0);

  const{ variables, cacheKey } = useDataStreamStore(
    useShallow((state) => ({
      variables: state.variables,
      cacheKey: state.cache_key,
    }))
  );
  
  const { variable, set_variable, set_loading_text, feature_id } = useTimeSeriesStore(
    useShallow((state) => ({
      variable: state.variable,
      set_variable: state.set_variable,
      set_loading_text: state.set_loading_text,
      feature_id: state.feature_id,
    }))
  );

  const { setVarData } = useVPUStore(
    useShallow((s) => ({
      setVarData: s.setVarData,
    }))
  );

  const availableVariablesList = useMemo(() => {
    return variables.map((v) => ({ value: v, label: v }));
  }, [variables]);

  const selectedVariableOption = useMemo(() => {
    const opts = availableVariablesList || [];
    return opts.find((opt) => opt.value === variable) ?? null;
  }
  , [variables, variable]);

  const handleChangeVariable = useCallback(async (evt) => {
    const opt = evt || availableVariablesList?.[0];
    if (!opt || !feature_id) return;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const requestCacheKey = cacheKey;

    try {
      // Reusing the vpu store's cached array skips a query measured at about 800 ms.
      const cached = useVPUStore.getState().getVarData(opt.value);

      // Both start together; the variable is set last so the layer never reads absent values.
      const [flat] = await Promise.all([
        cached ?? getVpuVariableFlat(requestCacheKey, opt.value),
        loadTimeseries({ variable: opt.value }),
      ]);
      if (requestId !== requestIdRef.current) return;
      if (useDataStreamStore.getState().cache_key !== requestCacheKey) return;
      // The vpu moved on while this was in flight, so these values describe a table that is
      // no longer loaded. valuesByVar is keyed by variable alone and would not show the swap.
      setVarData(opt.value, flat);
      set_variable(opt.value);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      // Say so: the chart may already have changed underneath, and silence here is what made
      // the map and the chart disagree with nothing on screen to explain it.
      set_loading_text(`Failed to load ${opt.value} for the map`);
      console.error('Failed to change variable', err);
    }
  }, [
    availableVariablesList,
    cacheKey,
    feature_id,
    setVarData,
    set_variable,
    set_loading_text,
  ]);

  return (
    <Fragment>
         { availableVariablesList.length > 0 && (
          <Row>
            <IconLabel> <VariableIcon /> Variable</IconLabel>
            <SelectComponent
              optionsList={availableVariablesList}
              value={selectedVariableOption}
              onChangeHandler={handleChangeVariable}
            />
          </Row>
        )}
    </Fragment>
  );
}


export default React.memo(VariablesMenu);
