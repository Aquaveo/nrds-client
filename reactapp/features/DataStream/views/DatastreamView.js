import React,{ useEffect} from 'react';
import { MapContainer, ViewContainer } from 'features/DataStream/components/styles/Styles';
import { ToastContainer } from 'react-toastify';
import MapComponent from 'features/DataStream/components/map/Mapg.js';
import MainMenu from 'features/DataStream/components/menus/MainMenu';
import useDataStreamStore from 'features/DataStream/store/Datastream';
import useTimeSeriesStore from '../store/Timeseries';
import { useCacheTablesStore } from '../store/CacheTables';
import { useVPUStore } from '../store/Layers';
import useS3DataStreamBucketStore from 'features/DataStream/store/s3Store';
import { initialS3Data, makePrefix, makeGpkgUrl } from 'features/DataStream/lib/s3Utils';
import { getCacheKey } from 'features/DataStream/lib/opfsCache';
import { checkForTable, 
  getTimeseries, 
  loadVpuData, 
  getFeatureIDs, 
  getDistinctFeatureIds, 
  getDistinctTimes, 
  getVpuVariableFlat, 
  getVariables 
} from 'features/DataStream/lib/queryData';
import { makeTitle } from 'features/DataStream/lib/utils';
import 'maplibre-gl/dist/maplibre-gl.css';


const DataStreamView = () => {
  const vpu = useDataStreamStore((state) => state.vpu);
  const cacheKey = useDataStreamStore((state) => state.cache_key);
  const ensemble = useDataStreamStore((state) => state.ensemble);
  const outputFile = useDataStreamStore((state) => state.outputFile);
  const forecast = useDataStreamStore((state) => state.forecast);


  const setAllState = useDataStreamStore((state) => state.setAllState);
  
  const set_variables = useDataStreamStore((state) => state.set_variables);
  
  const prefix = useS3DataStreamBucketStore((state) => state.prefix);
  const setInitialData = useS3DataStreamBucketStore((state) => state.setInitialData);
  
  const set_feature_ids = useVPUStore((state) => state.set_feature_ids);
  const setVarData = useVPUStore((state) => state.setVarData);

  const feature_id = useTimeSeriesStore((state) => state.feature_id);
  const loading = useTimeSeriesStore((state) => state.loading);
  const variable = useTimeSeriesStore((state) => state.variable);
  const set_variable = useTimeSeriesStore((state) => state.set_variable);
  const set_loading_text = useTimeSeriesStore((state) => state.set_loading_text);
  const set_series = useTimeSeriesStore((state) => state.set_series);
  const set_layout = useTimeSeriesStore((state) => state.set_layout);
  const setLoading = useTimeSeriesStore((state) => state.set_loading);  
  const setAnimationIndex = useVPUStore((state) => state.setAnimationIndex);
  
  const add_cacheTable = useCacheTablesStore((state) => state.add_cacheTable);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    async function fetchInitialData() {
      if (!vpu) return;
      try {
        const { models, dates, forecasts, cycles, outputFiles } =
          await initialS3Data(vpu, { signal: controller.signal });

        if (!alive) return; // <- prevents any setState after unmount/dep change

        const _models = models.filter(m => m.value !== 'test');

        const cacheKey = getCacheKey(
          _models[0]?.value,
          dates[1]?.value,
          forecasts[0]?.value,
          cycles[0]?.value,
          ensemble,
          vpu,
          outputFiles[0]?.value
        );

        setAllState({
          model: _models[0]?.value,
          date: dates[1]?.value,
          forecast: forecasts[0]?.value,
          cycle: cycles[0]?.value,
          ensemble: null,
          outputFile: outputFiles[0]?.value,
          cache_key: cacheKey,
        });

        const _prefix = makePrefix(
          _models[0]?.value,
          dates[1]?.value,
          forecasts[0]?.value,
          cycles[0]?.value,
          ensemble,
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
        // fetch abort throws DOMException with name AbortError
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

  useEffect( () => {   
   async function getData(){
    if (!outputFile || loading || !feature_id ) return;
    const vpu_gpkg = makeGpkgUrl(vpu);
    const id = feature_id.split('-')[1];
    setLoading(true);
    set_loading_text('Loading feature properties...');
    let currentVariable = variable;
    try {
      const tableExists = await checkForTable(cacheKey);
      if (!tableExists) {
        console.log('Loading VPU data for cacheKey:', cacheKey);
        try{
          await loadVpuData(cacheKey, prefix, vpu_gpkg);
          add_cacheTable({id: cacheKey, name: cacheKey.replaceAll('_',' ')});
        }catch(err){
          console.error('No data for VPU', vpu, err);
          set_loading_text('No data available for selected VPU');
          setLoading(false);
        }        
        const featureIDs = await getFeatureIDs(cacheKey);
        set_feature_ids(featureIDs);
        const variables = await getVariables({ cacheKey });
        set_variables(variables);
        set_variable(variables[0]);
        currentVariable = variables[0];
        const [featureIds, times, flat] = await Promise.all([
          getDistinctFeatureIds(cacheKey),
          getDistinctTimes(cacheKey),
          getVpuVariableFlat(cacheKey, variables[0]),
        ]);
        setAnimationIndex(featureIds, times);
        setVarData(variables[0], flat);
     }
      const series = await getTimeseries(id, cacheKey, currentVariable);
      const xy = series.map((d) => ({
        x: new Date(d.time),
        y: d[currentVariable],
      }));
      set_loading_text(`Loaded ${xy.length} points for id: ${id}`);
      set_series(xy);
      set_layout({
        yaxis: currentVariable,
        xaxis: '',
        title: makeTitle(forecast, feature_id),
      });
     set_loading_text('');
      setLoading(false);
    } 
    catch (err) {
        set_loading_text(`Failed to load timeseries for id: ${id}`);
        setLoading(false);
        console.error('Failed to load timeseries for', id, err);
    }
   }
   getData();

  }, [cacheKey, feature_id]);

  return (
    <ViewContainer>
            <ToastContainer stacked  />
            <MapContainer>
              <MapComponent/>
            </MapContainer >
            <MainMenu/>
    </ViewContainer>
  );
};
DataStreamView.whyDidYouRender = true;
export default DataStreamView;
