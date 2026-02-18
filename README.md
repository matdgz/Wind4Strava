# Wind4Strava

Wind4Strava is a WebExtension that overlays wind direction and intensity on top of Strava route planning maps.

## Features

- Wind arrows over the map while planning or editing routes on Strava.
- Forecast offset control from `Now` to `+24h` (step `2h`).
- Density control (`1..10`) without extra fetches for the same area/time.
- Strava-integrated icon-only Wind toggle near map utility controls.
- Default state is `OFF` to avoid automatic API usage.
- 3D adaptation support with live redraw on map move/rotate/pitch.
- Hash fallback mode when map object cannot be detected, with warning state in 3D.
- Chromium + Firefox compatibility (MV3 + `browser_specific_settings.gecko`).

## Data Source

- Forecast API: [Open-Meteo](https://open-meteo.com/en/docs)
- Variables: `wind_speed_10m`, `wind_direction_10m`
- No API key required.

Note: Open-Meteo can rate-limit high traffic. Wind4Strava includes retry, cache fallback, and explicit daily-limit status messaging.

## Load From Source

### Chrome / Edge / Brave / Arc

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this project folder.
4. Open Strava route builder pages, for example:
   - `https://www.strava.com/maps/create`
   - `https://www.strava.com/routes/new`

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select this project's `manifest.json`.
4. Open a Strava route builder page.

## Development

Project layout:

- `manifest.json`: extension manifest
- `src/injector.js`: content-script bridge and settings sync
- `src/page-script.js`: in-page Strava integration and overlay rendering
- `src/popup.*`: popup UI controls
- `src/background.js`: background/service-worker injection support

## Release Notes / Changelog

- Human-readable release notes live in `CHANGELOG.md`.
- Current version is in `VERSION`.
- Tagging `vX.Y.Z` publishes a GitHub Release via `.github/workflows/release.yml`.

## Publishing Releases

1. Update `CHANGELOG.md` and move items from `Unreleased` to a new version section.
2. Update `VERSION`.
3. Tag and push:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

Detailed release process: `docs/RELEASING.md`.
