# Releasing Wind4Strava

## Versioning policy

- Follow Semantic Versioning (`MAJOR.MINOR.PATCH`).
- Keep `CHANGELOG.md` updated under `Unreleased` for user-visible changes.

## Prepare a release

1. Move changes from `Unreleased` to a new section in `CHANGELOG.md`:
   `## [X.Y.Z] - YYYY-MM-DD`
2. Update `VERSION` to `X.Y.Z`.
3. Commit the changes.
4. Create and push a git tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

## What the release workflow does

When a `v*.*.*` tag is pushed, GitHub Actions:

- builds extension artifacts from `manifest.json` and `src/`,
- generates release notes from `CHANGELOG.md`,
- publishes a GitHub Release with:
  - `Wind4Strava-X.Y.Z-webextension.zip`
  - `Wind4Strava-X.Y.Z-firefox.xpi`

Manual runs (`workflow_dispatch`) upload artifacts without publishing a release.

## Browser packaging notes

- Chromium browsers: load from unpacked folder or `.zip` contents.
- Firefox: use the `.xpi` artifact for signing/distribution workflows.
- For AMO and Chrome Web Store publication, follow each store's signing and listing requirements.
