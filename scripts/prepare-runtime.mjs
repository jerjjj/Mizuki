import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "./load-env.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(scriptDir, "..");

const runtimeRoot = path.join(projectRoot, ".runtime");
export const runtimePublicDir = path.join(runtimeRoot, "public");
const runtimeContentDir = path.join(projectRoot, "src", "runtime-content");
const runtimeDataDir = path.join(projectRoot, "src", "runtime-data");
const runtimeOverrideDir = path.join(projectRoot, "src", "config", "overrides");
const manifestDir = path.join(runtimeRoot, "manifests");

function normalizeRelative(value) {
	return value.split(path.sep).join("/");
}

function resolveFromProject(value) {
	return path.isAbsolute(value) ? path.normalize(value) : path.resolve(projectRoot, value);
}

function assertRuntimeTarget(target) {
	const resolved = path.resolve(target);
	const allowedRoots = [
		runtimeRoot,
		runtimeContentDir,
		runtimeDataDir,
		runtimeOverrideDir,
	];
	if (
		!allowedRoots.some(
			(root) => resolved === root || resolved.startsWith(`${path.resolve(root)}${path.sep}`),
		)
	) {
		throw new Error(`Refusing to write outside runtime directories: ${resolved}`);
	}
}

function readManifest(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return { files: {} };
	}
}

function collectFiles(sourceDir, prefix = "", collected = []) {
	if (!fs.existsSync(sourceDir)) return collected;

	for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
		const absolutePath = path.join(sourceDir, entry.name);
		const relativePath = normalizeRelative(path.join(prefix, entry.name));
		if (entry.isDirectory()) {
			collectFiles(absolutePath, relativePath, collected);
		} else if (entry.isFile()) {
			collected.push({ absolutePath, relativePath });
		}
	}

	return collected;
}

function removeEmptyDirectories(directory, keepRoot = true) {
	if (!fs.existsSync(directory)) return;
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			removeEmptyDirectories(path.join(directory, entry.name), false);
		}
	}
	if (!keepRoot && fs.readdirSync(directory).length === 0) {
		fs.rmdirSync(directory);
	}
}

/**
 * Materialize layered source directories into one ignored runtime directory.
 * Later layers own collisions, which lets external content override defaults.
 */
export function mirrorLayers({ destination, layers, manifestName }) {
	assertRuntimeTarget(destination);
	const manifestPath = path.join(manifestDir, `${manifestName}.json`);
	const previous = readManifest(manifestPath);
	const desired = new Map();

	for (const layer of layers) {
		for (const file of collectFiles(layer.source, layer.prefix ?? "")) {
			desired.set(file.relativePath, file.absolutePath);
		}
	}

	fs.mkdirSync(destination, { recursive: true });
	const nextFiles = {};
	let copied = 0;
	let removed = 0;

	for (const [relativePath, sourcePath] of desired) {
		const sourceStat = fs.statSync(sourcePath);
		const destinationPath = path.join(destination, ...relativePath.split("/"));
		const signature = {
			source: path.resolve(sourcePath),
			size: sourceStat.size,
			mtimeMs: sourceStat.mtimeMs,
		};
		const oldSignature = previous.files?.[relativePath];
		const unchanged =
			oldSignature?.source === signature.source &&
			oldSignature?.size === signature.size &&
			oldSignature?.mtimeMs === signature.mtimeMs &&
			fs.existsSync(destinationPath);

		if (!unchanged) {
			fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
			fs.copyFileSync(sourcePath, destinationPath);
			copied++;
		}
		nextFiles[relativePath] = signature;
	}

	for (const file of collectFiles(destination)) {
		if (!desired.has(file.relativePath)) {
			fs.unlinkSync(file.absolutePath);
			removed++;
		}
	}
	removeEmptyDirectories(destination);

	fs.mkdirSync(manifestDir, { recursive: true });
	fs.writeFileSync(
		manifestPath,
		`${JSON.stringify({ files: nextFiles }, null, 2)}\n`,
		"utf8",
	);

	return { copied, removed, total: desired.size };
}

