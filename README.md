# developers.homebridge.io/analytics

This repo contains the Homebridge Plugin Analytics site

https://developers.homebridge.io/analytics

And some static reports

* [By Downloads in the last 12 months](./plugin_summary_downloads_report.md)
* [By Release in the last 12 months](./plugin_summary_release_report.md)

GitHub star counts are cached in `homebridge_plugins.json` and refreshed incrementally. With `GITHUB_TOKEN` configured, the collector refreshes at most 4,000 repositories per run and considers counts fresh for seven days. Unauthenticated runs are capped at 50 requests. Set `GITHUB_STAR_REQUEST_LIMIT`, `GITHUB_STAR_REFRESH_DAYS`, or `GITHUB_STAR_CONCURRENCY` to override the authenticated defaults.
