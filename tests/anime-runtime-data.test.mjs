import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
	getAnimeDataPaths,
	resolveAnimeDataPath,
} from "../src/utils/anime-data-paths.ts";

const testRoot = path.join(
	process.cwd(),
	".runtime",
	"tests",
	`anime-data-${randomUUID()}`,
);
const filename = "bilibili-data.json";

function write(filePath, value) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, value, "utf8");
}

after(() => {
	fs.rmSync(testRoot, { recursive: true, force: true });
});

describe("anime runtime data paths", () => {
	it("prefers generated data, then external runtime data, then legacy data", () => {
		const [generated, runtime, legacy] = getAnimeDataPaths(filename, testRoot);

		assert.equal(resolveAnimeDataPath(filename, testRoot), undefined);
		write(legacy, "legacy");
		assert.equal(resolveAnimeDataPath(filename, testRoot), legacy);
		write(runtime, "runtime");
		assert.equal(resolveAnimeDataPath(filename, testRoot), runtime);
		write(generated, "generated");
		assert.equal(resolveAnimeDataPath(filename, testRoot), generated);
	});
});
