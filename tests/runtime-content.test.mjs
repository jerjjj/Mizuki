import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
	ensureContentDirectory,
	mirrorLayers,
	projectRoot,
} from "../scripts/prepare-runtime.mjs";
import { syncContentRepository } from "../scripts/sync-content.js";

const testId = randomUUID();
const testRoot = path.join(projectRoot, ".runtime", "tests", testId);
const baseDir = path.join(testRoot, "base");
const contentDir = path.join(testRoot, "content");
const destination = path.join(testRoot, "output");
const manifestName = `runtime-test-${testId}`;

function write(relativePath, value, root) {
	const filePath = path.join(root, relativePath);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, value, "utf8");
}

function git(args, cwd) {
	return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
}

after(() => {
	fs.rmSync(testRoot, { recursive: true, force: true });
	fs.rmSync(
		path.join(projectRoot, ".runtime", "manifests", `${manifestName}.json`),
		{
			force: true,
		},
	);
});

describe("runtime content materialization", () => {
	it("clones a missing content directory once and preserves an existing checkout", () => {
		const repositoryDir = path.join(testRoot, "repository");
		const checkoutDir = path.join(testRoot, "checkout");
		fs.mkdirSync(repositoryDir, { recursive: true });
		git(["init"], repositoryDir);
		write("posts/example.md", "remote-v1", repositoryDir);
		git(["add", "."], repositoryDir);
		git(
			[
				"-c",
				"user.name=Runtime Test",
				"-c",
				"user.email=runtime-test@example.invalid",
				"commit",
				"-m",
				"initial content",
			],
			repositoryDir,
		);

		const settings = {
			enabled: true,
			contentDir: checkoutDir,
			repositoryUrl: repositoryDir,
		};
		ensureContentDirectory(settings, true);
		assert.equal(
			fs.readFileSync(path.join(checkoutDir, "posts", "example.md"), "utf8"),
			"remote-v1",
		);

		write("posts/example.md", "local-draft", checkoutDir);
		write("posts/example.md", "remote-v2", repositoryDir);
		git(["add", "."], repositoryDir);
		git(
			[
				"-c",
				"user.name=Runtime Test",
				"-c",
				"user.email=runtime-test@example.invalid",
				"commit",
				"-m",
				"remote update",
			],
			repositoryDir,
		);

		ensureContentDirectory(settings, true);
		assert.equal(
			fs.readFileSync(path.join(checkoutDir, "posts", "example.md"), "utf8"),
			"local-draft",
		);
	});

	it("fast-forwards clean content and preserves dirty content during development", () => {
		const repositoryDir = path.join(testRoot, "sync-repository");
		const checkoutDir = path.join(testRoot, "sync-checkout");
		fs.mkdirSync(repositoryDir, { recursive: true });
		git(["init"], repositoryDir);
		write("posts/example.md", "remote-v1", repositoryDir);
		git(["add", "."], repositoryDir);
		git(
			[
				"-c",
				"user.name=Runtime Test",
				"-c",
				"user.email=runtime-test@example.invalid",
				"commit",
				"-m",
				"initial content",
			],
			repositoryDir,
		);

		const settings = {
			enabled: true,
			contentDir: checkoutDir,
			repositoryUrl: repositoryDir,
		};
		assert.equal(syncContentRepository(settings).status, "cloned");

		write("posts/example.md", "remote-v2", repositoryDir);
		git(["add", "."], repositoryDir);
		git(
			[
				"-c",
				"user.name=Runtime Test",
				"-c",
				"user.email=runtime-test@example.invalid",
				"commit",
				"-m",
				"remote update",
			],
			repositoryDir,
		);
		assert.equal(
			syncContentRepository(settings, { development: true }).status,
			"updated",
		);
		assert.equal(
			fs.readFileSync(path.join(checkoutDir, "posts", "example.md"), "utf8"),
			"remote-v2",
		);

		write("posts/example.md", "local-draft", checkoutDir);
		write("posts/example.md", "remote-v3", repositoryDir);
		git(["add", "."], repositoryDir);
		git(
			[
				"-c",
				"user.name=Runtime Test",
				"-c",
				"user.email=runtime-test@example.invalid",
				"commit",
				"-m",
				"second remote update",
			],
			repositoryDir,
		);
		const dirtyResult = syncContentRepository(settings, { development: true });
		assert.equal(dirtyResult.status, "skipped-dirty");
		assert.equal(dirtyResult.behind, 1);
		assert.equal(
			fs.readFileSync(path.join(checkoutDir, "posts", "example.md"), "utf8"),
			"local-draft",
		);
	});

	it("merges layers without changing either source", () => {
		write("base.txt", "base", baseDir);
		write("shared.txt", "default", baseDir);
		write("shared.txt", "content", contentDir);
		write("content.txt", "content-only", contentDir);

		mirrorLayers({
			destination,
			manifestName,
			layers: [{ source: baseDir }, { source: contentDir }],
		});

		assert.equal(
			fs.readFileSync(path.join(destination, "base.txt"), "utf8"),
			"base",
		);
		assert.equal(
			fs.readFileSync(path.join(destination, "shared.txt"), "utf8"),
			"content",
		);
		assert.equal(
			fs.readFileSync(path.join(destination, "content.txt"), "utf8"),
			"content-only",
		);
		assert.equal(
			fs.readFileSync(path.join(baseDir, "shared.txt"), "utf8"),
			"default",
		);
	});

	it("removes stale runtime files after a source deletion", () => {
		fs.unlinkSync(path.join(contentDir, "content.txt"));

		mirrorLayers({
			destination,
			manifestName,
			layers: [{ source: baseDir }, { source: contentDir }],
		});

		assert.equal(fs.existsSync(path.join(destination, "content.txt")), false);
	});
});
