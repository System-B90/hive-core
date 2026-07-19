# CLAUDE.md — hive-core

Org-wide conventions (repo list, Hive-org boundary, package scopes, git workflow, commit
format, CI secrets) live in
[System-B90/.github CLAUDE.md](https://github.com/System-B90/.github/blob/main/CLAUDE.md).
This file covers what's specific to hive-core.

## What hive-core is

Shared TypeScript types and error classes, published as `@system-b90/hive-core` to
GitHub Packages. Consumed by bluz, madash, peek-a-boo.

## Git

Commit format: `Vibe-<PastTenseVerb> <description>` (e.g. `Vibe-Fixed`, `Vibe-Added`). No
`feat:`/`fix:`/`chore:` prefixes. Never commit directly to `main`/`master` — feature
branch + PR. Bump the package version deliberately before publishing — consumers pin
exact versions.
