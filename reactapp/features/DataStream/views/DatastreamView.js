import React,{ useEffect} from 'react';
import { MapContainer, ViewContainer } from 'features/DataStream/components/styles/Styles';
import { ToastContainer } from 'react-toastify';
import MapComponent from 'features/DataStream/components/map/Mapg.js';
import MainMenu from 'features/DataStream/components/menus/MainMenu';
import useDataStreamStore from 'features/DataStream/store/Datastream';
import useTimeSeriesStore from '../store/Timeseries';
import { useCacheTablesStore } from '../store/CacheTables';
import { useVPUStore, useFeatureStore } from '../store/Layers';
import useS3DataStreamBucketStore from 'features/DataStream/store/s3Store';
import { initialS3Data, makePrefix } from 'features/DataStream/lib/s3Utils';
import { getCacheKey } from 'features/DataStream/lib/opfsCache';
import { checkForTable, 
  loadVpuData, 
  getFeatureIDs, 
  getDistinctFeatureIds, 
  getDistinctTimes, 
  getVpuVariableFlat, 
  getVariables 
} from 'features/DataStream/lib/queryData';
import { terminateDatabase } from 'features/DataStream/lib/duckdbClient';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useShallow } from "zustand/react/shallow";

function InitialS3Loader() {
  const { vpu } = useDataStreamStore(
    useShallow((s) => ({
      vpu: s.vpu,
      ensemble: s.ensemble,
    }))
  );

  const { set_model, set_forecast, set_cycle, set_outputFile, set_date, set_ensemble, set_cache_key } = useDataStreamStore(
    useShallow((s) => ({
      set_model: s.set_model,
      set_forecast: s.set_forecast,
      set_cycle: s.set_cycle,
      set_outputFile: s.set_outputFile,
      set_date: s.set_date,
      set_ensemble: s.set_ensemble,
      set_cache_key: s.set_cache_key,
    }))
  );
  const { setInitialData } = useS3DataStreamBucketStore(
    useShallow((s) => ({ setInitialData: s.setInitialData }))
  );

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    async function fetchInitialData() {
      if (!vpu) return;
      try {
        const { models, dates, forecasts, cycles, ensembles, outputFiles } =
          await initialS3Data(vpu, { signal: controller.signal });

        if (!alive) return; // <- prevents any setState after unmount/dep change

        const _models = models.filter(m => m.value !== 'test');

        const cacheKey = getCacheKey(
          _models[0]?.value,
          dates[1]?.value,
          forecasts[0]?.value,
          cycles[0]?.value,
          ensembles[0]?.value || null,
          vpu,
          outputFiles[0]?.value
        );

        set_model(_models[0]?.value);
        set_forecast(forecasts[0]?.value);
        set_cycle(cycles[0]?.value);
        set_outputFile(outputFiles[0]?.value);
        set_date(dates[1]?.value);
        set_ensemble(ensembles[0]?.value || null);
        set_cache_key(cacheKey);

        const _prefix = makePrefix(
          _models[0]?.value,
          dates[1]?.value,
          forecasts[0]?.value,
          cycles[0]?.value,
          ensembles[0]?.value || null,
          vpu,
          outputFiles[0]?.value
        );

        setInitialData({
          models: _models,
          dates: dates,
          forecasts: forecasts,
          cycles: cycles,
          outputFiles: outputFiles,
          prefix: _prefix,
        });

      } catch (error) {
        if (error?.name === 'AbortError') return;
        console.error('Error fetching initial S3 data:', error);
      }
    }
    
    fetchInitialData();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [vpu]);

  return null;
}

