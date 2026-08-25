import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	normalizeEpisodeProgress,
	parseEpisodeProgress,
} from "../scripts/bilibili-progress.mjs";

describe("Bilibili episode progress parsing", () => {
	it("accepts explicit episode expressions", () => {
		assert.equal(parseEpisodeProgress("看到第8话 10:33", 12), 8);
		assert.equal(parseEpisodeProgress("已看完第13话", 13), 13);
		assert.equal(parseEpisodeProgress("看到第 2 集", 12), 2);
	});

	it("rejects numbers from clips, times, and minutes", () => {
		assert.equal(parseEpisodeProgress("看到第37话 21:42", 12), 0);
		assert.equal(parseEpisodeProgress("看到剪辑44", 12), 0);
		assert.equal(parseEpisodeProgress("看到第34分钟", 1), 0);
		assert.equal(parseEpisodeProgress("1/14", 14), 0);
	});

	it("rejects progress that cannot belong to the reported season", () => {
		assert.equal(parseEpisodeProgress("看到第14话", 12), 0);
		assert.equal(normalizeEpisodeProgress(13, 12), 0);
		assert.equal(normalizeEpisodeProgress(-1, 12), 0);
		assert.equal(normalizeEpisodeProgress(8.5, 12), 0);
		assert.equal(normalizeEpisodeProgress(8, 0), 0);
	});
});
