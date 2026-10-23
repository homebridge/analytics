#! /usr/local/bin/node

import fs from 'fs';
import fetch from 'node-fetch';
import pLimit from 'p-limit';
import { pathToFileURL } from 'url';

// Constants for version checks
// const HOMEBRIDGE_VERSION_CHECK = "2.0.0";
// const NODE_VERSION_CHECK = "14.0.0"; // Adjust as needed

console.log('This only runs for a few minutes, so no time to grab some coffee...');

const configuredPluginLimit = Number(process.env.PLUGIN_LIMIT);
const PLUGIN_LIMIT = Number.isInteger(configuredPluginLimit) && configuredPluginLimit > 0
  ? configuredPluginLimit
  : Infinity;
const configuredMaxPluginPages = Number(process.env.MAX_PLUGIN_SEARCH_PAGES);
const MAX_PLUGIN_SEARCH_PAGES = Number.isInteger(configuredMaxPluginPages) && configuredMaxPluginPages > 0
  ? configuredMaxPluginPages
  : 100;

// Limit concurrent fetches to 10 at a time
const limit = pLimit(10);

const GITHUB_STAR_REFRESH_DAYS = Number(process.env.GITHUB_STAR_REFRESH_DAYS || 7);
const GITHUB_STAR_REQUEST_LIMIT = Number(process.env.GITHUB_STAR_REQUEST_LIMIT || 4000);
const GITHUB_STAR_CONCURRENCY = Number(process.env.GITHUB_STAR_CONCURRENCY || 5);
const githubLimit = pLimit(GITHUB_STAR_CONCURRENCY);
const NPM_SCOPED_DOWNLOAD_REQUEST_LIMIT = Number(process.env.NPM_SCOPED_DOWNLOAD_REQUEST_LIMIT || 100);
const NPM_DOWNLOAD_REFRESH_DAYS = Number(process.env.NPM_DOWNLOAD_REFRESH_DAYS || 7);
const NPM_DOWNLOAD_REQUEST_DELAY_MS = Number(process.env.NPM_DOWNLOAD_REQUEST_DELAY_MS || 1000);

export function extractGithubRepo(repository) {
  const repositoryUrl = typeof repository === 'string' ? repository : repository?.url;
  if (!repositoryUrl || typeof repositoryUrl !== 'string') return null;

  let value = repositoryUrl.trim()
    .replace(/^git\+/, '')
    .replace(/^github:/, 'https://github.com/')
    .replace(/^git@github\.com:/, 'https://github.com/');

  if (/^[\w.-]+\/[\w.-]+(?:\.git)?$/.test(value)) {
    value = `https://github.com/${value}`;
  }

  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== 'github.com') return null;

    const [owner, rawRepo] = url.pathname.split('/').filter(Boolean);
    const repo = rawRepo?.replace(/\.git$/i, '');
    if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;

    return {
      owner,
      repo,
      key: `${owner}/${repo}`.toLowerCase(),
      url: `https://github.com/${owner}/${repo}`,
    };
  } catch {
    return null;
  }
}

export function resolveRepository(repository, homepage) {
  const repositoryRepo = extractGithubRepo(repository);
  const homepageRepo = extractGithubRepo(homepage);

  // Some packages created with an old npm template accidentally publish npm/cli
  // as their repository while still providing their real project as homepage.
  if (repositoryRepo?.key === 'npm/cli' && homepageRepo?.key !== 'npm/cli') {
    return homepageRepo?.url || repository;
  }

  return repositoryRepo ? repository : (homepageRepo?.url || repository || null);
}

function readPreviousPluginData() {
  try {
    const previousData = JSON.parse(fs.readFileSync('../homebridge_plugins.json', 'utf8'));
    return new Map(previousData.map(plugin => [plugin.name, plugin]));
  } catch (error) {
    console.warn(`Could not load existing GitHub star cache: ${error.message}`);
    return new Map();
  }
}

function readPreviousGithubDownloads() {
  try {
    return JSON.parse(fs.readFileSync('../githubDownload.json', 'utf8'));
  } catch (error) {
    console.warn(`Could not load existing GitHub download cache: ${error.message}`);
    return {};
  }
}

function isFresh(dateString) {
  return isTimestampFresh(dateString, GITHUB_STAR_REFRESH_DAYS);
}

