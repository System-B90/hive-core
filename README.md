# @system-b90/hive-core

Hive LMS entity types (`Clearance`, `CourseUser`, `Class`, …), the shared error hierarchy, and the `HiveClient` base class (token refresh, 401 retry, 500 backoff, cookie-auth fetch).

## Install

```powershell
"@system-b90:registry=https://npm.pkg.github.com" | Out-File -Append $HOME\.npmrc
"//npm.pkg.github.com/:_authToken=$env:GITHUB_TOKEN" | Out-File -Append $HOME\.npmrc

npm install @system-b90/hive-core
```

## Usage

```ts
import { HiveClient } from "@system-b90/hive-core";

class MyAppHiveClient extends HiveClient {
    async getWidgets() {
        return await this._get(this.buildUrl("/api/core/widgets/"));
    }
}
```

## Publishing

CI publishes on GitHub Release (or manual dispatch) via `.github/workflows/publish.yml`. Bump `version` in `package.json` before releasing.
