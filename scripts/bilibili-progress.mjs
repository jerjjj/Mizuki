/**
 * Normalize an episode number against the number of episodes reported by
 * Bilibili. Invalid or mismatched values are treated as unknown (0) rather
 * than being displayed as a misleading completion percentage.
 */
export function normalizeEpisodeProgress(progress, totalEpisodes) {
	const total = Number(totalEpisodes);
	const value = Number(progress);

	if (
		!Number.isInteger(total) ||
		total <= 0 ||
		!Number.isInteger(value) ||
		value < 0 ||
		value > total
	) {
		return 0;
	}

	return value;
}

/**
 * Parse Bilibili's progress field as an episode number.
 *
 * Bilibili also uses this field for clip numbers, minutes, and cumulative
 * cross-season progress, so an unqualified number must not be treated as an
 * episode. Only explicit "第 N 话/集/期" expressions are accepted from text.
 */
export function parseEpisodeProgress(rawProgress, totalEpisodes) {
	if (typeof rawProgress === "number") {
		return normalizeEpisodeProgress(rawProgress, totalEpisodes);
	}

	if (typeof rawProgress !== "string") {
		return 0;
	}

	const match = rawProgress.match(/第\s*(\d+)\s*[话集期]/);
	return match
		? normalizeEpisodeProgress(Number(match[1]), totalEpisodes)
		: 0;
}
