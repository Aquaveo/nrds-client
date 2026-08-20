import React,{ useEffect} from 'react';
import { MapContainer, ViewContainer } from 'features/DataStream/components/styles/Styles';
import { ToastContainer } from 'react-toastify';
import MapComponent from 'features/DataStream/components/map/Mapg.js';
import MainMenu from 'features/DataStream/components/menus/MainMenu';
import useDataStreamStore from 'features/DataStream/store/Datastream';
import useS3DataStreamBucketStore from 'features/DataStream/store/s3Store';
import { initialS3Data, makePrefix } from 'features/DataStream/lib/s3Utils';
import { getCacheKey } from 'features/DataStream/lib/opfsCache';
import { terminateDatabase } from 'features/DataStream/lib/duckdbClient';
import { loadVpu } from 'features/DataStream/actions/loadVpu';
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

        // Explicit, so the vpu load is no longer a second effect reacting to cache_key.
        await loadVpu();

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
      <ToastContainer stacked  />
        <MapContainer>
          <MapComponent/>
        </MapContainer >
        <MainMenu/>
    </ViewContainer>
  );
};
export default DataStreamView;