function isTimestampFresh(dateString, maxAgeDays) {
  const timestamp = Date.parse(dateString);
  return Number.isFinite(timestamp) && Date.now() - timestamp < maxAgeDays * 24 * 60 * 60 * 1000;
}

async function fetchGithubStars(repo) {
  const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }),
    },
  });

  if (response.status === 404) return { count: null, updatedAt: new Date().toISOString() };
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

  const data = await response.json();
  return { count: data.stargazers_count, updatedAt: new Date().toISOString() };
}

export async function addGithubStars(plugins, previousPlugins = new Map(), options = {}) {
  const fetchStars = options.fetchStars || fetchGithubStars;
  const configuredRequestLimit = options.requestLimit ?? GITHUB_STAR_REQUEST_LIMIT;
  const requestLimit = options.fetchStars || process.env.GITHUB_TOKEN
    ? configuredRequestLimit
    : Math.min(configuredRequestLimit, 50);
  const repositories = new Map();

  for (const plugin of plugins) {
    const repo = extractGithubRepo(plugin.repository);
    if (!repo) continue;

    plugin.githubRepo = repo.url;
    const previous = previousPlugins.get(plugin.name);
    if (previous?.githubRepo?.toLowerCase() === repo.url.toLowerCase()) {
      plugin.githubStars = Number.isInteger(previous.githubStars) ? previous.githubStars : null;
      plugin.githubStarsUpdatedAt = previous.githubStarsUpdatedAt || null;
    } else {
      plugin.githubStars = null;
      plugin.githubStarsUpdatedAt = null;
    }

    if (!repositories.has(repo.key)) repositories.set(repo.key, { repo, plugins: [] });
    repositories.get(repo.key).plugins.push(plugin);
  }

  for (const { plugins: repoPlugins } of repositories.values()) {
    const cached = repoPlugins.find(plugin => isFresh(plugin.githubStarsUpdatedAt));
    if (cached) {
      for (const plugin of repoPlugins) {
        plugin.githubStars = cached.githubStars;
        plugin.githubStarsUpdatedAt = cached.githubStarsUpdatedAt;
      }
    }
  }

  const staleRepositories = [...repositories.values()].filter(({ plugins: repoPlugins }) =>
    !repoPlugins.some(plugin => isFresh(plugin.githubStarsUpdatedAt))
  );
  const refreshQueue = staleRepositories.slice(0, Math.max(0, requestLimit));

  console.log(`GitHub stars: ${repositories.size} repositories, refreshing ${refreshQueue.length} (${staleRepositories.length} stale or missing)`);
  await Promise.all(refreshQueue.map(({ repo, plugins: repoPlugins }) => githubLimit(async () => {
    try {
      const result = await fetchStars(repo);
      for (const plugin of repoPlugins) {
        plugin.githubStars = result.count;
        plugin.githubStarsUpdatedAt = result.updatedAt;
      }
    } catch (error) {
      console.error(`Error fetching GitHub stars for ${repo.key}: ${error.message}`);
    }
  })));

  return plugins;
}

// Fetch a URL, retrying throttled and transient server errors
async function fetchWithRetry(url, { fetchFn, sleepFn, maxRetries, label }) {
  let response;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    response = await fetchFn(url);
    if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt === maxRetries) break;

    const retryAfterHeader = response.headers?.get?.('retry-after');
    const retryAfter = retryAfterHeader === null || retryAfterHeader === undefined ? NaN : Number(retryAfterHeader);
    const retryDelay = Number.isFinite(retryAfter) ? Math.max(1000, retryAfter * 1000) : 2000 * (2 ** attempt);
    console.warn(`${label} returned ${response.status}; retrying in ${retryDelay}ms`);
    await sleepFn(retryDelay);
  }
  return response;
}

// Fetch list of homebridge plugins with pagination
export async function getHomebridgePlugins(options = {}) {
  return (await searchHomebridgePlugins(options)).names;
}

