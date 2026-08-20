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
  
  const { variable, set_variable, feature_id } = useTimeSeriesStore(
    useShallow((state) => ({
      variable: state.variable,
      set_variable: state.set_variable,
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

    try {
      // Reusing the vpu store's cached array skips a query measured at about 800 ms.
      const cached = useVPUStore.getState().getVarData(opt.value);

      // Both start together; the variable is set last so the layer never reads absent values.
      const [flat] = await Promise.all([
        cached ?? getVpuVariableFlat(cacheKey, opt.value),
        loadTimeseries({ variable: opt.value }),
      ]);
      if (requestId !== requestIdRef.current) return;
      setVarData(opt.value, flat);
      set_variable(opt.value);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.error('Failed to change variable', err);
    }
  }, [
    availableVariablesList,
    cacheKey,
    feature_id,
    setVarData,
    set_variable,
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
