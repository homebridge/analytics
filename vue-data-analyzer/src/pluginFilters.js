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