export function getContentSettings() {
	loadEnv();
	const enabled = process.env.ENABLE_CONTENT_SYNC === "true";
	const contentDir = resolveFromProject(process.env.CONTENT_DIR || "./content");
	return {
		enabled,
		contentDir,
		repositoryUrl: process.env.CONTENT_REPO_URL || "",
	};
}

export function ensureContentDirectory(settings, allowClone) {
	if (!settings.enabled || fs.existsSync(settings.contentDir)) return;
	if (!allowClone) {
		throw new Error(
			`External content directory does not exist: ${settings.contentDir}. Run pnpm init-content or set CONTENT_DIR in .env.`,
		);
	}
	if (!settings.repositoryUrl) {
		throw new Error(
			`External content directory does not exist and CONTENT_REPO_URL is empty: ${settings.contentDir}`,
		);
	}

	fs.mkdirSync(path.dirname(settings.contentDir), { recursive: true });
	execFileSync(
		"git",
		["clone", "--depth", "1", settings.repositoryUrl, settings.contentDir],
		{ cwd: projectRoot, stdio: "inherit" },
	);
}

function cleanRuntimeOutputs() {
	for (const target of [
		runtimePublicDir,
		runtimeContentDir,
		runtimeDataDir,
		runtimeOverrideDir,
		manifestDir,
	]) {
		assertRuntimeTarget(target);
		fs.rmSync(target, { recursive: true, force: true });
	}
}

export function prepareRuntime({ allowClone = false, clean = false } = {}) {
	const settings = getContentSettings();
	ensureContentDirectory(settings, allowClone);
	if (clean) cleanRuntimeOutputs();

	const externalRoot = settings.enabled ? settings.contentDir : null;
	const contentSource = externalRoot ?? path.join(projectRoot, "src", "content");
	const publicResult = mirrorLayers({
		destination: runtimePublicDir,
		manifestName: "public",
		layers: [
			{ source: path.join(projectRoot, "public") },
			...(externalRoot
				? [{ source: path.join(externalRoot, "images"), prefix: "images" }]
				: []),
		],
	});
	const contentResult = mirrorLayers({
		destination: runtimeContentDir,
		manifestName: "content",
		layers: [
			{ source: path.join(contentSource, "posts"), prefix: "posts" },
			{ source: path.join(contentSource, "spec"), prefix: "spec" },
		],
	});
	const dataResult = mirrorLayers({
		destination: runtimeDataDir,
		manifestName: "data",
		layers: [
			{ source: path.join(projectRoot, "src", "data") },
			...(externalRoot ? [{ source: path.join(externalRoot, "data") }] : []),
		],
	});
	const overrideResult = mirrorLayers({
		destination: runtimeOverrideDir,
		manifestName: "overrides",
		layers: externalRoot
			? [{ source: path.join(externalRoot, "overrides") }]
			: [],
	});

	console.log(
		`Runtime content ready (${settings.enabled ? settings.contentDir : "local content"}).`,
	);
	console.log(
		`  public: ${publicResult.total} files (${publicResult.copied} updated, ${publicResult.removed} removed)`,
	);
	console.log(
		`  content: ${contentResult.total}, data: ${dataResult.total}, overrides: ${overrideResult.total}`,
	);

	return {
		settings,
		runtimePublicDir,
		runtimeContentDir,
		runtimeDataDir,
		runtimeOverrideDir,
	};
}

export function getRuntimeWatchDirectories() {
	const settings = getContentSettings();
	return [
		path.join(projectRoot, "public"),
		path.join(projectRoot, "src", "data"),
		settings.enabled ? settings.contentDir : path.join(projectRoot, "src", "content"),
	].filter((directory) => fs.existsSync(directory));
}

function isMainModule() {
	return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
	try {
		prepareRuntime({
			allowClone: process.argv.includes("--allow-clone"),
			clean: process.argv.includes("--clean"),
		});
	} catch (error) {
		console.error(`Runtime content preparation failed: ${error.message}`);
		process.exitCode = 1;
	}
}
