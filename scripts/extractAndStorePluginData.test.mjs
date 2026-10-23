import assert from 'node:assert/strict';
import test from 'node:test';

import { addGithubStars, assertDiscoveryComplete, discoverHomebridgePlugins, extractGithubRepo, getDownloadMetrics, getHomebridgeNamedPackages, getHomebridgePlugins, getNpmLastWeekDownloads, getReleaseDownloads, hasHomebridgePluginKeyword, resolveRepository, searchHomebridgePlugins, selectHomebridgePlugins } from './extractAndStorePluginData.mjs';
import { getPluginTransport } from '../vue-data-analyzer/src/pluginTransports.js';

test('extractGithubRepo supports common npm repository formats', () => {
  const expected = {
    owner: 'homebridge',
    repo: 'analytics',
    key: 'homebridge/analytics',
    url: 'https://github.com/homebridge/analytics',
  };

  assert.deepEqual(extractGithubRepo('https://github.com/homebridge/analytics.git'), expected);
  assert.deepEqual(extractGithubRepo('git+https://github.com/homebridge/analytics.git'), expected);
  assert.deepEqual(extractGithubRepo('git@github.com:homebridge/analytics.git'), expected);
  assert.deepEqual(extractGithubRepo('github:homebridge/analytics'), expected);
  assert.deepEqual(extractGithubRepo({ url: 'https://github.com/homebridge/analytics', directory: 'packages/app' }), expected);
});

test('extractGithubRepo rejects unsupported and malformed repositories', () => {
  assert.equal(extractGithubRepo(null), null);
  assert.equal(extractGithubRepo('https://gitlab.com/homebridge/analytics'), null);
  assert.equal(extractGithubRepo('not a repository'), null);
  assert.equal(extractGithubRepo('https://example.com/github.com/homebridge/analytics'), null);
});

test('resolveRepository replaces the npm CLI placeholder with a GitHub homepage', () => {
  assert.equal(
    resolveRepository(
      { type: 'git', url: 'git+https://github.com/npm/cli.git' },
      'https://github.com/Kwintenvdb/homebridge-vesync-client'
    ),
    'https://github.com/Kwintenvdb/homebridge-vesync-client'
  );
});

test('resolveRepository preserves a valid published repository', () => {
  const repository = { type: 'git', url: 'git+https://github.com/homebridge/analytics.git' };
  assert.equal(resolveRepository(repository, 'https://github.com/another/project'), repository);
  assert.equal(resolveRepository(null, 'https://github.com/homebridge/analytics#readme'), 'https://github.com/homebridge/analytics');
});

test('addGithubStars reuses a fresh cached count for duplicate repositories', async () => {
  const updatedAt = new Date().toISOString();
  const plugins = [
    { name: 'plugin-one', repository: 'github:homebridge/analytics' },
    { name: 'plugin-two', repository: 'https://github.com/homebridge/analytics.git' },
  ];
  const previous = new Map([['plugin-one', {
    name: 'plugin-one',
    githubRepo: 'https://github.com/homebridge/analytics',
    githubStars: 123,
    githubStarsUpdatedAt: updatedAt,
  }]]);

  await addGithubStars(plugins, previous);

  assert.deepEqual(plugins.map(plugin => plugin.githubStars), [123, 123]);
  assert.deepEqual(plugins.map(plugin => plugin.githubStarsUpdatedAt), [updatedAt, updatedAt]);
});

test('addGithubStars fetches each repository once and shares its count', async () => {
  const plugins = [
    { name: 'plugin-one', repository: 'github:homebridge/analytics' },
    { name: 'plugin-two', repository: 'https://github.com/homebridge/analytics.git' },
  ];
  const requested = [];
  const updatedAt = new Date().toISOString();

  await addGithubStars(plugins, new Map(), {
    requestLimit: 1,
    fetchStars: async repo => {
      requested.push(repo.key);
      return { count: 456, updatedAt };
    },
  });

  assert.deepEqual(requested, ['homebridge/analytics']);
  assert.deepEqual(plugins.map(plugin => plugin.githubStars), [456, 456]);
});

