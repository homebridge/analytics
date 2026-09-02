import assert from 'node:assert/strict';
import test from 'node:test';

import { addGithubStars, extractGithubRepo } from './extractAndStorePluginData.mjs';

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
