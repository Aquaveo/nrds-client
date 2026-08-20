/**
 * Only the outputFiles listing depends on the vpu, but the effect that calls initialS3Data
 * re-runs on every vpu change, so it used to refetch all five listings each time. These
 * tests hold it to one request per subsequent vpu, and check that an incomplete listing is
 * not remembered.
 */
const requestedPrefix = (url) => decodeURIComponent(new URL(url).searchParams.get('prefix'));

const directoryXml = (prefix, children) => `<?xml version="1.0"?>
<ListBucketResult>${children
  .map((c) => `<CommonPrefixes><Prefix>${prefix}${c}/</Prefix></CommonPrefixes>`)
  .join('')}</ListBucketResult>`;

const fileXml = (prefix, keys) => `<?xml version="1.0"?>
<ListBucketResult>${keys
  .map((k) => `<Contents><Key>${prefix}${k}</Key></Contents>`)
  .join('')}</ListBucketResult>`;

// Two children at every level, because the date list is read at index 1.
const respondWith = (children = ['aa', 'bb']) =>
  jest.fn(async (url) => {
    const prefix = requestedPrefix(url);
    const body = prefix.includes('troute')
      ? fileXml(prefix, ['troute_output.parquet'])
      : directoryXml(prefix, children);
    return { ok: true, status: 200, statusText: 'OK', text: async () => body };
  });

const loadModule = () => {
  let mod;
  jest.isolateModules(() => {
    // eslint-disable-next-line global-require
    mod = require('features/DataStream/lib/s3Utils');
  });
  return mod;
};

describe('initialS3Data', () => {
  it('fetches every listing on the first call', async () => {
    global.fetch = respondWith();
    const { initialS3Data } = loadModule();

    const result = await initialS3Data('16');

    expect(global.fetch).toHaveBeenCalledTimes(5);
    expect(result.models.map((m) => m.value)).toEqual(['aa', 'bb']);
    expect(result.outputFiles.map((f) => f.value)).toEqual(['troute_output.parquet']);
  });

  it('refetches only the vpu-dependent listing on a later vpu', async () => {
    global.fetch = respondWith();
    const { initialS3Data } = loadModule();

    await initialS3Data('16');
    global.fetch.mockClear();

    const result = await initialS3Data('01');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(requestedPrefix(global.fetch.mock.calls[0][0])).toContain('/01/');
    // The reused listings are still reported to the caller.
    expect(result.models.map((m) => m.value)).toEqual(['aa', 'bb']);
    expect(result.cycles.length).toBe(2);
  });

  it('does not remember an incomplete listing', async () => {
    global.fetch = jest.fn(async (url) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => directoryXml(requestedPrefix(url), []),
    }));
    const { initialS3Data } = loadModule();

    const first = await initialS3Data('16');
    expect(first.models).toEqual([]);
    const callsAfterFirst = global.fetch.mock.calls.length;

    // An empty bucket listing is a transient condition, so it must be retried, not cached.
    await initialS3Data('16');
    expect(global.fetch.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('caches the base listings even when first called without a vpu', async () => {
    global.fetch = respondWith();
    const { initialS3Data } = loadModule();
    await initialS3Data(null);

    global.fetch.mockClear();
    const result = await initialS3Data('16');

    // The base was complete, so only the vpu listing is needed.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.outputFiles.length).toBe(1);
  });
});