// npm search never returns results beyond offset 5,000 (size 250), so it can only reach the first 5,250 matches.
// Requests past that point silently return the first page again, which the repeated-page check below detects.
export async function searchHomebridgePlugins(options = {}) {
  const resultsPerPage = options.resultsPerPage || 250;
  const pluginLimit = options.pluginLimit ?? PLUGIN_LIMIT;
  const fetchFn = options.fetchFn || fetch;
  const sleepFn = options.sleepFn || sleep;
  const requestDelayMs = options.requestDelayMs ?? 1000;
  const maxRetries = options.maxRetries ?? 2;
  const maxPages = options.maxPages ?? MAX_PLUGIN_SEARCH_PAGES;
  const pluginsByName = new Map();
  let reportedTotal = null;
  let page = 0;
  let keepFetching = true;

  try {
    while (keepFetching) {
      console.log(`Fetching page ${page + 1}...`);
      const url = `https://registry.npmjs.org/-/v1/search?text=keywords:homebridge-plugin&size=${resultsPerPage}&from=${page * resultsPerPage}`;
      const response = await fetchWithRetry(url, { fetchFn, sleepFn, maxRetries, label: 'npm plugin search' });
      if (response.ok) {
        const data = await response.json();
        const objects = Array.isArray(data.objects) ? data.objects : [];
        const total = Number(data.total);
        if (reportedTotal === null && Number.isFinite(total) && total >= 0) reportedTotal = total;

        const countBeforePage = pluginsByName.size;
        for (const item of objects) {
          const name = item?.package?.name;
          if (name && !pluginsByName.has(name)) pluginsByName.set(name, item);
        }
        const addedOnPage = pluginsByName.size - countBeforePage;
        const searchedResults = (page + 1) * resultsPerPage;
        const reachedReportedTotal = reportedTotal !== null && searchedResults >= reportedTotal;

        if (addedOnPage === 0 && reportedTotal !== null && pluginsByName.size < reportedTotal) {
          console.log(`npm search window ended after ${pluginsByName.size} unique plugins; reported total is ${reportedTotal}`);
        }

        if (objects.length < resultsPerPage || pluginsByName.size >= pluginLimit || reachedReportedTotal || addedOnPage === 0) {
          keepFetching = false;
        } else {
          page++;
          if (page >= maxPages) {
            throw new Error(`Stopped after ${maxPages} npm search pages without reaching the reported total`);
          }
        }
        if (requestDelayMs > 0) await sleepFn(requestDelayMs);
      } else {
        throw new Error(`Error fetching page ${page + 1}: ${response.status} ${response.statusText}`);
      }
    }

    const effectiveLimit = Math.min(pluginLimit, reportedTotal ?? Infinity);
    const plugins = [...pluginsByName.keys()].slice(0, effectiveLimit);
    console.log(`Fetched ${plugins.length} unique plugins${reportedTotal === null ? '' : ` (npm reported ${reportedTotal})`}`);
    return { names: plugins, reportedTotal };

  } catch (error) {
    console.error('Error fetching plugin list from npm:', error);
    throw error;
  }
}

