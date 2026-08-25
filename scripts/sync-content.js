import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	ensureContentDirectory,
	getContentSettings,
	prepareRuntime,
} from "./prepare-runtime.mjs";

function runGit(settings, args, { capture = false } = {}) {
	const output = execFileSync("git", args, {
		cwd: settings.contentDir,
		encoding: "utf8",
		stdio: capture ? "pipe" : "inherit",
	});
	return capture ? output.trim() : "";
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Synchronize the local content checkout without rewriting local work.
 * Development mode treats remote failures as warnings so offline work can continue.
 */
export function syncContentRepository(
	settings,
	{ development = false, noRemoteUpdate = false } = {},
) {
	if (!settings.enabled) return { status: "disabled" };

	const existed = fs.existsSync(settings.contentDir);
	ensureContentDirectory(settings, true);
	if (!existed) {
		return { status: "cloned" };
	}
	if (noRemoteUpdate || !fs.existsSync(path.join(settings.contentDir, ".git"))) {
		return { status: "local-only" };
	}

	if (!development) {
		const status = runGit(settings, ["status", "--porcelain"], {
			capture: true,
		});
		if (status) {
			throw new Error(
				"Content repository has local changes. Commit or stash them before synchronizing; no files were reset.",
			);
		}
	}

	const branch = runGit(settings, ["branch", "--show-current"], {
		capture: true,
	});
	if (!branch) {
		const message = "Content repository is in detached HEAD state.";
		if (!development) throw new Error(message);
		console.warn(`${message} Skipping the remote update check.`);
		return { status: "detached" };
	}

	try {
		runGit(settings, ["fetch", "origin", branch]);
	} catch (error) {
		if (!development) throw error;
		console.warn(
			`Could not check the remote content repository; continuing with local content: ${errorMessage(error)}`,
		);
		return { status: "fetch-failed" };
	}

	const behind = Number.parseInt(
		runGit(settings, ["rev-list", "--count", `HEAD..origin/${branch}`], {
			capture: true,
		}),
		10,
	);
	if (behind === 0) {
		console.log("Content repository is already up to date.");
		return { status: "up-to-date", behind };
	}

	if (development) {
		const status = runGit(settings, ["status", "--porcelain"], {
			capture: true,
		});
		if (status) {
			console.warn(
				`Remote content has ${behind} new commit(s), but CONTENT_DIR has local changes. Skipping the merge and continuing with local content.`,
			);
			return { status: "skipped-dirty", behind };
		}
	}

	try {
		runGit(settings, ["merge", "--ff-only", `origin/${branch}`]);
	} catch (error) {
		if (!development) throw error;
		console.warn(
			`Remote content could not be fast-forwarded; continuing with local content: ${errorMessage(error)}`,
		);
		return { status: "merge-failed", behind };
	}

	console.log(`Updated content repository by ${behind} commit(s).`);
	return { status: "updated", behind };
}

function isMainModule() {
	return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
	try {
		const settings = getContentSettings();
		const development = process.argv.includes("--dev");

		if (!settings.enabled) {
			console.log(
				"Content separation is disabled; preparing local runtime content.",
			);
		} else {
			syncContentRepository(settings, {
				development,
				noRemoteUpdate: process.argv.includes("--no-remote-update"),
			});
		}

		prepareRuntime();
	} catch (error) {
		console.error(`Content synchronization failed: ${errorMessage(error)}`);
		process.exitCode = 1;
	}
}
