# developers.homebridge.io/analytics

This repo contains the Homebridge Plugin Analytics site

https://developers.homebridge.io/analytics

And some static reports

* [By Downloads in the last 12 months](./plugin_summary_downloads_report.md)
* [By Release in the last 12 months](./plugin_summary_release_report.md)

GitHub star counts are cached in `homebridge_plugins.json` and refreshed incrementally. With `GITHUB_TOKEN` configured, the collector refreshes at most 4,000 repositories per run and considers counts fresh for seven days. Unauthenticated runs are capped at 50 requests. Set `GITHUB_STAR_REQUEST_LIMIT`, `GITHUB_STAR_REFRESH_DAYS`, or `GITHUB_STAR_CONCURRENCY` to override the authenticated defaults.

npm download counts for unscoped packages use bulk requests. Because npm does not support scoped packages in bulk lookups, scoped counts are cached and refreshed incrementally (100 per run by default). Transient failures are retried, and cached counts are retained if npm rate-limits the collector. Set `NPM_SCOPED_DOWNLOAD_REQUEST_LIMIT`, `NPM_DOWNLOAD_REFRESH_DAYS`, or `NPM_DOWNLOAD_REQUEST_DELAY_MS` to override those defaults.

The production collector paginates through all Homebridge plugins returned by npm. Set `PLUGIN_LIMIT` to a positive number only when a smaller local test run is desired.