// List every unscoped package named homebridge-* from the npm replication database.
// Homebridge only loads plugins named homebridge-* or @scope/homebridge-*, and this listing has no result cap.
export async function getHomebridgeNamedPackages(options = {}) {
  const pageSize = options.pageSize || 10000;
  const fetchFn = options.fetchFn || fetch;
  const sleepFn = options.sleepFn || sleep;
  const maxRetries = options.maxRetries ?? 2;
  const baseUrl = 'https://replicate.npmjs.com/registry/_all_docs';
  const endKey = JSON.stringify('homebridge-￰');
  const names = [];
  let startKey = JSON.stringify('homebridge-');
  let lastId = null;

  // The replication endpoint rejects skip and caps limit at 10,000
  while (true) {
    const url = `${baseUrl}?startkey=${encodeURIComponent(startKey)}&endkey=${encodeURIComponent(endKey)}&limit=${pageSize}`;
    const response = await fetchWithRetry(url, { fetchFn, sleepFn, maxRetries, label: 'npm package listing' });
    if (!response.ok) {
      throw new Error(`Error listing homebridge-* packages: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const rows = Array.isArray(data.rows) ? data.rows : [];
    for (const row of rows) {
      if (row?.id === lastId) continue;
      if (typeof row?.id === 'string' && row.id.startsWith('homebridge-')) names.push(row.id);
    }
    if (rows.length < pageSize) break;

    // Each page restarts at the previous page's last key, which is skipped above
    lastId = rows.at(-1).id;
    startKey = JSON.stringify(lastId);
  }

  console.log(`npm package listing: ${names.length} packages named homebridge-*`);
  return names;
}

// Combine npm search (which covers scoped packages) with the uncapped homebridge-* listing
export async function discoverHomebridgePlugins(options = {}) {
  const { names: searchNames, reportedTotal } = await searchHomebridgePlugins(options.search);
  const searchSet = new Set(searchNames);
  const listedNames = await getHomebridgeNamedPackages(options.listing);
  const candidateNames = listedNames.filter(name => !searchSet.has(name));
  console.log(`Plugin discovery: ${searchNames.length} from search, ${candidateNames.length} additional homebridge-* candidates to verify`);
  return { searchNames, candidateNames, reportedTotal };
}

export function hasHomebridgePluginKeyword(keywords) {
  const list = Array.isArray(keywords) ? keywords : typeof keywords === 'string' ? keywords.split(/[\s,]+/) : [];
  return list.some(keyword => typeof keyword === 'string' && keyword.trim().toLowerCase() === 'homebridge-plugin');
}

// Search results already matched the keyword; listed-only candidates must declare it in their latest version
export function selectHomebridgePlugins(packageDetails, searchNames) {
  const searchSet = new Set(searchNames);
  return packageDetails.filter(details =>
    searchSet.has(details.name) || (!details.error && hasHomebridgePluginKeyword(details.keywords))
  );
}

export function assertDiscoveryComplete(pluginCount, reportedTotal, pluginLimit = PLUGIN_LIMIT) {
  if (pluginLimit !== Infinity || reportedTotal === null || reportedTotal === undefined) return;
  if (pluginCount < reportedTotal) {
    throw new Error(`Discovered ${pluginCount} plugins but npm reports ${reportedTotal}; refusing to publish incomplete data`);
  }
}

// Fetch the Homebridge Verified list
async function getVerifiedPlugins() {
  const url = 'https://raw.githubusercontent.com/homebridge/verified/latest/verified-plugins.json';
  try {
    console.log('Fetching Homebridge verified plugins...');
    const response = await fetch(url);
    const data = await response.json();
    const verifiedPluginNames = data;
    console.log(`Fetched ${verifiedPluginNames.length} verified plugins`);
    return verifiedPluginNames;
  } catch (error) {
    console.error('Error fetching verified plugins:', error);
    return [];
  }
}

// Fetch download count from GitHub releases
const owner = 'homebridge';
const repo = 'verified';
const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;

export async function getReleaseDownloads(previousDownloads = {}, options = {}) {
  const fetchFn = options.fetchFn || fetch;
  try {
    const response = await fetchFn(apiUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }),
      },
    });
    if (!response.ok) {
      throw new Error(`Error: ${response.status} ${response.statusText}`);
    }

    const releases = await response.json();
    let downloadsMap = {};

    releases.forEach(release => {
      release.assets.forEach(asset => {
        if (!asset.name.includes('sha256')) {
          const pluginName = asset.name.replace(/\.tar\.gz$/, ''); // Strip off the file extension to get plugin name
          downloadsMap[pluginName] = (downloadsMap[pluginName] || 0) + asset.download_count;
          // console.log(`Asset: ${pluginName}, Downloads: ${asset.download_count}`);
        }
      });
    });

    console.log(`Total downloads map: ${Object.keys(downloadsMap).length} plugins`);
    return downloadsMap;

  } catch (error) {
    console.error(`Error fetching release data: ${error.message}`);
    console.warn(`Using ${Object.keys(previousDownloads).length} cached GitHub release download counts`);
    return previousDownloads;
  }
}
export async function getNpmLastWeekDownloads(pluginNames, previousPlugins = new Map(), options = {}) {
  // https://github.com/npm/registry/blob/main/docs/download-counts.md#bulk-queries
  const BULK_LIMIT = 128;
  const fetchFn = options.fetchFn || fetch;
  const sleepFn = options.sleepFn || sleep;
  const requestDelayMs = options.requestDelayMs ?? NPM_DOWNLOAD_REQUEST_DELAY_MS;
  const scopedRequestLimit = options.scopedRequestLimit ?? NPM_SCOPED_DOWNLOAD_REQUEST_LIMIT;
  const maxRetries = options.maxRetries ?? 2;
  const now = options.now || new Date().toISOString();
  const counts = {};
  const updatedAt = {};
  const starts = {};
  const ends = {};

  for (const pluginName of pluginNames) {
    const previous = previousPlugins.get(pluginName);
    counts[pluginName] = Number.isInteger(previous?.npmDownloads) ? previous.npmDownloads : 0;
    updatedAt[pluginName] = previous?.npmDownloadsUpdatedAt || null;
    starts[pluginName] = previous?.npmDownloadsStart || null;
    ends[pluginName] = previous?.npmDownloadsEnd || null;
  }

  const unscoped = pluginNames.filter(name => !name.startsWith('@'));
  const scoped = pluginNames.filter(name => name.startsWith('@'));
  const queries = [];
  for (let index = 0; index < unscoped.length; index += BULK_LIMIT) {
    queries.push(unscoped.slice(index, index + BULK_LIMIT));
  }

  const staleScoped = scoped.filter(name => !isTimestampFresh(updatedAt[name], NPM_DOWNLOAD_REFRESH_DAYS));
  for (const name of staleScoped.slice(0, Math.max(0, scopedRequestLimit))) queries.push([name]);

  let requestCount = 0;
  let refreshedCount = 0;
  let throttled = false;
  for (const names of queries) {
    const path = names.map(encodeURIComponent).join(',');
    const url = `https://api.npmjs.org/downloads/point/last-week/${path}`;
    try {
      let res;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        res = await fetchFn(url);
        requestCount++;
        if (res.ok || ![429, 500, 502, 503, 504].includes(res.status) || attempt === maxRetries) break;

        const retryAfterHeader = res.headers?.get?.('retry-after');
        const retryAfter = retryAfterHeader === null || retryAfterHeader === undefined ? NaN : Number(retryAfterHeader);
        const retryDelay = Number.isFinite(retryAfter) ? Math.max(1000, retryAfter * 1000) : 2000 * (2 ** attempt);
        console.warn(`npm downloads request returned ${res.status}; retrying in ${retryDelay}ms`);
        await sleepFn(retryDelay);
      }

      if (res.ok) {
        const data = await res.json();
        if (names.length === 1) {
          if (Number.isInteger(data.downloads)) {
            counts[names[0]] = data.downloads;
            updatedAt[names[0]] = now;
            starts[names[0]] = data.start || null;
            ends[names[0]] = data.end || null;
            refreshedCount++;
          }
        } else {
          for (const name of names) {
            if (Number.isInteger(data[name]?.downloads)) {
              counts[name] = data[name].downloads;
              updatedAt[name] = now;
              starts[name] = data[name].start || null;
              ends[name] = data[name].end || null;
              refreshedCount++;
            }
          }
        }
      } else {
        console.error(`Error fetching npm last-week downloads for ${names.join(',')}: ${res.status} ${res.statusText}`);
        if (res.status === 429) {
          throttled = true;
          break;
        }
      }
    } catch (err) {
      console.error(`Error fetching npm last-week downloads for ${names.join(',')}: ${err.message}`);
    }
    if (requestDelayMs > 0) await sleepFn(requestDelayMs);
  }

  console.log(`npm downloads: ${requestCount} requests, ${refreshedCount}/${pluginNames.length} refreshed, ${staleScoped.length} scoped packages stale${throttled ? ', stopped after rate limiting' : ''}`);
  return { counts, updatedAt, starts, ends };
}

export function getDownloadMetrics(npmDownloads, githubDownloads) {
  return { downloads: npmDownloads, npmDownloads, githubDownloads };
}

function isHomebridge2Ready(plugin) {
  const hbEngines = plugin.engines?.homebridge?.split('||').map((x) => x.trim()) || [];
  return hbEngines.some((x) => (x.startsWith('^2') || x.startsWith('>=2'))) ? 'Supported' : 'Not ready';
}

// Fetch the full package metadata and download stats
async function fetchPackageDetails(packageName, verifiedPlugins, githubDownloads, npmDownloadData) {
  console.log(`Fetching package details data for ${packageName}...`);
  const url = `https://registry.npmjs.org/${packageName}`;

  try {
    const [response] = await Promise.all([
      fetch(url),
    ]);
    if (!response.ok) {
      throw new Error(`Error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();

    const latestVersion = data['dist-tags'].latest;
    const versionData = data.versions[latestVersion];

    const maintainers = data.maintainers.map(maintainer => maintainer.name);
    const description = versionData.description || 'No description provided';
    const keywords = versionData.keywords || [];
    const version = latestVersion;
    const engines = versionData.engines || {};
    const created = data.time.created;
    const lastUpdated = data.time.modified;
    const latestRelease = data.time[latestVersion];  // Capture latest release date
    const author = versionData.author ? versionData.author.name : 'Not supplied';
    const deprecated = versionData.deprecated || false;
    const displayName = versionData.displayName || packageName;
    const owner = (author === 'Not supplied') ? maintainers.join(', ') : author;
    const npmDownloads = npmDownloadData.counts[packageName] || 0;
    const npmDownloadsUpdatedAt = npmDownloadData.updatedAt[packageName] || null;
    const npmDownloadsStart = npmDownloadData.starts[packageName] || null;
    const npmDownloadsEnd = npmDownloadData.ends[packageName] || null;
    const homebridge2ready = isHomebridge2Ready(versionData);
    const repository = resolveRepository(
      versionData.repository || data.repository || null,
      versionData.homepage || data.homepage || null
    );

    // Check if the plugin is verified
    const verified = verifiedPlugins.includes(packageName);
    // console.log('githubDownloads:', packageName, version, githubDownloads[packageName + '-' + version]);
    // Add GitHub downloads (if present) to npm downloads
    const githubDownloadCount = githubDownloads[packageName + '-' + version] || 0;
    const downloadMetrics = getDownloadMetrics(npmDownloads, githubDownloadCount);
    await sleep(1000); // Sleep for 1 second to avoid rate limiting
    return {
      name: packageName,
      description,
      keywords,
      version,
      maintainers,
      engines,
      created,
      lastUpdated,
      latestRelease,  // Add latest release date
      author,
      deprecated,
      displayName,
      owner,
      downloads: downloadMetrics.downloads,
      verified,  // Include verified status
      npmDownloads,
      npmDownloadsUpdatedAt,
      npmDownloadsStart,
      npmDownloadsEnd,
      githubDownloads: downloadMetrics.githubDownloads,
      homebridge2ready,
      repository,
    };
  } catch (error) {
    console.error(`Error fetching data for ${packageName}: ${error.message}`);
    return { name: packageName, error: 'Error fetching package data' };
  }
}

// Main function to extract and store plugin data
async function extractAndStoreData() {
  const previousPlugins = readPreviousPluginData();
  const { searchNames, candidateNames, reportedTotal } = await discoverHomebridgePlugins();
  const packageNames = [...searchNames, ...candidateNames].slice(0, PLUGIN_LIMIT);
  const verifiedPlugins = await getVerifiedPlugins();
  const githubDownloads = await getReleaseDownloads(readPreviousGithubDownloads());
  const npmDownloadData = await getNpmLastWeekDownloads(packageNames, previousPlugins);

  // Limit concurrent requests with pLimit
  const packageDetails = await Promise.all(
    packageNames.map(packageName =>
      limit(() => fetchPackageDetails(packageName, verifiedPlugins, githubDownloads, npmDownloadData))
    )
  );
  const pluginsWithDetails = selectHomebridgePlugins(packageDetails, searchNames);
  console.log(`Plugin discovery: kept ${pluginsWithDetails.length} of ${packageDetails.length} packages (npm reported ${reportedTotal})`);
  assertDiscoveryComplete(pluginsWithDetails.length, reportedTotal);

  const allPluginNames = pluginsWithDetails.map(plugin => plugin.name);
  fs.writeFileSync('../allPluginNames.json', JSON.stringify(allPluginNames, null, 2));
  fs.writeFileSync('../githubDownload.json', JSON.stringify(githubDownloads, null, 2));
  await addGithubStars(pluginsWithDetails, previousPlugins);

  // Write the collected data to a JSON file
  fs.writeFileSync('../homebridge_plugins.json', JSON.stringify(pluginsWithDetails, null, 2));
  console.log(`Data extraction complete. Saved details for ${pluginsWithDetails.length} plugins to homebridge_plugins.json`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  extractAndStoreData().catch(error => {
    console.error('Data extraction failed:', error.message);
    process.exitCode = 1;
  });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