test('getNpmLastWeekDownloads batches unscoped packages and limits scoped requests', async () => {
  const names = Array.from({ length: 130 }, (_, index) => `plugin-${index}`);
  names.push('@scope/one', '@scope/two');
  const requestedUrls = [];

  const result = await getNpmLastWeekDownloads(names, new Map(), {
    scopedRequestLimit: 1,
    requestDelayMs: 0,
    fetchFn: async url => {
      requestedUrls.push(url);
      const requestedNames = decodeURIComponent(url.split('/').at(-1)).split(',');
      const data = Object.fromEntries(requestedNames.map(name => [name, { package: name, downloads: 10 }]));
      return {
        ok: true,
        status: 200,
        json: async () => requestedNames.length === 1 ? data[requestedNames[0]] : data,
      };
    },
  });

  assert.equal(requestedUrls.length, 3);
  assert.equal(requestedUrls.filter(url => decodeURIComponent(url).includes('@scope/')).length, 1);
  assert.equal(result.counts['plugin-129'], 10);
  assert.equal(result.counts['@scope/one'], 10);
  assert.equal(result.counts['@scope/two'], 0);
});

test('getNpmLastWeekDownloads retains cached counts and stops after a 429', async () => {
  const oldTimestamp = '2020-01-01T00:00:00.000Z';
  const previous = new Map([
    ['@scope/one', { npmDownloads: 11, npmDownloadsUpdatedAt: oldTimestamp }],
    ['@scope/two', { npmDownloads: 22, npmDownloadsUpdatedAt: oldTimestamp }],
  ]);
  let requestCount = 0;

  const result = await getNpmLastWeekDownloads(['@scope/one', '@scope/two'], previous, {
    maxRetries: 0,
    requestDelayMs: 0,
    fetchFn: async () => {
      requestCount++;
      return { ok: false, status: 429, statusText: 'Too Many Requests' };
    },
  });

  assert.equal(requestCount, 1);
  assert.equal(result.counts['@scope/one'], 11);
  assert.equal(result.counts['@scope/two'], 22);
  assert.equal(result.updatedAt['@scope/one'], oldTimestamp);
});

test('getNpmLastWeekDownloads records the npm reporting window', async () => {
  const result = await getNpmLastWeekDownloads(['plugin-one'], new Map(), {
    requestDelayMs: 0,
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ downloads: 95, start: '2026-08-23', end: '2026-08-29' }),
    }),
  });

  assert.equal(result.counts['plugin-one'], 95);
  assert.equal(result.starts['plugin-one'], '2026-08-23');
  assert.equal(result.ends['plugin-one'], '2026-08-29');
});

test('getDownloadMetrics keeps weekly npm and lifetime GitHub downloads separate', () => {
  assert.deepEqual(getDownloadMetrics(95, 12067), {
    downloads: 95,
    npmDownloads: 95,
    githubDownloads: 12067,
  });
});

test('getReleaseDownloads retains cached counts after GitHub rate limiting', async () => {
  const cached = { 'homebridge-example-1.0.0': 123 };
  const result = await getReleaseDownloads(cached, {
    fetchFn: async () => ({ ok: false, status: 403, statusText: 'rate limit exceeded' }),
  });

  assert.deepEqual(result, cached);
});

test('getHomebridgePlugins paginates until npm exhausts its results', async () => {
  const pages = [
    ['plugin-1', 'plugin-2'],
    ['plugin-3', 'plugin-4'],
    ['plugin-5'],
  ];
  let requestCount = 0;

  const plugins = await getHomebridgePlugins({
    resultsPerPage: 2,
    requestDelayMs: 0,
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ total: 5, objects: pages[requestCount++].map(name => ({ package: { name } })) }),
    }),
  });

  assert.equal(requestCount, 3);
  assert.deepEqual(plugins, ['plugin-1', 'plugin-2', 'plugin-3', 'plugin-4', 'plugin-5']);
});

