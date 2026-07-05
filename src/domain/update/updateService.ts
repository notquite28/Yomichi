import Constants from 'expo-constants';

/**
 * Update availability check against public GitHub Releases.
 *
 * Yomiji ships as an APK on GitHub Releases (tagged `vX.Y.Z`), not through an
 * app store or EAS Update (runtimeVersion is pinned per release, so OTA never
 * applies). This service polls the public releases API and reports when the
 * latest published release is strictly newer than the running build.
 *
 * Offline-first: any network/parse/shape failure resolves to `null`. A failed
 * update check must never surface an error to the user.
 */

const REPO_OWNER = 'notquite28';
const REPO_NAME = 'yomiji';
const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

/** Minimal shape of the GitHub "latest release" payload we rely on. */
type GitHubReleaseAsset = {
  name?: unknown;
  browser_download_url?: unknown;
};

type GitHubRelease = {
  tag_name?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
};

export type UpdateInfo = {
  /** Latest published version, normalized (no leading `v`), e.g. "0.4.13". */
  latestVersion: string;
  /** Currently running version, e.g. "0.4.12". */
  currentVersion: string;
  /** Web page for the release (fallback link). */
  htmlUrl: string;
  /** Direct APK asset download URL, when present. Falls back to htmlUrl. */
  downloadUrl: string;
};

export type CheckForUpdateOptions = {
  /** Injectable fetch for tests. Defaults to global fetch. */
  fetcher?: typeof fetch;
  /** Override the running version. Defaults to expo-constants app version. */
  currentVersion?: string;
};

/** Strip a single leading `v`/`V` and surrounding whitespace from a tag. */
function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, '');
}

/**
 * Compare two dotted numeric version strings.
 * Returns >0 if `a` > `b`, <0 if `a` < `b`, 0 if equal.
 * Non-numeric or missing segments are treated as 0. Extra segments in the
 * longer version act as tie-breakers (e.g. "1.2.1" > "1.2").
 */
export function compareSemver(a: string, b: string): number {
  const aParts = normalizeVersion(a).split('.');
  const bParts = normalizeVersion(b).split('.');
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i += 1) {
    const aNum = Number.parseInt(aParts[i] ?? '0', 10);
    const bNum = Number.parseInt(bParts[i] ?? '0', 10);
    const aVal = Number.isNaN(aNum) ? 0 : aNum;
    const bVal = Number.isNaN(bNum) ? 0 : bNum;
    if (aVal !== bVal) {
      return aVal - bVal;
    }
  }
  return 0;
}

function getCurrentVersion(): string {
  const version = Constants.expoConfig?.version;
  return typeof version === 'string' ? version : '0.0.0';
}

/** Pick the APK asset download URL from a release, if one exists. */
function findApkUrl(release: GitHubRelease): string | null {
  if (!Array.isArray(release.assets)) {
    return null;
  }
  for (const asset of release.assets as GitHubReleaseAsset[]) {
    const name = typeof asset?.name === 'string' ? asset.name : '';
    const url = typeof asset?.browser_download_url === 'string' ? asset.browser_download_url : '';
    if (url && name.toLowerCase().endsWith('.apk')) {
      return url;
    }
  }
  return null;
}

/**
 * Resolve to update info when a strictly newer, non-draft, non-prerelease
 * release is available; otherwise `null`. Never throws.
 */
export async function checkForUpdate(options: CheckForUpdateOptions = {}): Promise<UpdateInfo | null> {
  const fetcher = options.fetcher ?? fetch;
  const currentVersion = options.currentVersion ?? getCurrentVersion();

  try {
    const response = await fetcher(LATEST_RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) {
      return null;
    }

    const release = (await response.json()) as GitHubRelease;
    if (release.draft === true || release.prerelease === true) {
      return null;
    }

    const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
    const latestVersion = normalizeVersion(tag);
    if (!latestVersion) {
      return null;
    }

    if (compareSemver(latestVersion, currentVersion) <= 0) {
      return null;
    }

    const htmlUrl = typeof release.html_url === 'string' ? release.html_url : '';
    const apkUrl = findApkUrl(release);
    const downloadUrl = apkUrl ?? htmlUrl;
    if (!downloadUrl) {
      return null;
    }

    return { latestVersion, currentVersion, htmlUrl: htmlUrl || downloadUrl, downloadUrl };
  } catch {
    return null;
  }
}
