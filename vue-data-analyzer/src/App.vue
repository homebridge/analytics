<template>
  <main>
    <div v-if="loading" class="app-state" role="status" aria-live="polite">
      <span class="loading-spinner" aria-hidden="true"></span>
      <strong>Loading plugin analytics…</strong>
      <span>Fetching the latest Homebridge plugin data.</span>
    </div>
    <div v-else-if="error" class="app-state app-error" role="alert">
      <strong>Plugin data could not be loaded</strong>
      <span>{{ error }}</span>
      <button type="button" @click="fetchPlugins">Try again</button>
    </div>
    <DataTable v-else :plugins="plugins" />
  </main>
</template>

<script>
import DataTable from './components/DataTable.vue';

export default {
  components: { DataTable },
  data() {
    return {
      plugins: [],
      loading: true,
      error: '',
      themeMessageHandler: null
    };
  },
  mounted() {
    this.configureTheme();
    this.fetchPlugins();
  },
  beforeUnmount() {
    if (this.themeMessageHandler) window.removeEventListener('message', this.themeMessageHandler);
  },
  methods: {
    async fetchPlugins() {
      this.loading = true;
      this.error = '';
      try {
        const response = await fetch('https://developers.homebridge.io/analytics/homebridge_plugins.json');
        if (!response.ok) {
          throw new Error(`The analytics service returned ${response.status}.`);
        }
        this.plugins = await response.json();
      } catch (error) {
        console.error('There was a problem with the fetch operation:', error);
this.error = 'Check your connection and try again later.';
      } finally {
        this.loading = false;
      }
    },
    applyTheme(theme) {
      if (theme === 'light' || theme === 'dark') {
        document.documentElement.dataset.theme = theme;
      }
    },
    configureTheme() {
      const requestedTheme = new URLSearchParams(window.location.search).get('theme');
      this.applyTheme(requestedTheme);

      this.themeMessageHandler = (event) => {
        if (event.data?.type === 'homebridge-theme') this.applyTheme(event.data.theme);
      };
      window.addEventListener('message', this.themeMessageHandler);
    }
  }
};
</script>