export function TimeseriesLoader() {
  
  const { cacheKey, cache_request_id, vpu, set_variables } = useDataStreamStore(
    useShallow((s) => ({
      cacheKey: s.cache_key,
      cache_request_id: s.cache_request_id,
      vpu: s.vpu,
      set_variables: s.set_variables,
    }))
  );
  const { selected_feature_id } = useFeatureStore(
    useShallow((s) => ({
      selected_feature_id: s.selected_feature ? s.selected_feature._id : null,
    }))
  );

  const { add_cacheTable } = useCacheTablesStore(
    useShallow((s) => ({
      add_cacheTable: s.add_cacheTable,
    }))
  );
  
  const { prefix } = useS3DataStreamBucketStore(
    useShallow((s) => ({ prefix: s.prefix }))
  );

  const { variable, loadTimeseries, set_variable, set_loading_text, set_loading, reset } = useTimeSeriesStore(
    useShallow((s) => ({
      variable: s.variable,
      loadTimeseries: s.loadTimeseries,
      set_variable: s.set_variable,
      set_loading_text: s.set_loading_text,
      set_loading: s.set_loading,
      reset: s.reset,
    }))
  );
  const { set_feature_ids, setVarData, setAnimationIndex, resetVPU } = useVPUStore(
    useShallow((s) => ({
      set_feature_ids: s.set_feature_ids,
      setVarData: s.setVarData,
      setAnimationIndex: s.setAnimationIndex,
      resetVPU: s.resetVPU,
    }))
  );
  useEffect( () => {
   let alive = true;

   async function getVPUData(){
    if (!cacheKey) return;
    reset();
    resetVPU();
    // const vpu_gpkg = makeGpkgUrl(vpu);
    set_loading(true);
    set_loading_text('Loading feature properties...');
    let currentVariable = variable;
    try {
      const tableExists = await checkForTable(cacheKey);
      if (!alive) return;

      if (!tableExists) {
        try{
          // const fileSize = await loadVpuData(cacheKey, prefix, vpu_gpkg);
          const fileSize = await loadVpuData(cacheKey, prefix);
          if (!alive) return;
          add_cacheTable({id: cacheKey, name: cacheKey.replaceAll('_',' '), size: fileSize});
        }catch(err){
          if (!alive) return;
          console.error('No data for VPU', vpu, err);
          set_loading_text('No data available for selected VPU');
          return;
        }
      }
      const featureIDs = await getFeatureIDs(cacheKey);
      if (!alive) return;
      set_feature_ids(featureIDs);
      const variables = await getVariables({ cacheKey });
      if (!alive) return;
      set_variables(variables);
      set_variable(variables[0]);
      currentVariable = variables[0];
      const [featureIds, times, flat] = await Promise.all([
        getDistinctFeatureIds(cacheKey),
        getDistinctTimes(cacheKey),
        getVpuVariableFlat(cacheKey, currentVariable),
      ]);
      if (!alive) return;
      setAnimationIndex(featureIds, times);
      setVarData(currentVariable, flat);
      await loadTimeseries({ featureId: selected_feature_id });

      set_loading_text('');
    } 
    catch (err) {
        if (!alive) return;
        set_loading_text(`Failed to load VPU data for cacheKey: ${cacheKey}`);
        console.error('Failed to load VPU data for cacheKey:', cacheKey, err);
    } finally {
      // A plain if, not an early return: returning from finally discards any exception the
      // try or catch was in the middle of propagating.
      if (alive) set_loading(false);
    }
   }
   getVPUData();

   return () => {
    alive = false;
   };
    // Same reasoning as the timeseries effect: the counter makes a repeated request visible.
  }, [cacheKey, cache_request_id]);

  return null;
}


const DataStreamView = () => {
  useEffect(() => {
    return () => {
      void terminateDatabase().catch((err) => {
        console.warn('Failed to terminate DuckDB worker on DataStreamView unmount:', err);
      });
    };
  }, []);

  return (
    <ViewContainer>
      <InitialS3Loader />
      <TimeseriesLoader />
      <ToastContainer stacked  />
        <MapContainer>
          <MapComponent/>
        </MapContainer >
        <MainMenu/>
    </ViewContainer>
  );
};
export default DataStreamView;
