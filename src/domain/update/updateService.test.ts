// expo-constants is imported by updateService.ts; mock it before the module loads.
jest.mock("expo-constants", () => ({
	default: { expoConfig: { version: "0.4.12" } },
	__esModule: true,
}));

import { checkForUpdate, compareSemver } from "./updateService";

type FetchLike = typeof fetch;

function mockFetch(body: unknown, ok = true): FetchLike {
	return jest.fn(() =>
		Promise.resolve({
			ok,
			json: () => Promise.resolve(body),
		}),
	) as unknown as FetchLike;
}

function release(overrides: Record<string, unknown> = {}) {
	return {
		tag_name: "v0.4.13",
		html_url: "https://github.com/notquite28/yomiji/releases/tag/v0.4.13",
		draft: false,
		prerelease: false,
		assets: [
			{
				name: "build.apk",
				browser_download_url:
					"https://github.com/notquite28/yomiji/releases/download/v0.4.13/build.apk",
			},
		],
		...overrides,
	};
}

describe("compareSemver", () => {
	it("orders patch releases", () => {
		expect(compareSemver("0.4.13", "0.4.12")).toBeGreaterThan(0);
		expect(compareSemver("0.4.12", "0.4.13")).toBeLessThan(0);
		expect(compareSemver("0.4.12", "0.4.12")).toBe(0);
	});

	it("orders across major/minor", () => {
		expect(compareSemver("1.0.0", "0.9.9")).toBeGreaterThan(0);
		expect(compareSemver("0.5.0", "0.4.99")).toBeGreaterThan(0);
	});

	it("ignores a leading v and whitespace", () => {
		expect(compareSemver("v0.4.13", " 0.4.13 ")).toBe(0);
	});

	it("treats extra numeric segments as tie-breakers", () => {
		expect(compareSemver("1.2.1", "1.2")).toBeGreaterThan(0);
		expect(compareSemver("1.2", "1.2.0")).toBe(0);
	});
});

describe("checkForUpdate", () => {
	it("returns info when the remote release is newer", async () => {
		const info = await checkForUpdate({
			fetcher: mockFetch(release()),
			currentVersion: "0.4.12",
		});
		expect(info).toEqual({
			latestVersion: "0.4.13",
			currentVersion: "0.4.12",
			htmlUrl: "https://github.com/notquite28/yomiji/releases/tag/v0.4.13",
			downloadUrl:
				"https://github.com/notquite28/yomiji/releases/download/v0.4.13/build.apk",
		});
	});

	it("returns null when versions are equal", async () => {
		const info = await checkForUpdate({
			fetcher: mockFetch(release({ tag_name: "v0.4.12" })),
			currentVersion: "0.4.12",
		});
		expect(info).toBeNull();
	});

	it("returns null when the local build is ahead", async () => {
		const info = await checkForUpdate({
			fetcher: mockFetch(release({ tag_name: "v0.4.11" })),
			currentVersion: "0.4.12",
		});
		expect(info).toBeNull();
	});

	it("skips draft releases", async () => {
		const info = await checkForUpdate({
			fetcher: mockFetch(release({ draft: true })),
			currentVersion: "0.4.12",
		});
		expect(info).toBeNull();
	});

	it("skips prereleases", async () => {
		const info = await checkForUpdate({
			fetcher: mockFetch(release({ prerelease: true })),
			currentVersion: "0.4.12",
		});
		expect(info).toBeNull();
	});

	it("falls back to the html url when no apk asset exists", async () => {
		const info = await checkForUpdate({
			fetcher: mockFetch(release({ assets: [] })),
			currentVersion: "0.4.12",
		});
		expect(info?.downloadUrl).toBe(
			"https://github.com/notquite28/yomiji/releases/tag/v0.4.13",
		);
	});

	it("returns null on a non-ok response", async () => {
		const info = await checkForUpdate({
			fetcher: mockFetch(release(), false),
			currentVersion: "0.4.12",
		});
		expect(info).toBeNull();
	});

	it("returns null when the fetch throws", async () => {
		const fetcher = jest.fn(() =>
			Promise.reject(new Error("network down")),
		) as unknown as FetchLike;
		const info = await checkForUpdate({ fetcher, currentVersion: "0.4.12" });
		expect(info).toBeNull();
	});

	it("returns null when the payload is malformed", async () => {
		const info = await checkForUpdate({
			fetcher: mockFetch({ nonsense: true }),
			currentVersion: "0.4.12",
		});
		expect(info).toBeNull();
	});

	it("uses the expo-constants version when currentVersion is omitted", async () => {
		// Mocked expo-constants reports 0.4.12, so a 0.4.13 release is newer.
		const info = await checkForUpdate({ fetcher: mockFetch(release()) });
		expect(info?.latestVersion).toBe("0.4.13");
		expect(info?.currentVersion).toBe("0.4.12");
	});
});
