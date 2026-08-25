import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { matchSiteConfig } from "./read-site-config.mjs";

function getAnimeModeFromConfig() {
	return matchSiteConfig("anime", /mode:\s*["']([^"']+)["']/) || "bangumi";
}

function getFetchOnDev(mode) {
	return matchSiteConfig(mode, /fetchOnDev:\s*(true|false)/) === "true";
}

function runScript(scriptPath) {
	return new Promise((resolve, reject) => {
		const script = spawn(process.execPath, [scriptPath], {
			stdio: "inherit",
		});

		script.on("close", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`Script exited with code ${code}`));
			}
		});

		script.on("error", (err) => {
			reject(err);
		});
	});
}

async function main() {
	const mode = getAnimeModeFromConfig();
	const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
	const development = process.argv.includes("--dev");

	if (development && !getFetchOnDev(mode)) {
		console.log(
			`Anime mode is "${mode}" and fetchOnDev is off; keeping the existing runtime cache.`,
		);
		return;
	}

	try {
		if (mode === "bilibili") {
			console.log("Detected anime mode: bilibili, running update-bilibili.mjs");
			await runScript(path.join(scriptsDir, "update-bilibili.mjs"));
		} else if (mode === "bangumi") {
			console.log("Detected anime mode: bangumi, running update-bangumi.mjs");
			await runScript(path.join(scriptsDir, "update-bangumi.mjs"));
		} else {
			console.log(`Anime mode is "${mode}", skipping data update.`);
		}
	} catch (error) {
		if (!development) throw error;
		console.warn(
			`Anime data refresh failed; continuing with the existing runtime cache: ${error.message}`,
		);
	}
}

main().catch((err) => {
	console.error("\n✘ Script execution error:");
	console.error(err);
	process.exit(1);
});
