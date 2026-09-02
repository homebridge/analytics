#! /usr/local/bin/node

import fs from 'fs';
import fetch from 'node-fetch';
import pLimit from 'p-limit';
import { pathToFileURL } from 'url';

// Constants for version checks
// const HOMEBRIDGE_VERSION_CHECK = "2.0.0";
// const NODE_VERSION_CHECK = "14.0.0"; // Adjust as needed

console.log('This only runs for a few minutes, so no time to grab some coffee...');

// Set limit to 100 plugins for testing extraction, and 5000 for final extraction
const TESTING_LIMIT = 5000; // Adjust the limit for final run

// Limit concurrent fetches to 10 at a time
const limit = pLimit(10);

const GITHUB_STAR_REFRESH_DAYS = Number(process.env.GITHUB_STAR_REFRESH_DAYS || 7);
const GITHUB_STAR_REQUEST_LIMIT = Number(process.env.GITHUB_STAR_REQUEST_LIMIT || 4000);
const GITHUB_STAR_CONCURRENCY = Number(process.env.GITHUB_STAR_CONCURRENCY || 5);
const githubLimit = pLimit(GITHUB_STAR_CONCURRENCY);

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

function readPreviousPluginData() {
  try {
    const previousData = JSON.parse(fs.readFileSync('../homebridge_plugins.json', 'utf8'));
    return new Map(previousData.map(plugin => [plugin.name, plugin]));
  } catch (error) {
    console.warn(`Could not load existing GitHub star cache: ${error.message}`);
    return new Map();
  }
}

function isFresh(dateString) {
  const timestamp = Date.parse(dateString);
  return Number.isFinite(timestamp) && Date.now() - timestamp < GITHUB_STAR_REFRESH_DAYS * 24 * 60 * 60 * 1000;
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

// Fetch list of homebridge plugins with pagination
async function getHomebridgePlugins() {
  const resultsPerPage = 250;
  let allData = [];
  let page = 0;
  let keepFetching = true;

  try {
    while (keepFetching) {
      console.log(`Fetching page ${page + 1}...`);
      const url = `https://registry.npmjs.org/-/v1/search?text=keywords:homebridge-plugin&size=${resultsPerPage}&from=${page * resultsPerPage}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();

        // Concatenate current page data to allData
        allData = allData.concat(data.objects);

        // Stop fetching if less than a full page of results is returned or the limit is reached
        if (data.objects.length < resultsPerPage || allData.length >= TESTING_LIMIT) {
          keepFetching = false;
        } else {
          page++;
        }
        await sleep(1000); // Sleep for 1 second to avoid rate limiting
      } else {
        throw new Error(`Error fetching page ${page + 1}: ${response.status} ${response.statusText}`);
      }
    }

    console.log(`Fetched data for ${allData.length} plugins`);
    return allData.slice(0, TESTING_LIMIT).map(pkg => pkg.package.name);

  } catch (error) {
    console.error('Error fetching plugin list from npm:', error);
    return [];
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

async function getReleaseDownloads() {
  try {
    const response = await fetch(apiUrl);
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
    console.error('Error fetching release data:', error);
    return {};
  }
}
async function getNpmLastWeekDownloads(pluginNames) {
  // https://github.com/npm/registry/blob/main/docs/download-counts.md#bulk-queries
  const BULK_LIMIT = 128;
  // This process will batch requests together to reduce the number of requests, but will strive to preserve the order of the search results as much as possible.
  const queries = [];
  const bulk = [];
  const namespaced = [];
  for (let pluginName of pluginNames) {
    if (pluginName.startsWith('@')) {
      namespaced.push(pluginName);
    } else {
      bulk.push(pluginName);
      if (BULK_LIMIT <= bulk.length) {
        queries.push(bulk.join(','));
        bulk.length = 0;
      }
    }
    if (bulk.length === 0) {
      queries.push(...namespaced);
      namespaced.length = 0;
    }
  }
  if (bulk.length != 0) {
    queries.push(bulk.join(','));
    queries.push(...namespaced);
  }

  // Key: pluginName, Value: Last-Week DL count
  const packageDLCountMap = {};
  for (const q of queries) {
    const url = `https://api.npmjs.org/downloads/point/last-week/${q}`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (q.startsWith('@')) {
          packageDLCountMap[data.package] = data.downloads;
        } else {
          Object.values(data).forEach(item => packageDLCountMap[item.package] = item.downloads);
        }
      } else {
        console.log(`Error fetching data for npm last-week download: ${res.status} ${res.statusText}`);
        q.split(',').forEach(item => packageDLCountMap[item] = 0);
      }
    } catch (err) {
      console.error(err);
    }
    await sleep(1000); // Sleep for 1 second to avoid rate limiting
  }
  console.log(`request count:${queries.length}, package count:${Object.keys(packageDLCountMap).length}`);
  return packageDLCountMap;
}

function isHomebridge2Ready(plugin) {
  const hbEngines = plugin.engines?.homebridge?.split('||').map((x) => x.trim()) || [];
  return hbEngines.some((x) => (x.startsWith('^2') || x.startsWith('>=2'))) ? 'Supported' : 'Not ready';
}

// Fetch the full package metadata and download stats
async function fetchPackageDetails(packageName, verifiedPlugins, githubDownloads, npmLastWeekDownloads) {
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
    const npmDownloads = npmLastWeekDownloads[packageName] || 0;
    const homebridge2ready = isHomebridge2Ready(versionData);
    const repository = versionData.repository || data.repository || null;

    // Check if the plugin is verified
    const verified = verifiedPlugins.includes(packageName);
    // console.log('githubDownloads:', packageName, version, githubDownloads[packageName + '-' + version]);
    // Add GitHub downloads (if present) to npm downloads
    const githubDownloadCount = githubDownloads[packageName + '-' + version] || 0;
    const totalDownloads = npmDownloads + githubDownloadCount;
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
      downloads: totalDownloads, // Sum npm and GitHub downloads
      verified,  // Include verified status
      npmDownloads,
      githubDownloads: githubDownloadCount, // Track GitHub downloads separately
      homebridge2ready,
      repository,
    };
  } catch (error) {
    console.error(`Error fetching data for ${packageName}:`, error);
    return { name: packageName, error: 'Error fetching package data' };
  }
}

// Main function to extract and store plugin data
async function extractAndStoreData() {
  const previousPlugins = readPreviousPluginData();
  const allPluginNames = await getHomebridgePlugins();
  fs.writeFileSync('../allPluginNames.json', JSON.stringify(allPluginNames, null, 2));
  const verifiedPlugins = await getVerifiedPlugins();
  const githubDownloads = await getReleaseDownloads();
  const npmLastWeekDownloads = await getNpmLastWeekDownloads(allPluginNames);

  fs.writeFileSync('../githubDownload.json', JSON.stringify(githubDownloads, null, 2));
  // Limit concurrent requests with pLimit
  const pluginsWithDetails = await Promise.all(
    allPluginNames.map(packageName =>
      limit(() => fetchPackageDetails(packageName, verifiedPlugins, githubDownloads, npmLastWeekDownloads))
    )
  );
  await addGithubStars(pluginsWithDetails, previousPlugins);

  // Write the collected data to a JSON file
  fs.writeFileSync('../homebridge_plugins.json', JSON.stringify(pluginsWithDetails, null, 2));
  console.log(`Data extraction complete. Saved details for ${pluginsWithDetails.length} plugins to homebridge_plugins.json`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  extractAndStoreData();
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
