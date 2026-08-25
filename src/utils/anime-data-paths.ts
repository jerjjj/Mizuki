import fs from "node:fs";
import path from "node:path";

export function getAnimeDataPaths(
	filename: string,
	root = process.cwd(),
): string[] {
	return [
		path.join(root, ".runtime", "generated-data", filename),
		path.join(root, "src", "runtime-data", filename),
		path.join(root, "src", "data", filename),
	];
}

export function resolveAnimeDataPath(
	filename: string,
	root = process.cwd(),
): string | undefined {
	return getAnimeDataPaths(filename, root).find((candidate) =>
		fs.existsSync(candidate),
	);
}
