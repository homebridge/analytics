import { getPluginTransport } from './pluginTransports.js';

export function matchesNumericFilter(value, filterValue, comparison) {
  if (filterValue === '' || filterValue === undefined || filterValue === null) return true;
  if (!Number.isFinite(value) || !Number.isFinite(filterValue)) return false;

  if (comparison === 'greater') return value > filterValue;
  if (comparison === 'less') return value < filterValue;
  return value === filterValue;
}

export function getWeeklyNpmDownloads(plugin) {
  return Number.isInteger(plugin?.npmDownloads) ? plugin.npmDownloads : plugin?.downloads;
}

export function matchesTransportFilter(plugin, transport) {
  return transport === '' || getPluginTransport(plugin) === transport;
}

function comparableName(value) {
  return String(value || '')
    .split('/').pop()
    .replace(/\.git$/i, '')
    .toLowerCase();
}

export function hasPotentialGithubMismatch(plugin) {
  if (!Number.isInteger(plugin?.githubStars) || !plugin?.githubRepo) return false;

  const packageName = comparableName(plugin.name);
  const repositoryName = comparableName(plugin.githubRepo);
  return Boolean(packageName && repositoryName && packageName !== repositoryName);
}

export function matchesStarDataQualityFilter(plugin, filter) {
  return filter === '' || (filter === 'potential-mismatch' && hasPotentialGithubMismatch(plugin));
}

export function compareStarDataQuality(a, b) {
  return Number(hasPotentialGithubMismatch(a)) - Number(hasPotentialGithubMismatch(b));
}

const NUMERIC_FILTERS = ['downloads', 'githubStars'];
const COMPARISONS = ['downloadsComparison', 'githubStarsComparison', 'createdComparison', 'lastUpdatedComparison'];

export function defaultViewState() {
  return {
    filters: {
      name: '',
      description: '',
      version: '',
      owner: '',
      downloads: '',
      githubStars: '',
      starDataQuality: '',
      created: '',
      lastUpdated: '',
      homebridge2Compatibility: '',
      verified: '',
      transport: '',
    },
    downloadsComparison: 'equal',
    githubStarsComparison: 'equal',
    createdComparison: 'after',
    lastUpdatedComparison: 'after',
    sortKey: null,
    sortOrder: 'asc',
  };
}

// Read filters and sorting from a query string such as ?verified=true&sort=downloads&order=desc
export function viewStateFromQuery(search) {
  const params = new URLSearchParams(search);
  const state = defaultViewState();

  for (const key of Object.keys(state.filters)) {
    const value = params.get(key);
    if (value === null || value === '') continue;
    if (NUMERIC_FILTERS.includes(key)) {
      const number = Number(value);
      if (Number.isFinite(number)) state.filters[key] = number;
    } else {
      state.filters[key] = value;
    }
  }
  for (const key of COMPARISONS) {
    if (params.get(key)) state[key] = params.get(key);
  }
  if (params.get('sort')) state.sortKey = params.get('sort');
  if (params.get('order') === 'desc') state.sortOrder = 'desc';

  return state;
}

// Write only the values that differ from the defaults, so a cleared page has no query string
export function viewStateToQuery(state) {
  const defaults = defaultViewState();
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(state.filters)) {
    if (value !== '' && value !== null && value !== undefined) params.set(key, value);
  }
  for (const key of COMPARISONS) {
    if (state[key] !== defaults[key]) params.set(key, state[key]);
  }
  if (state.sortKey) {
    params.set('sort', state.sortKey);
    if (state.sortOrder === 'desc') params.set('order', 'desc');
  }

  return params.toString();
}
