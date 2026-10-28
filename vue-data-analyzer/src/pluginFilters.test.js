import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasPotentialGithubMismatch,
  compareStarDataQuality,
  getWeeklyNpmDownloads,
  matchesNumericFilter,
  matchesStarDataQualityFilter,
  matchesTransportFilter,
  defaultViewState,
  viewStateFromQuery,
  viewStateToQuery,
} from './pluginFilters.js';

test('matchesNumericFilter supports equal, greater, and less comparisons', () => {
  assert.equal(matchesNumericFilter(10, 10, 'equal'), true);
  assert.equal(matchesNumericFilter(11, 10, 'greater'), true);
  assert.equal(matchesNumericFilter(9, 10, 'less'), true);
  assert.equal(matchesNumericFilter(10, '', 'equal'), true);
  assert.equal(matchesNumericFilter(null, 10, 'equal'), false);
});

test('getWeeklyNpmDownloads prefers the uncombined npm metric', () => {
  assert.equal(getWeeklyNpmDownloads({ downloads: 12162, npmDownloads: 95, githubDownloads: 12067 }), 95);
  assert.equal(getWeeklyNpmDownloads({ downloads: 42 }), 42);
});

test('matchesTransportFilter distinguishes HAP, Matter, and both', () => {
  const hap = { keywords: ['supports-hap'] };
  const matter = { keywords: ['supports-matter'] };
  const both = { keywords: ['supports-hap', 'supports-matter'] };

  assert.equal(matchesTransportFilter(hap, 'HAP'), true);
  assert.equal(matchesTransportFilter(hap, 'Matter'), false);
  assert.equal(matchesTransportFilter(matter, 'Matter'), true);
  assert.equal(matchesTransportFilter(matter, 'HAP + Matter'), false);
  assert.equal(matchesTransportFilter(both, 'HAP + Matter'), true);
  assert.equal(matchesTransportFilter(both, 'HAP'), false);
  assert.equal(matchesTransportFilter(both, ''), true);
});

test('hasPotentialGithubMismatch requires the npm and GitHub names to match', () => {
  assert.equal(hasPotentialGithubMismatch({
    name: 'homebridge-rocket-smart-home-ui',
    githubRepo: 'https://github.com/oznu/homebridge-config-ui-x',
    githubStars: 2793,
  }), true);
  assert.equal(hasPotentialGithubMismatch({
    name: 'homebridge-vesync-client',
    githubRepo: 'https://github.com/npm/cli',
    githubStars: 10082,
  }), true);
  assert.equal(hasPotentialGithubMismatch({
    name: 'homebridge-ring',
    githubRepo: 'https://github.com/dgreif/ring',
    githubStars: 1519,
  }), true);
});

test('hasPotentialGithubMismatch allows exact names, including scoped npm packages', () => {
  assert.equal(hasPotentialGithubMismatch({
    name: 'homebridge-camera-ffmpeg',
    githubRepo: 'https://github.com/Sunoo/homebridge-camera-ffmpeg',
    githubStars: 1116,
  }), false);
  assert.equal(hasPotentialGithubMismatch({
    name: '@homebridge-plugins/homebridge-camera-ffmpeg',
    githubRepo: 'https://github.com/homebridge-plugins/homebridge-camera-ffmpeg',
    githubStars: 1116,
  }), false);
  assert.equal(hasPotentialGithubMismatch({ name: 'homebridge-example' }), false);
});

test('matchesStarDataQualityFilter exposes only potential mismatches when selected', () => {
  const plugin = {
    name: 'homebridge-example',
    githubRepo: 'https://github.com/unrelated/project',
    githubStars: 100,
  };
  assert.equal(matchesStarDataQualityFilter(plugin, ''), true);
  assert.equal(matchesStarDataQualityFilter(plugin, 'potential-mismatch'), true);
});

test('compareStarDataQuality places mismatches after matching repositories', () => {
  const matching = { name: 'homebridge-example', githubRepo: 'https://github.com/user/homebridge-example', githubStars: 10 };
  const mismatch = { name: 'homebridge-copy', githubRepo: 'https://github.com/user/homebridge-example', githubStars: 1000 };
  assert.ok(compareStarDataQuality(matching, mismatch) < 0);
  assert.ok(compareStarDataQuality(mismatch, matching) > 0);
  assert.equal(compareStarDataQuality(matching, matching), 0);
});

test('viewStateFromQuery reads filters, comparisons and sorting', () => {
  const state = viewStateFromQuery('?verified=true&downloads=100&downloadsComparison=greater&sort=downloads&order=desc&unknown=1');
  assert.equal(state.filters.verified, 'true');
  assert.equal(state.filters.downloads, 100);
  assert.equal(state.downloadsComparison, 'greater');
  assert.equal(state.sortKey, 'downloads');
  assert.equal(state.sortOrder, 'desc');
  assert.equal(state.filters.name, '');
});

test('viewStateFromQuery ignores non-numeric values for numeric filters', () => {
  assert.equal(viewStateFromQuery('?githubStars=lots').filters.githubStars, '');
});

test('viewStateToQuery omits defaults and round-trips', () => {
  assert.equal(viewStateToQuery(defaultViewState()), '');

  const state = defaultViewState();
  state.filters.verified = 'true';
  state.filters.githubStars = 50;
  state.githubStarsComparison = 'greater';
  state.sortKey = 'githubStars';
  state.sortOrder = 'desc';
  const query = viewStateToQuery(state);
  assert.equal(query, 'githubStars=50&verified=true&githubStarsComparison=greater&sort=githubStars&order=desc');
  assert.deepEqual(viewStateFromQuery(query), state);
});
