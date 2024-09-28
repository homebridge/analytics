#! /usr/local/bin/node

import fs from 'fs';

// Function to check if the plugin is Homebridge 2 ready
function isHomebridge2Ready(plugin) {
  const hbEngines = plugin.engines?.homebridge?.split('||').map((x) => x.trim()) || [];
  return hbEngines.some((x) => (x.startsWith('^2') || x.startsWith('>=2'))) ? 'Supported' : 'Not ready';
}

// Function to generate a markdown report
function generateMarkdownReport(data) {
  const currentDate = new Date();
  const twelveMonthsAgo = new Date(currentDate);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  let hb2ReadyCount = 0;
  let hb2NotReadyCount = 0;

  // Filter plugins based on the conditions: verified, latestRelease within 12 months, and Homebridge 2 Ready
  const filteredPlugins = data.filter(plugin => {
    const releaseDate = new Date(plugin.latestRelease);
    if (!plugin.verified || releaseDate < twelveMonthsAgo) {
      return false;
    }
    if (plugin.homebridge2ready === 'Supported') {
      hb2ReadyCount++;
    } else {
      hb2NotReadyCount++;
    }
    return plugin.verified && releaseDate >= twelveMonthsAgo && plugin.homebridge2ready === 'Not ready';
  });

  filteredPlugins.sort((a, b) => a.name.localeCompare(b.name));

  // Create the markdown content
  let markdownContent = `# Plugin Summary Report - ${currentDate.toDateString()}\n\n`;
  markdownContent += `**Filters Applied:**\n- Verified: true\n- Latest Release within 12 months: ${twelveMonthsAgo.toDateString()} - ${currentDate.toDateString()}\n- Homebridge 2 Ready: Supported\n\n`;
  markdownContent += `**Total Plugins Homebridge 2 Ready:** ${hb2ReadyCount}\n`;
  markdownContent += `**Total Plugins Not Homebridge 2 Ready:** ${hb2NotReadyCount}\n\n`;
  markdownContent += '| Name | Owner | Latest Release | Verified | Homebridge 2 Status |\n';
  markdownContent += '| ---- | ----- | -------------- | -------- | ------------------- |\n';

  filteredPlugins.forEach(plugin => {
    markdownContent += `| ${plugin.name} | ${plugin.owner} | ${plugin.latestRelease} | ${plugin.verified} | ${plugin.homebridge2ready} |\n`;
  });

  // Save the markdown content to a file
  fs.writeFileSync('../plugin_summary_report.md', markdownContent, 'utf8');
  console.log('Report saved as plugin_summary_report.md');
}

// Example data source
const rawData = fs.readFileSync('../homebridge_plugins.json', 'utf8');
const dataSource = JSON.parse(rawData); // Ensures data is par

// Generate the report
generateMarkdownReport(dataSource);
