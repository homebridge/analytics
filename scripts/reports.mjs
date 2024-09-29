#! /usr/local/bin/node

import fs from 'fs';

// Function to check if the plugin is Homebridge 2 ready
function isHomebridge2Ready(plugin) {
  const hbEngines = plugin.engines?.homebridge?.split('||').map((x) => x.trim()) || [];
  return hbEngines.some((x) => (x.startsWith('^2') || x.startsWith('>=2'))) ? 'Supported' : 'Not ready';
}

// Function to generate a markdown report based on latest release date
function generateReleaseDateReport(data) {
  const currentDate = new Date();
  const twelveMonthsAgo = new Date(currentDate);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  let hb2ReadyCount = 0;
  let hb2NotReadyCount = 0;

  // Filter plugins based on the conditions: verified, latestRelease within 12 months, and Homebridge 2 Ready
  const filteredPlugins = data.filter(plugin => {
    const releaseDate = new Date(plugin.latestRelease);
    const hb2Status = isHomebridge2Ready(plugin); // Get Homebridge 2 readiness status

    if (!plugin.verified || releaseDate < twelveMonthsAgo) {
      return false;
    }

    // Count plugins based on readiness status
    if (hb2Status === 'Supported') {
      hb2ReadyCount++;
    } else {
      hb2NotReadyCount++;
    }

    // Only return plugins that are Homebridge 2 ready
    return releaseDate >= twelveMonthsAgo && hb2Status === 'Not ready';
  });

  // Sort the filtered plugins by name
  filteredPlugins.sort((a, b) => a.name.localeCompare(b.name));

  // Create the markdown content for release date report
  let markdownContent = `# Plugin Summary Report (Based on Latest Release) - ${currentDate.toDateString()}\n\n`;
  markdownContent += `**Filters Applied:**\n- Verified: true\n- Latest Release within 12 months: ${twelveMonthsAgo.toDateString()} - ${currentDate.toDateString()}\n- Homebridge 2 Ready: Supported\n\n`;
  markdownContent += `**Total Plugins Homebridge 2 Ready:** ${hb2ReadyCount}<br>\n`;
  markdownContent += `**Total Plugins Not Homebridge 2 Ready:** ${hb2NotReadyCount}\n\n`;
  markdownContent += '| Name | Owner | Latest Release | Downloads | Verified | Homebridge 2 Status |\n';
  markdownContent += '| ---- | ----- | -------------- | --------- | -------- | ------------------- |\n';

  // Add the sorted and filtered plugin data to the table
  filteredPlugins.forEach(plugin => {
    const hb2Status = isHomebridge2Ready(plugin); // Recompute status to show in the table
    markdownContent += `| ${plugin.name} | ${plugin.owner} | ${plugin.latestRelease} | ${plugin.downloads} | ${plugin.verified} | ${hb2Status} |\n`;
  });

  // Save the markdown content to a file
  fs.writeFileSync('../plugin_summary_release_report.md', markdownContent, 'utf8');
  console.log('Release report saved as plugin_summary_release_report.md');
}

// Function to generate a markdown report based on downloads
function generateDownloadsReport(data) {
  const currentDate = new Date();

  let hb2ReadyCount = 0;
  let hb2NotReadyCount = 0;

  // Filter plugins based on the conditions: verified, more than 20 downloads, and Homebridge 2 Ready
  const filteredPlugins = data.filter(plugin => {
    const hb2Status = isHomebridge2Ready(plugin); // Get Homebridge 2 readiness status

    if (!plugin.verified || plugin.downloads <= 20) {
      return false;
    }

    // Count plugins based on readiness status
    if (hb2Status === 'Supported') {
      hb2ReadyCount++;
    } else {
      hb2NotReadyCount++;
    }

    // Only return plugins that have more than 20 downloads and are Homebridge 2 ready
    return plugin.downloads > 20 && hb2Status === 'Not ready';
  });

  // Sort the filtered plugins by name
  filteredPlugins.sort((a, b) => a.name.localeCompare(b.name));

  // Create the markdown content for downloads report
  let markdownContent = `# Plugin Summary Report (Based on Downloads) - ${currentDate.toDateString()}\n\n`;
  markdownContent += `**Filters Applied:**\n- Verified: true\n- Downloads > 20\n- Homebridge 2 Ready: Supported\n\n`;
  markdownContent += `**Total Plugins Homebridge 2 Ready:** ${hb2ReadyCount}<br>\n`;
  markdownContent += `**Total Plugins Not Homebridge 2 Ready:** ${hb2NotReadyCount}\n\n`;
  markdownContent += '| Name | Owner | Latest Release | Downloads | Verified | Homebridge 2 Status |\n';
  markdownContent += '| ---- | ----- | -------------- | --------- | -------- | ------------------- |\n';

  // Add the sorted and filtered plugin data to the table
  filteredPlugins.forEach(plugin => {
    const hb2Status = isHomebridge2Ready(plugin); // Recompute status to show in the table
    markdownContent += `| ${plugin.name} | ${plugin.owner} | ${plugin.latestRelease} | ${plugin.downloads} | ${plugin.verified} | ${hb2Status} |\n`;
  });

  // Save the markdown content to a file
  fs.writeFileSync('../plugin_summary_downloads_report.md', markdownContent, 'utf8');
  console.log('Downloads report saved as plugin_summary_downloads_report.md');
}

// Read data from the JSON file
const rawData = fs.readFileSync('../homebridge_plugins.json', 'utf8');
const dataSource = JSON.parse(rawData);

// Generate both reports
generateReleaseDateReport(dataSource);
generateDownloadsReport(dataSource);
