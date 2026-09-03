<template>
  <div class="container">
    <header class="page-header">
      <div>
        <p class="eyebrow">Plugin analytics</p>
        <h1>Homebridge Plugins</h1>
        <p class="page-subtitle">Explore compatibility, adoption, and project activity across the ecosystem.</p>
      </div>
      <div class="result-count" aria-live="polite">
        <strong>{{ filteredPlugins.length.toLocaleString() }}</strong>
        <span>of {{ plugins.length.toLocaleString() }} plugins</span>
      </div>
    </header>
    <div class="filters">
      <div class="filter-heading">
        <div>
          <h2>Filters</h2>
          <p>Combine fields to narrow the results.</p>
        </div>
        <button type="button" @click="resetFilters">Clear all</button>
      </div>
      <label :class="{ 'active-filter': filters.name }">Name: 
        <input v-model="filters.name" placeholder="Filter by name" />
      </label>
      <label :class="{ 'active-filter': filters.description }">Description: 
        <input v-model="filters.description" placeholder="Filter by description" />
      </label>
      <label :class="{ 'active-filter': filters.version }">Version: 
        <input v-model="filters.version" placeholder="Filter by version" />
      </label>
      <label :class="{ 'active-filter': filters.owner }">Owner: 
        <input v-model="filters.owner" placeholder="Filter by owner" />
      </label>
      <label :class="{ 'active-filter': filters.downloads !== '' }">npm Downloads — Last Week:
        <select v-model="downloadsComparison">
          <option value="equal">=</option>
          <option value="greater">></option>
          <option value="less">&lt;</option>
        </select>
        <input v-model.number="filters.downloads" type="number" min="0" step="1" placeholder="Filter weekly downloads" />
      </label>
      <label :class="{ 'active-filter': filters.githubStars !== '' }">GitHub Stars:
        <select v-model="githubStarsComparison">
          <option value="equal">=</option>
          <option value="greater">></option>
          <option value="less">&lt;</option>
        </select>
        <input v-model.number="filters.githubStars" type="number" min="0" step="1" placeholder="Filter by stars" />
      </label>
      <label :class="{ 'active-filter': filters.starDataQuality }">Star Data Quality:
        <select v-model="filters.starDataQuality">
          <option value="">All</option>
          <option value="potential-mismatch">Potential Repository Mismatch</option>
        </select>
      </label>
      <label :class="{ 'active-filter': filters.created }">Created: 
        <select v-model="createdComparison">
          <option value="after">After</option>
          <option value="before">Before</option>
        </select>
        <input type="date" v-model="filters.created" />
      </label>
      <label :class="{ 'active-filter': filters.lastUpdated }">Last Updated: 
        <select v-model="lastUpdatedComparison">
          <option value="after">After</option>
          <option value="before">Before</option>
        </select>
        <input type="date" v-model="filters.lastUpdated" />
      </label>
      <label :class="{ 'active-filter': filters.homebridge2Compatibility }">Homebridge 2.0 Ready: 
        <select v-model="filters.homebridge2Compatibility">
          <option value="">All</option>
          <option value="Supported">Supported</option>
          <option value="Not ready">Not Ready</option>
        </select>
      </label>
      <label :class="{ 'active-filter': filters.verified }">Verified: 
        <select v-model="filters.verified">
          <option value="">All</option>
          <option value="true">Verified</option>
          <option value="false">Not Verified</option>
        </select>
      </label>
      <label :class="{ 'active-filter': filters.transport }">Transport:
        <select v-model="filters.transport">
          <option value="">All</option>
          <option value="HAP">HAP</option>
          <option value="Matter">Matter</option>
          <option value="HAP + Matter">HAP + Matter</option>
        </select>
      </label>

    </div>

    <div class="summary">
      <p><strong>{{ filteredPlugins.length.toLocaleString() }}</strong> matching plugins</p>
      <div class="table-help">
        <span class="quality-legend" title="This is a review signal, not proof that the data is incorrect."><b>&#9888;</b> Name mismatch requires review</span>
        <span>Click a column heading to sort</span>
      </div>
    </div>
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th v-for="column in columns" :key="column.key" :class="getHeaderClass(column.key)" :aria-sort="getAriaSort(column.key)" :title="column.title || column.label" tabindex="0" @click="sortTable(column.key)" @keydown.enter.prevent="sortTable(column.key)" @keydown.space.prevent="sortTable(column.key)">{{ column.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="plugin in sortedPlugins" :key="plugin.name">
            <td class="plugin-name"><a :href="'https://www.npmjs.com/package/' + plugin.name" target="_blank" rel="noopener noreferrer">{{ plugin.name }}</a></td>
            <td class="description-cell">{{ plugin.description }}</td>
            <td><span class="version-tag">{{ plugin.version }}</span></td>
            <td>{{ plugin.owner }}</td>
            <td class="numeric-cell">{{ formatNumber(getWeeklyNpmDownloads(plugin)) }}</td>
            <td class="numeric-cell">
              <a v-if="plugin.githubRepo" :href="plugin.githubRepo" target="_blank" rel="noopener noreferrer">
                {{ Number.isInteger(plugin.githubStars) ? formatNumber(plugin.githubStars) : 'N/A' }}
              </a>
              <span v-else>N/A</span>
              <span
                v-if="hasPotentialGithubMismatch(plugin)"
                class="data-warning"
                title="The package and GitHub repository names appear unrelated; verify this star count."
                aria-label="Potential repository mismatch"
              >&#9888;</span>
            </td>
            <td>{{ new Date(plugin.created).toLocaleDateString() }}</td>
            <td>{{ new Date(plugin.lastUpdated).toLocaleDateString() }}</td>
            <td><span :class="['status-badge', isHomebridge2Ready(plugin) === 'Supported' ? 'status-positive' : 'status-neutral']">{{ isHomebridge2Ready(plugin) }}</span></td>
            <td><span :class="['status-badge', plugin.verified ? 'status-positive' : 'status-neutral']">{{ plugin.verified ? 'Verified' : 'Not verified' }}</span></td>
            <td><span class="transport-badge">{{ getPluginTransport(plugin) }}</span></td>
          </tr>
          <tr v-if="sortedPlugins.length === 0">
            <td colspan="11" class="empty-state">No plugins match these filters. Try clearing one or more fields.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script>
import {
  compareStarDataQuality,
  getWeeklyNpmDownloads,
  hasPotentialGithubMismatch,
  matchesNumericFilter,
  matchesStarDataQualityFilter,
  matchesTransportFilter,
} from '../pluginFilters.js';
import { getPluginTransport } from '../pluginTransports.js';

export default {
  props: {
    plugins: {
      type: Array,
      default: () => []
    }
  },
  data() {
    return {
      filters: {
        name: "",
        description: "",
        version: "",
        owner: "",
        downloads: "",
        githubStars: "",
        starDataQuality: "",
        created: "",
        lastUpdated: "",
        homebridge2Compatibility: "",
        verified: "",
        transport: ""
      },
      downloadsComparison: 'equal',
      githubStarsComparison: 'equal',
      createdComparison: 'after',
      lastUpdatedComparison: 'after',
      sortKey: null,
      sortOrder: 'asc',
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'description', label: 'Description' },
        { key: 'version', label: 'Version' },
        { key: 'owner', label: 'Owner' },
        { key: 'downloads', label: 'npm / week', title: 'npm Downloads — Last Week' },
        { key: 'githubStars', label: 'Stars', title: 'GitHub Stars' },
        { key: 'created', label: 'Created' },
        { key: 'lastUpdated', label: 'Last Updated' },
        { key: 'homebridge2Compatibility', label: 'Homebridge 2.0 Ready' },
        { key: 'verified', label: 'Verified' },
        { key: 'transport', label: 'Transport' }
      ]
    };
  },
  computed: {
    filteredPlugins() {
      return this.plugins.filter(plugin => {
        const downloadsCondition = matchesNumericFilter(
          getWeeklyNpmDownloads(plugin),
          this.filters.downloads,
          this.downloadsComparison
        );

        const githubStarsCondition = matchesNumericFilter(
          plugin.githubStars,
          this.filters.githubStars,
          this.githubStarsComparison
        );
        const starDataQualityCondition = matchesStarDataQualityFilter(plugin, this.filters.starDataQuality);

        const createdValid = this.filters.created && this.filters.created !== "";
        const createdCondition = createdValid ?
          (this.createdComparison === 'after' ? new Date(plugin.created) > new Date(this.filters.created) :
          this.createdComparison === 'before' ? new Date(plugin.created) < new Date(this.filters.created) : true) : true;

        const lastUpdatedValid = this.filters.lastUpdated && this.filters.lastUpdated !== "";
        const lastUpdatedCondition = lastUpdatedValid ?
          (this.lastUpdatedComparison === 'after' ? new Date(plugin.lastUpdated) > new Date(this.filters.lastUpdated) :
          this.lastUpdatedComparison === 'before' ? new Date(plugin.lastUpdated) < new Date(this.filters.lastUpdated) : true) : true;

        const compatibilityCondition = this.filters.homebridge2Compatibility === "" || 
          (this.isHomebridge2Ready(plugin) === this.filters.homebridge2Compatibility);

        const verifiedCondition = this.filters.verified === "" || (plugin.verified === (this.filters.verified === "true"));
        const transportCondition = matchesTransportFilter(plugin, this.filters.transport);

        return (
          (this.filters.name === "" || (plugin.name && plugin.name.toLowerCase().includes(this.filters.name.toLowerCase()))) &&
          (this.filters.description === "" || (plugin.description && plugin.description.toLowerCase().includes(this.filters.description.toLowerCase()))) &&
          (this.filters.version === "" || (plugin.version && plugin.version.toLowerCase().includes(this.filters.version.toLowerCase()))) &&
          (this.filters.owner === "" || (plugin.owner && plugin.owner.toLowerCase().includes(this.filters.owner.toLowerCase()))) &&
          downloadsCondition &&
          githubStarsCondition &&
          starDataQualityCondition &&
          createdCondition &&
          lastUpdatedCondition &&
          compatibilityCondition &&
          verifiedCondition &&
          transportCondition
        );
      });
    },
    sortedPlugins() {
      let sorted = [...this.filteredPlugins];

      if (this.sortKey) {
        sorted.sort((a, b) => {
          if (this.sortKey === 'githubStars') {
            const qualityComparison = compareStarDataQuality(a, b);
            if (qualityComparison !== 0) return qualityComparison;
          }

          const aValue = this.getSortValue(a);
          const bValue = this.getSortValue(b);

          if (aValue === bValue) return 0;

          if (this.sortOrder === 'asc') {
            return aValue > bValue ? 1 : -1;
          } else {
            return aValue < bValue ? 1 : -1;
          }
        });
      }

      return sorted;
    }
  },
  methods: {
    resetFilters() {
      this.filters = {
        name: "",
        description: "",
        version: "",
        owner: "",
        downloads: "",
        githubStars: "",
        starDataQuality: "",
        created: "",
        lastUpdated: "",
        homebridge2Compatibility: "",
        verified: "",
        transport: ""
      };
      this.downloadsComparison = 'equal';
      this.githubStarsComparison = 'equal';
      this.createdComparison = 'after';
      this.lastUpdatedComparison = 'after';
      this.sortKey = null;
      this.sortOrder = 'asc';
    },
    getSortValue(plugin) {
      switch (this.sortKey) {
        case 'downloads':
          return getWeeklyNpmDownloads(plugin);
        case 'githubStars':
          return Number.isInteger(plugin.githubStars) ? plugin.githubStars : -1;
        case 'created':
          return new Date(plugin.created);
        case 'lastUpdated':
          return new Date(plugin.lastUpdated);
        case 'homebridge2Compatibility':
          return this.isHomebridge2Ready(plugin);
        case 'verified':
          return plugin.verified;
        case 'transport':
          return this.getPluginTransport(plugin);
        default:
          return plugin[this.sortKey] || "";
      }
    },
    isHomebridge2Ready(plugin) {
      const hbEngines = plugin.engines?.homebridge?.split('||').map((x) => x.trim()) || [];
      return hbEngines.some((x) => (x.startsWith('^2') || x.startsWith('>=2'))) ? 'Supported' : 'Not ready';
    },
    getPluginTransport,
    hasPotentialGithubMismatch,
    getWeeklyNpmDownloads,
    formatNumber(value) {
      return Number.isFinite(value) ? value.toLocaleString() : 'N/A';
    },
    sortTable(key) {
      if (this.sortKey === key) {
        this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortKey = key;
        this.sortOrder = 'asc';
      }
    },
    getHeaderClass(key) {
      return {
        'sorted-asc': this.sortKey === key && this.sortOrder === 'asc',
        'sorted-desc': this.sortKey === key && this.sortOrder === 'desc',
      };
    },
    getAriaSort(key) {
      if (this.sortKey !== key) return 'none';
      return this.sortOrder === 'asc' ? 'ascending' : 'descending';
    }
  }
};
</script>
