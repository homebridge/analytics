#! /usr/local/bin/node

import fs from 'fs';
import fetch from 'node-fetch';
import pLimit from 'p-limit';

// Constants for version checks
// const HOMEBRIDGE_VERSION_CHECK = "2.0.0";
// const NODE_VERSION_CHECK = "14.0.0"; // Adjust as needed

console.log('This only runs for a few minutes, so no time to grab some coffee...');

// Set limit to 100 plugins for testing extraction, and 5000 for final extraction
const TESTING_LIMIT = 5000; // Adjust the limit for final run

// Limit concurrent fetches to 10 at a time
const limit = pLimit(10);

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
    };
  } catch (error) {
    console.error(`Error fetching data for ${packageName}:`, error);
    return { name: packageName, error: 'Error fetching package data' };
  }
}

// Main function to extract and store plugin data
async function extractAndStoreData() {
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

  // Write the collected data to a JSON file
  fs.writeFileSync('../homebridge_plugins.json', JSON.stringify(pluginsWithDetails, null, 2));
  console.log(`Data extraction complete. Saved details for ${pluginsWithDetails.length} plugins to homebridge_plugins.json`);
}

extractAndStoreData();

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}