test('getHomebridgePlugins supports an explicit local testing limit', async () => {
  let requestCount = 0;
  const plugins = await getHomebridgePlugins({
    resultsPerPage: 2,
    pluginLimit: 3,
    requestDelayMs: 0,
    fetchFn: async () => {
      requestCount++;
      return {
        ok: true,
        json: async () => ({ total: 100, objects: [
          { package: { name: `plugin-${requestCount * 2 - 1}` } },
          { package: { name: `plugin-${requestCount * 2}` } },
        ] }),
      };
    },
  });

  assert.equal(requestCount, 2);
  assert.deepEqual(plugins, ['plugin-1', 'plugin-2', 'plugin-3']);
});

test('getHomebridgePlugins stops at the reported total even when npm returns full pages', async () => {
  let requestCount = 0;
  const plugins = await getHomebridgePlugins({
    resultsPerPage: 2,
    requestDelayMs: 0,
    fetchFn: async () => {
      requestCount++;
      return {
        ok: true,
        json: async () => ({
          total: 5,
          objects: [
            { package: { name: `plugin-${requestCount * 2 - 1}` } },
            { package: { name: `plugin-${requestCount * 2}` } },
          ],
        }),
      };
    },
  });

  assert.equal(requestCount, 3);
  assert.deepEqual(plugins, ['plugin-1', 'plugin-2', 'plugin-3', 'plugin-4', 'plugin-5']);
});

test('getHomebridgePlugins stops and deduplicates when npm repeats a page', async () => {
  let requestCount = 0;
  const plugins = await getHomebridgePlugins({
    resultsPerPage: 2,
    requestDelayMs: 0,
    fetchFn: async () => {
      requestCount++;
      return {
        ok: true,
        json: async () => ({
          total: 6,
          objects: [
            { package: { name: 'plugin-1' } },
            { package: { name: 'plugin-2' } },
          ],
        }),
      };
    },
  });

  assert.equal(requestCount, 2);
  assert.deepEqual(plugins, ['plugin-1', 'plugin-2']);
});

test('getHomebridgePlugins retries a throttled search page', async () => {
  let requestCount = 0;
  const delays = [];
  const plugins = await getHomebridgePlugins({
    resultsPerPage: 2,
    requestDelayMs: 0,
    sleepFn: async delay => delays.push(delay),
    fetchFn: async () => {
      requestCount++;
      if (requestCount === 1) {
        return { ok: false, status: 429, statusText: 'Too Many Requests', headers: { get: () => '0' } };
      }
      return {
        ok: true,
        json: async () => ({ total: 1, objects: [{ package: { name: 'plugin-1' } }] }),
      };
    },
  });

  assert.equal(requestCount, 2);
  assert.deepEqual(delays, [1000]);
  assert.deepEqual(plugins, ['plugin-1']);
});

test('searchHomebridgePlugins returns the npm reported total alongside the names', async () => {
  const result = await searchHomebridgePlugins({
    resultsPerPage: 2,
    requestDelayMs: 0,
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ total: 9, objects: [{ package: { name: 'plugin-1' } }, { package: { name: 'plugin-2' } }] }),
    }),
  });

  assert.deepEqual(result, { names: ['plugin-1', 'plugin-2'], reportedTotal: 9 });
});

test('getHomebridgeNamedPackages pages through the listing by key without repeating rows', async () => {
  const rows = ['homebridge-a', 'homebridge-b', 'homebridge-c', 'homebridge-d', 'homebridge-e'];
  const requestedUrls = [];

  const names = await getHomebridgeNamedPackages({
    pageSize: 2,
    fetchFn: async url => {
      requestedUrls.push(url);
      const params = new URL(url).searchParams;
      const from = Math.max(0, rows.indexOf(JSON.parse(params.get('startkey'))));
      return { ok: true, json: async () => ({ rows: rows.slice(from, from + 2).map(id => ({ id, key: id })) }) };
    },
  });

  assert.deepEqual(names, rows);
  assert.equal(requestedUrls.length, 5);
  const firstParams = new URL(requestedUrls[0]).searchParams;
  assert.equal(firstParams.get('startkey'), '"homebridge-"');
  assert.equal(firstParams.get('endkey'), '"homebridge-￰"');
  assert.equal(firstParams.has('skip'), false);
  assert.equal(new URL(requestedUrls[1]).searchParams.get('startkey'), '"homebridge-b"');
});

