export async function listPublicS3Directories(prefix = "v2.2/", { signal } = {}) {
  const bucket = "ciroh-community-ngen-datastream";

  // Ensure trailing slash
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;

  // S3 ListObjectsV2 with delimiter to get "folders"
  const url =
    `https://${bucket}.s3.us-east-1.amazonaws.com/` +
    `?list-type=2&prefix=${encodeURIComponent(normalizedPrefix)}` +
    `&delimiter=/`;

  const resp = await fetch(url, { signal });
  if (!resp.ok) {
    throw new Error(`S3 list error: ${resp.status} ${resp.statusText}`);
  }

  const xml = await resp.text();

  // Parse XML and extract CommonPrefixes/Prefix
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");

  const prefixNodes = [...doc.getElementsByTagName("CommonPrefixes")];

  // Full prefixes from S3, e.g. "v2.2/ngen.20251121/short_range/"
  const fullPrefixes = prefixNodes
    .map((node) => node.getElementsByTagName("Prefix")[0]?.textContent)
    .filter(Boolean);

  // If you only want the "child" folder names (e.g. just "ngen.20251121"):
  const childNames = fullPrefixes.map((p) =>
    p
      .slice(normalizedPrefix.length) // remove base prefix
      .replace(/\/$/, "")            // trim trailing slash
  );

  return { fullPrefixes, childNames };
}

export async function listPublicS3Files(prefix = "v2.2/", { signal } = {}) {
    const bucket = "ciroh-community-ngen-datastream";
    const url =
        `https://${bucket}.s3.us-east-1.amazonaws.com` +
        `/?list-type=2&prefix=${encodeURIComponent(prefix)}`;


    const resp = await fetch(url,{ signal });
    if (!resp.ok) {
        throw new Error(`S3 list error: ${resp.status} ${resp.statusText}`);
    }
    const xml = await resp.text();

    // parse XML -> extract <Key> elements
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");
    const contents = [...doc.getElementsByTagName("Contents")];
    return contents.map(node => node.getElementsByTagName("Key")[0].textContent);
}

export async function getOptionsFromURL(url, { signal } = {}) {
  try{
    if (url.split('/').includes('troute')){
      const files = await listPublicS3Files(url, { signal });
      const ncFiles = files.filter(f => f.endsWith('.nc') || f.endsWith('.parquet'));
      // const ncFilesParsed = ncFiles.map(f => `s3://ciroh-community-ngen-datastream/${f}`);
      const options = ncFiles.map((d) => ({ value: d.split('/').pop(), label: d.split('/').pop() }));
      const sortedOptions = Array.from(options).sort().reverse();
      return sortedOptions;
    }
    const { childNames } = await listPublicS3Directories(url, { signal });
    const options = childNames.map((d) => ({ value: d, label: d }));
    const sortedOptions = Array.from(options).sort();
    return sortedOptions;
  }catch(error){
    return [];
  }

}

export const makePrefix = (model, avail_date,ngen_forecast,ngen_cycle, ngen_ensemble, ngen_vpu, outputFile) => {
    let prefix_path = `outputs/${model}/v2.2_hydrofabric/${avail_date}/${ngen_forecast}/${ngen_cycle}`
    let ensemble_path = ngen_ensemble ? `${ngen_ensemble}/` : '';
    prefix_path = `${prefix_path}/${ensemble_path}${ngen_vpu}/ngen-run/outputs/troute/${outputFile}`;
    return prefix_path;
}

export function getNCFiles(prefix) {
    const ncFileParsed = `s3://ciroh-community-ngen-datastream/${prefix}`;
    return ncFileParsed
}

export const makeGpkgUrl = (vpu) => {
    const vpu_gpkg = `s3://ciroh-community-ngen-datastream/resources/v2.2_hydrofabric/geopackages/${vpu}/nextgen_${vpu}.gpkg`;
    return vpu_gpkg;
}

// Only the outputFiles listing depends on the vpu, but the effect calling initialS3Data
// re-runs whenever the vpu changes, so all five listings were refetched every time. This
// holds the four vpu-independent ones for the life of the page, making a vpu change cost one
// request instead of five. Cached only when the chain completed, so an empty or failed
// listing is retried rather than remembered. A reload picks up newly published dates.
let cachedBaseOptions = null;

const loadBaseOptions = async ({ signal }) => {
  const _models = await getOptionsFromURL(`outputs`, { signal });
  if (_models.length === 0){
    return {models: [], dates: [], forecasts: [], cycles: []};
  }
  const models = _models.filter(m => m.value !== 'test');
  const dates = (await getOptionsFromURL(`outputs/${models[0]?.value}/v2.2_hydrofabric/`, { signal })).reverse();
  if (dates.length === 0){
    return {models, dates: [], forecasts: [], cycles: []};
  }
  const forecasts = (await getOptionsFromURL(`outputs/${models[0]?.value}/v2.2_hydrofabric/${dates[1]?.value}/`, { signal })).reverse();
  if (forecasts.length === 0){
    return {models, dates, forecasts: [], cycles: []};
  }
  const cycles = await getOptionsFromURL(`outputs/${models[0]?.value}/v2.2_hydrofabric/${dates[1]?.value}/${forecasts[0]?.value}/`, { signal });
  return {models, dates, forecasts, cycles};
}

export const initialS3Data = async(vpu, { signal } = {}) => {
  const base = cachedBaseOptions ?? await loadBaseOptions({ signal });
  const {models, dates, forecasts, cycles} = base;
  if (models.length === 0){
    return {models: [], dates: [], forecasts: [], cycles: [], ensembles: [], outputFiles: []};
  }
  if (dates.length === 0){
    return {models, dates: [], forecasts: [], cycles: [], ensembles:[], outputFiles: []};
  }
  if (forecasts.length === 0){
    return {models, dates, forecasts: [], cycles: [], ensembles:[], outputFiles: []};
  }
  if (cycles.length === 0){
    return {models, dates, forecasts, cycles: [], ensembles:[], outputFiles: []};
  }
  cachedBaseOptions = base;
  if (!vpu) {
    return {models, dates, forecasts, cycles, ensembles:[], outputFiles: []};
  }
  const outputFiles = await getOptionsFromURL(`outputs/${models[0]?.value}/v2.2_hydrofabric/${dates[1]?.value}/${forecasts[0]?.value}/${cycles[0]?.value}/${vpu}/ngen-run/outputs/troute/`, { signal });
  return {models, dates, forecasts, cycles, ensembles:[], outputFiles};
}

