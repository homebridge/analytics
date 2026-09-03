import assert from 'node:assert/strict';
import test from 'node:test';

import { addGithubStars, extractGithubRepo, getHomebridgePlugins, getNpmLastWeekDownloads, getReleaseDownloads, resolveRepository } from './extractAndStorePluginData.mjs';
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
