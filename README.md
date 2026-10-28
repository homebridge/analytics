# developers.homebridge.io/analytics

This repo contains the Homebridge Plugin Analytics site

https://developers.homebridge.io/analytics

And some static reports

* [By npm Downloads in the last week](./plugin_summary_downloads_report.md)
* [By Release in the last 12 months](./plugin_summary_release_report.md)
* [All verified plugins](./plugin_summary_verified_report.md)

## Linking to a filtered view

The site reads its filters and sorting from the query string, and updates the URL as they change, so any view can be shared as a link. Values left at their defaults are left out of the URL, and unknown parameters are ignored.

| Parameter | Values | Default |
| --- | --- | --- |
| `name`, `description`, `version`, `owner` | Text, matched anywhere in the field, case-insensitive | |
| `downloads` | npm downloads last week, a number | |
| `downloadsComparison` | `equal`, `greater`, `less` | `equal` |
| `githubStars` | GitHub stars, a number | |
| `githubStarsComparison` | `equal`, `greater`, `less` | `equal` |
| `created` | Date, `YYYY-MM-DD` | |
| `createdComparison` | `after`, `before` | `after` |
| `lastUpdated` | Date, `YYYY-MM-DD` | |
| `lastUpdatedComparison` | `after`, `before` | `after` |
| `verified` | `true`, `false` | |
| `homebridge2Compatibility` | `Supported`, `Not ready` | |
| `transport` | `HAP`, `Matter`, `HAP + Matter` | |
| `starDataQuality` | `potential-mismatch` | |
| `sort` | `name`, `description`, `version`, `owner`, `downloads`, `githubStars`, `created`, `lastUpdated`, `homebridge2Compatibility`, `verified`, `transport` | |
| `order` | `desc`; anything else sorts ascending | |

Values with spaces or `+` must be URL-encoded, e.g. `Not%20ready` or `HAP%20%2B%20Matter`.

Examples:

* [Verified plugins](https://developers.homebridge.io/analytics/?verified=true): `?verified=true`
* [Verified plugins not ready for Homebridge 2, most downloaded first](https://developers.homebridge.io/analytics/?verified=true&homebridge2Compatibility=Not%20ready&sort=downloads&order=desc): `?verified=true&homebridge2Compatibility=Not%20ready&sort=downloads&order=desc`
* [More than 100 downloads last week, updated since 2026-01-01](https://developers.homebridge.io/analytics/?downloads=100&downloadsComparison=greater&lastUpdated=2026-01-01): `?downloads=100&downloadsComparison=greater&lastUpdated=2026-01-01`

## Data collection

GitHub star counts are cached in `homebridge_plugins.json` and refreshed incrementally. With `GITHUB_TOKEN` configured, the collector refreshes at most 4,000 repositories per run and considers counts fresh for seven days. Unauthenticated runs are capped at 50 requests. Set `GITHUB_STAR_REQUEST_LIMIT`, `GITHUB_STAR_REFRESH_DAYS`, or `GITHUB_STAR_CONCURRENCY` to override the authenticated defaults.

npm download counts for unscoped packages use bulk requests. Because npm does not support scoped packages in bulk lookups, scoped counts are cached and refreshed incrementally (100 per run by default). Transient failures are retried, and cached counts are retained if npm rate-limits the collector. Set `NPM_SCOPED_DOWNLOAD_REQUEST_LIMIT`, `NPM_DOWNLOAD_REFRESH_DAYS`, or `NPM_DOWNLOAD_REQUEST_DELAY_MS` to override those defaults.

The production collector paginates through all Homebridge plugins reported by npm, deduplicates package names, and stops if npm repeats a page. Set `PLUGIN_LIMIT` to a positive number only when a smaller local test run is desired. `MAX_PLUGIN_SEARCH_PAGES` defaults to 100 as a defensive safeguard against upstream pagination failures.
