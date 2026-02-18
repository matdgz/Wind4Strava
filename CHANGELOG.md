# Changelog

All notable changes to this project are documented here.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

## [1.0.0] - 2026-02-18

### Added

- Stable `Wind` + `Refresh` segmented control module on Strava map pages.
- Manual area refresh workflow to avoid unnecessary API calls while moving the map.
- Smart cache reuse for refresh operations in the same area/time window.

### Changed

- Wind overlay now starts `OFF` when entering Strava route/map pages to prevent automatic calls.
- Overlay redraw behavior while moving map reuses existing vectors; area refresh is explicit.
- Popup guidance and README updated to reflect manual refresh behavior.

### Fixed

- 3D and fallback redraw handling improvements for better map interaction stability.
- Better handling of Open-Meteo rate limits and daily-limit status reporting.
- Overlay z-order tuned so dynamic Strava UI elements appear above arrows.

## [0.2.11] - 2026-02-18

### Changed

- Merged the floating `Wind` + `Refresh` controls into one segmented visual module so both actions are clearly part of Wind4Strava.
- Removed spacing between the two map buttons and added shared container styling (single border, split divider).

## [0.2.10] - 2026-02-18

### Changed

- Switched to manual area refresh model on Strava maps: moving the map no longer auto-fetches new API data.
- Added a second floating map control button for explicit area refresh (`Wind` + `Refresh` group).
- Forced extension state to start `OFF` whenever entering a Strava route/map page.

### Fixed

- Preserved daily-limit error visibility in UI state instead of replacing it with generic “Map moved” messaging.
- Improved refresh/debug state reporting for map controls and area freshness.

## [0.2.9] - 2026-02-18

### Fixed

- Hardened map object detection against cross-origin frame access errors.
- Improved fallback viewport detection to avoid selecting internal overlay elements.
- Added explicit handling for Open-Meteo daily-limit responses to avoid indefinite loading state.

### Changed

- Improved default settings bootstrap so wind overlay is forced OFF on first run after install/update.
- Updated 3D/fallback rendering behavior and debug visibility fields.
- Refined floating Strava wind toggle behavior and popup settings synchronization.

## [0.2.8] - 2026-02-18

### Added

- Daily API limit detection and clearer user-facing status messages.

### Changed

- Keep last loaded vectors visible when transient rate-limit conditions occur.

## [0.2.7] - 2026-02-18

### Fixed

- Repaired hash-fallback map viewport detection for overlay placement and drawing.
- Corrected boolean normalization for persisted settings (`enabled`).

## [0.2.6] - 2026-02-18

### Changed

- Manifest compatibility cleanup for MV3 background service worker behavior.

## [0.2.5] - 2026-02-18

### Added

- 3D-aware arrow orientation using projection-derived vector direction.
- Live redraw on move/rotate/pitch without additional data fetches.