test('getHomebridgeNamedPackages retries throttling and fails on other errors', async () => {
  let requestCount = 0;
  const names = await getHomebridgeNamedPackages({
    sleepFn: async () => {},
    fetchFn: async () => {
      requestCount++;
      if (requestCount === 1) return { ok: false, status: 503, statusText: 'Service Unavailable', headers: { get: () => null } };
      return { ok: true, json: async () => ({ rows: [{ id: 'homebridge-a' }] }) };
    },
  });
  assert.equal(requestCount, 2);
  assert.deepEqual(names, ['homebridge-a']);

  await assert.rejects(
    getHomebridgeNamedPackages({ fetchFn: async () => ({ ok: false, status: 404, statusText: 'Not Found' }) }),
    /404 Not Found/
  );
});

test('discoverHomebridgePlugins adds listed packages that npm search could not reach', async () => {
  const result = await discoverHomebridgePlugins({
    search: {
      requestDelayMs: 0,
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ total: 3, objects: [{ package: { name: 'homebridge-a' } }, { package: { name: '@scope/homebridge-b' } }] }),
      }),
    },
    listing: {
      fetchFn: async () => ({ ok: true, json: async () => ({ rows: [{ id: 'homebridge-a' }, { id: 'homebridge-c' }] }) }),
    },
  });

  assert.deepEqual(result, {
    searchNames: ['homebridge-a', '@scope/homebridge-b'],
    candidateNames: ['homebridge-c'],
    reportedTotal: 3,
  });
});

test('hasHomebridgePluginKeyword matches arrays and strings case-insensitively', () => {
  assert.equal(hasHomebridgePluginKeyword(['homekit', 'homebridge-plugin']), true);
  assert.equal(hasHomebridgePluginKeyword(['Homebridge-Plugin']), true);
  assert.equal(hasHomebridgePluginKeyword('homebridge, homebridge-plugin'), true);
  assert.equal(hasHomebridgePluginKeyword(['homebridge', 'homebridge-plugins']), false);
  assert.equal(hasHomebridgePluginKeyword(undefined), false);
});

test('selectHomebridgePlugins keeps search results and only keyword-tagged listed candidates', () => {
  const details = [
    { name: 'homebridge-searched', keywords: [] },
    { name: 'homebridge-searched-error', error: 'Error fetching package data' },
    { name: 'homebridge-listed-plugin', keywords: ['homebridge-plugin'] },
    { name: 'homebridge-listed-library', keywords: ['homebridge'] },
    { name: 'homebridge-listed-error', error: 'Error fetching package data' },
  ];

  const selected = selectHomebridgePlugins(details, ['homebridge-searched', 'homebridge-searched-error']);

  assert.deepEqual(selected.map(plugin => plugin.name), ['homebridge-searched', 'homebridge-searched-error', 'homebridge-listed-plugin']);
});

test('assertDiscoveryComplete fails when fewer plugins are found than npm reports', () => {
  assert.throws(() => assertDiscoveryComplete(5250, 5915, Infinity), /Discovered 5250 plugins but npm reports 5915/);
  assert.doesNotThrow(() => assertDiscoveryComplete(6068, 5915, Infinity));
  assert.doesNotThrow(() => assertDiscoveryComplete(10, 5915, 10));
  assert.doesNotThrow(() => assertDiscoveryComplete(10, null, Infinity));
});

test('getPluginTransport applies transport keyword declarations', () => {
  assert.equal(getPluginTransport({ keywords: [] }), 'HAP');
  assert.equal(getPluginTransport({}), 'HAP');
  assert.equal(getPluginTransport({ keywords: ['homebridge-plugin', 'supports-hap'] }), 'HAP');
  assert.equal(getPluginTransport({ keywords: ['homebridge-plugin', 'supports-matter'] }), 'Matter');
  assert.equal(getPluginTransport({ keywords: ['supports-hap', 'supports-matter'] }), 'HAP + Matter');
});

test('getPluginTransport normalizes string and mixed-case keywords', () => {
  assert.equal(getPluginTransport({ keywords: 'homebridge-plugin, supports-matter' }), 'Matter');
  assert.equal(getPluginTransport({ keywords: ['SUPPORTS-HAP', 'Supports-Matter'] }), 'HAP + Matter');
});
