/**
 * Nothing ever evicted from the OPFS cache. The key is model x date x forecast x cycle x vpu x
 * file, so browsing accumulated parquets without limit across sessions. Measured sizes are about
 * 7 MB each against a 7.6 GB origin quota, so this is a cap for tidiness rather than a crisis --
 * but an unbounded cache with no eviction is still a leak.
 */
jest.mock('features/Tethys/services/api/app', () => ({ getArrowPerVpu: jest.fn() }));
jest.mock('apache-arrow', () => ({ tableFromIPC: jest.fn() }));
jest.mock('features/DataStream/lib/s3Utils', () => ({ getNCFiles: jest.fn() }));
jest.mock('@duckdb/duckdb-wasm', () => ({ DuckDBDataProtocol: { BROWSER_FSACCESS: 3 } }));
jest.mock('features/DataStream/lib/duckdbClient', () => ({
  getDuckDB: jest.fn(),
  getConnection: jest.fn(),
}));

const { getDuckDB, getConnection } = require('features/DataStream/lib/duckdbClient');

// jsdom has no OPFS, so this is the smallest directory handle the cache actually uses.
const fakeOpfs = (names) => {
  const files = new Map(names.map((n) => [encodeURIComponent(n), 1024]));
  const dir = {
    values: async function* () {
      for (const name of [...files.keys()]) {
        yield { kind: 'file', name, getFile: async () => ({ name, size: files.get(name) }) };
      }
    },
    getFileHandle: async (name) => {
      if (!files.has(name)) throw Object.assign(new Error('nf'), { name: 'NotFoundError' });
      return { getFile: async () => ({ name, size: files.get(name) }) };
    },
    removeEntry: async (name) => {
      if (!files.has(name)) throw Object.assign(new Error('nf'), { name: 'NotFoundError' });
      files.delete(name);
    },
  };
  navigator.storage = { getDirectory: async () => ({ getDirectoryHandle: async () => dir }) };
  return files;
};

const load = () => {
  let mod;
  jest.isolateModules(() => {
    // eslint-disable-next-line global-require
    mod = require('features/DataStream/lib/opfsCache');
  });
  return mod;
};

const vpuKeys = (n) => Array.from({ length: n }, (_, i) => `model_date_VPU_${i}_troute.parquet`);

beforeEach(() => {
  window.localStorage.clear();
  getDuckDB.mockResolvedValue({ dropFile: jest.fn(), dropFiles: jest.fn() });
  getConnection.mockResolvedValue({ query: jest.fn(), close: jest.fn() });
});

describe('getFilesFromCache', () => {
  it('does not offer the id index as something to delete', async () => {
    fakeOpfs(['index_data_table.parquet', 'model_date_VPU_1_troute.parquet']);
    const { getFilesFromCache } = load();

    const listed = await getFilesFromCache();

    // It is the app's own file: exempt from eviction, and deleting it only breaks search.
    expect(listed.map((f) => f.id)).toEqual(['model_date_VPU_1_troute.parquet']);
  });

  it('still lists the vpu parquets the user chose to load', async () => {
    fakeOpfs(vpuKeys(3));
    const { getFilesFromCache } = load();

    expect(await getFilesFromCache()).toHaveLength(3);
  });
});

describe('pruneCache', () => {
  it('leaves the cache alone while it is within the cap', async () => {
    const files = fakeOpfs(vpuKeys(10));
    const { pruneCache } = load();

    expect(await pruneCache()).toEqual([]);
    expect(files.size).toBe(10);
  });

  it('evicts down to the cap once it is exceeded', async () => {
    const files = fakeOpfs(vpuKeys(13));
    const { pruneCache } = load();

    const evicted = await pruneCache();

    expect(evicted).toHaveLength(3);
    expect(files.size).toBe(10);
  });

  it('evicts the least recently used, not whatever the directory lists first', async () => {
    const keys = vpuKeys(12);
    fakeOpfs(keys);
    const { pruneCache, noteCacheUse } = load();

    // The last two are never used; directory order would wrongly take the first two.
    for (const key of keys.slice(0, 10)) noteCacheUse(key);

    expect(await pruneCache()).toEqual([keys[10], keys[11]]);
  });

  it('evicts in reverse of use when use is the reverse of listing order', async () => {
    const keys = vpuKeys(12);
    fakeOpfs(keys);
    const { pruneCache, noteCacheUse } = load();

    // Used newest-first, so the earliest-listed files are the least recently used.
    for (const key of [...keys].reverse()) noteCacheUse(key);

    expect(await pruneCache()).toEqual([keys[11], keys[10]]);
  });

  it('never evicts the id index, however old it is', async () => {
    const keys = ['index_data_table.parquet', ...vpuKeys(12)];
    const files = fakeOpfs(keys);
    const { pruneCache, noteCacheUse } = load();
    for (const key of keys.slice(1)) noteCacheUse(key);

    const evicted = await pruneCache();

    // The index is exempt, so the cap applies to the other twelve alone.
    expect(evicted).not.toContain('index_data_table.parquet');
    expect(files.has(encodeURIComponent('index_data_table.parquet'))).toBe(true);
    expect(evicted).toHaveLength(2);
  });

  it('drops each evicted file from duckdb before removing it', async () => {
    fakeOpfs(vpuKeys(11));
    const dropFile = jest.fn();
    getDuckDB.mockResolvedValue({ dropFile, dropFiles: jest.fn() });
    const { pruneCache } = load();

    await pruneCache();

    // Without this the browser refuses the removal, which is the delete bug all over again.
    expect(dropFile).toHaveBeenCalledTimes(1);
    expect(dropFile.mock.calls[0][0]).toMatch(/^nrds-cache\//);
  });

  it('drops the table for an evicted file too', async () => {
    fakeOpfs(vpuKeys(11));
    const query = jest.fn();
    getConnection.mockResolvedValue({ query, close: jest.fn() });
    const { pruneCache } = load();

    await pruneCache();

    // Named without the extension, as the table was created.
    expect(query).toHaveBeenCalledWith(expect.stringMatching(/DROP TABLE IF EXISTS "model_date_VPU_\d+_troute"/));
  });

  it('forgets evicted keys so the record does not grow forever', async () => {
    const keys = vpuKeys(12);
    fakeOpfs(keys);
    const { pruneCache, noteCacheUse } = load();
    for (const key of keys) noteCacheUse(key);

    await pruneCache();

    const remembered = JSON.parse(window.localStorage.getItem('nrds-cache-recency'));
    expect(remembered).toHaveLength(10);
  });

  it('does nothing where OPFS is unavailable', async () => {
    delete navigator.storage;
    const { pruneCache } = load();

    expect(await pruneCache()).toEqual([]);
  });
});
