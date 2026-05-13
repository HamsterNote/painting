# Proposal: Expo Component Library Initialization

## Why

- Initialize project with TypeScript + Expo, ESLint, Prettier, yarn, `.gitignore`, Jest, Playwright
- Current repo is effectively empty: only `LICENSE` and `.sisyphus` planning artifacts exist
- This is NOT an application bootstrap; it is a React Native component library bootstrap
- The repo must expose a publishable library skeleton now, while deferring actual drawing/pointer implementation
- Expo Web is required because Playwright will be used for web E2E
- CI should be included and modeled selectively on `/home/zhangxiao/frontend/SysUI/chameleon`

## What Changes

- Root workspace config with `packageManager`, workspaces, shared scripts, and `.gitignore`
- Library package at `packages/painting` using React Native-compatible packaging and typed exports
- Expo example app at `apps/playground` that consumes the library by package name only
- Shared ESLint, Prettier, Jest, and Playwright configuration
- `.github/workflows/ci-pr.yml` and `.github/workflows/publish.yml` adapted from `chameleon` patterns

## Capabilities

- `apps/playground` Expo example app with web support
- `packages/painting` publishable package skeleton
- Shared root scripts: `lint`, `format:check`, `typecheck`, `build`, `test`, `test:ui`, `ci:local`, `pack:dry`, `playground:web`
- Jest configured for RN/Expo-compatible unit smoke tests
- Playwright configured for Expo Web smoke E2E with Chromium in CI
- CI order aligned with `chameleon`: install → lint → test → Playwright → build → pack dry-run

## Impact

- Bootstrap scope only - no drawing logic, canvas logic, pointer gesture handling, pressure/tilt support, or event API design
- No Storybook, Changesets, Turbo, semantic-release, docs site, Vite, or native iOS/Android E2E
- Library workspace-first, publishable React Native component library project that can be developed and smoke-tested through an Expo Web example app