# Changelog

All notable changes to this project are documented here.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

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

