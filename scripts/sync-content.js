import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
	getContentSettings,
	prepareRuntime,
	projectRoot,
} from "./prepare-runtime.mjs";

const noRemoteUpdate = process.argv.includes("--no-remote-update");
const settings = getContentSettings();

function runGit(args, { capture = false } = {}) {
	const output = execFileSync("git", args, {
		cwd: settings.contentDir,
		encoding: "utf8",
		stdio: capture ? "pipe" : "inherit",
	});
	return capture ? output.trim() : "";
}

if (!settings.enabled) {
	console.log("Content separation is disabled; preparing local runtime content.");
	prepareRuntime();
	process.exit(0);
}

if (!fs.existsSync(settings.contentDir)) {
	if (!settings.repositoryUrl) {
		throw new Error(
			`CONTENT_DIR does not exist and CONTENT_REPO_URL is empty: ${settings.contentDir}`,
		);
	}
	fs.mkdirSync(path.dirname(settings.contentDir), { recursive: true });
	execFileSync(
		"git",
		["clone", "--depth", "1", settings.repositoryUrl, settings.contentDir],
		{ cwd: projectRoot, stdio: "inherit" },
	);
} else if (fs.existsSync(path.join(settings.contentDir, ".git")) && !noRemoteUpdate) {
	const status = runGit(["status", "--porcelain"], { capture: true });
	if (status) {
		throw new Error(
			"Content repository has local changes. Commit or stash them before synchronizing; no files were reset.",
		);
	}
	const branch = runGit(["branch", "--show-current"], { capture: true });
	if (!branch) {
		throw new Error("Content repository is in detached HEAD state.");
	}
	runGit(["fetch", "origin", branch]);
	runGit(["merge", "--ff-only", `origin/${branch}`]);
}

prepareRuntime();
