#!/usr/bin/env bash
set -euo pipefail

BUMP="${1:?Usage: pnpm version:bump [patch|minor|major]}"
case "$BUMP" in
  patch|minor|major) ;;
  *) echo "Error: invalid bump type '$BUMP'. Use patch, minor, or major." >&2; exit 1 ;;
esac

ROOT="$(git rev-parse --show-toplevel)"
PACKAGE="$ROOT/package.json"
APPJSON="$ROOT/app.json"

CURRENT=$(node -e "console.log(require(process.argv[1]).version)" "$PACKAGE")
echo "Current version: $CURRENT"

NEW=$(node -e "console.log(require('semver/functions/inc')(process.argv[1], process.argv[2]))" "$CURRENT" "$BUMP")
echo "New version: $NEW"

node -e "
  const fs = require('fs');
  const path = process.argv[1];
  const ver = process.argv[2];
  const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
  pkg.version = ver;
  fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
" "$PACKAGE" "$NEW"

node -e "
  const fs = require('fs');
  const path = process.argv[1];
  const ver = process.argv[2];
  const app = JSON.parse(fs.readFileSync(path, 'utf8'));
  const oldCode = app.expo.android.versionCode;
  app.expo.version = ver;
  app.expo.android.versionCode = oldCode + 1;
  app.expo.ios.buildNumber = String(oldCode + 1);
  fs.writeFileSync(path, JSON.stringify(app, null, 2) + '\n');
" "$APPJSON" "$NEW"

BUILDGRADLE="$ROOT/android/app/build.gradle"
node -e "
  const fs = require('fs');
  const path = process.argv[1];
  const ver = process.argv[2];
  const code = process.argv[3];
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace(/versionCode \d+/, 'versionCode ' + code);
  content = content.replace(/versionName \"[^\"]+\"/, 'versionName \"' + ver + '\"');
  fs.writeFileSync(path, content);
" "$BUILDGRADLE" "$NEW" "$(node -e "console.log(require(process.argv[1]).expo.android.versionCode)" "$APPJSON")"

git add "$PACKAGE" "$APPJSON" "$BUILDGRADLE"
git commit -m "Release v$NEW"
git tag -a "v$NEW" -m "Release v$NEW"

echo ""
echo "Done. Version bumped to $NEW."
echo "Push to publish: git push --follow-tags origin main"
