import fs from "fs/promises";
import path from "path";
import axios from "axios";
import { loadEnv } from "./load-env.js";
import { matchSiteConfig } from "./read-site-config.mjs";
import { runtimeGeneratedDataDir } from "./prepare-runtime.mjs";

loadEnv();

const API_BASE = "https://api.bilibili.com/x/space/bangumi/follow/list";
const PAGE_SIZE = 30;
const OUTPUT_FILE = path.join(runtimeGeneratedDataDir, "bilibili-data.json");

// 状态映射: 1=想看, 2=在看, 3=已看
const STATUS_MAP = {
	1: "planned",
	2: "watching",
	3: "completed",
};

// 延迟函数
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 带重试机制的请求
async function withRetry(apiCall, retries = 3) {
	for (let i = 0; i < retries; i++) {
		try {
			return await apiCall();
		} catch (error) {
			if (i === retries - 1) throw error;
			await delay(1000);
			console.warn(`Request failed, retrying attempt ${i + 1}...`);
		}
	}
}

function getUserIdFromConfig() {
	const vmid = matchSiteConfig("bilibili", /vmid:\s*["']([^"']+)["']/);

	if (vmid === null) {
		console.error("✘ Failed to read Bilibili vmid from config/siteConfig.ts");
		throw new Error("Could not find bilibili.vmid in config/siteConfig.ts");
	}

	if (vmid.trim() === "") {
		console.warn("Warning: vmid in src/config/siteConfig.ts is empty.");
		return null;
	}

	return vmid;
}

async function getSessdataFromConfig() {
	return process.env.BILI_SESSDATA || "";
}

function getCoverMirrorFromConfig() {
	return matchSiteConfig("bilibili", /coverMirror:\s*["']([^"']*)["']/) ?? "";
}

function getUseWebpFromConfig() {
	return matchSiteConfig("bilibili", /useWebp:\s*(true|false)/) !== "false";
}

function getAnimeModeFromConfig() {
	return matchSiteConfig("anime", /mode:\s*["']([^"']+)["']/) || "bangumi";
}

function getRequestHeaders(SESSDATA) {
	return {
		referer: "https://space.bilibili.com/",
		...(SESSDATA ? { cookie: `SESSDATA=${SESSDATA};` } : {}),
	};
}

async function getDataPage(vmid, status, typeNum = 1, SESSDATA = "") {
	const response = await withRetry(() =>
		axios.get(
			`${API_BASE}?type=${typeNum}&follow_status=${status}&vmid=${vmid}&ps=1&pn=1`,
			{ headers: getRequestHeaders(SESSDATA), timeout: 10000 },
		),
	);

	if (
		response?.data?.code === 0 &&
		response?.data?.data?.total !== undefined
	) {
		return {
			success: true,
			data: Math.ceil(response.data.data.total / PAGE_SIZE) + 1,
		};
	}
	return {
		success: false,
		data: response?.data?.message || "Failed to fetch data",
	};
}

async function getData(
	vmid,
	status,
	typeNum,
	pn,
	useWebp,
	coverMirror,
	SESSDATA,
) {
	const response = await withRetry(() =>
		axios.get(
			`${API_BASE}?type=${typeNum}&follow_status=${status}&vmid=${vmid}&ps=${PAGE_SIZE}&pn=${pn}`,
			{ headers: getRequestHeaders(SESSDATA), timeout: 10000 },
		),
	);

	if (response?.data?.code !== 0) {
		throw new Error(
			`Failed to fetch data: ${response?.data?.message || "Unknown error"}`,
		);
	}

	return (response?.data?.data?.list || []).map((bangumi) => {
		// 处理封面图
		let cover = bangumi?.cover || "";
		if (cover) {
			try {
				// 确保使用 https
				if (cover.startsWith("http://")) {
					cover = cover.replace("http://", "https://");
				}
				// 如果需要WebP格式
				if (useWebp && !cover.includes("@")) {
					try {
						const urlObj = new URL(cover);
						// 如果路径中还没有尺寸参数，添加WebP优化参数
						if (!urlObj.pathname.includes("@")) {
							urlObj.pathname += "@220w_280h.webp";
							cover = urlObj.toString();
						}
					} catch {
						// URL解析失败，使用原始封面
					}
				}
				// 如果需要使用镜像源
				if (coverMirror) {
					cover = `${coverMirror}${cover}`;
				}
			} catch {
				// URL处理失败，使用原始封面
			}
		}

		// 处理观看进度
		let progress = 0;
		if (bangumi?.progress) {
			// progress可能是字符串如"1/14"或数字或空字符串
			if (
				typeof bangumi.progress === "string" &&
				bangumi.progress.trim()
			) {
				const progressMatch = bangumi.progress.match(/(\d+)/);
				if (progressMatch) {
					progress = parseInt(progressMatch[1], 10) || 0;
				}
			} else if (typeof bangumi.progress === "number") {
				progress = bangumi.progress;
			}
		}

		// 总集数
		const totalEpisodes = bangumi?.total_count || 0;
		const progressPercent =
			totalEpisodes > 0 && progress > 0
				? Math.round((progress / totalEpisodes) * 100)
				: 0;

		// 描述（从evaluate或summary字段获取）
		let description = bangumi?.evaluate || bangumi?.summary || "";
		// 清理描述中的特殊字符和换行
		if (description) {
			description = description
				.replace(/\u003c/g, "<")
				.replace(/\u003e/g, ">")
				.replace(/\n/g, " ")
				.trim();
		}

		// 提取年份（从发布时间或发布日期）
		let year = "";
		if (bangumi?.publish?.release_date) {
			// 优先使用release_date，格式如 "2018-07-08"
			const dateMatch = bangumi.publish.release_date.match(/^(\d{4})/);
			if (dateMatch) {
				year = dateMatch[1];
			}
		} else if (bangumi?.publish?.pub_time) {
			// 如果release_date不存在，使用pub_time，格式如 "2018-07-08 00:30:00"
			const dateMatch = bangumi.publish.pub_time.match(/^(\d{4})/);
			if (dateMatch) {
				year = dateMatch[1];
			}
		}

		// 提取地区/制作信息（作为studio）
		let studio = "";
		if (bangumi?.areas && bangumi.areas.length > 0) {
			studio = bangumi.areas[0].name || "";
		}

		// 提取类型/标签（使用styles数组）
		const genre = [];
		if (bangumi?.styles && Array.isArray(bangumi.styles)) {
			// 使用styles作为genre
			genre.push(...bangumi.styles);
		}
		// 如果没有styles，使用season_type_name作为备选
		if (genre.length === 0 && bangumi?.season_type_name) {
			genre.push(bangumi.season_type_name);
		}
		// 如果还是没有，使用"未知"
		if (genre.length === 0) {
			genre.push("Unknown");
		}

		// 构建链接（优先使用url字段，否则使用season_id）
		let link = "#";
		if (bangumi?.url) {
			link = bangumi.url;
		} else if (bangumi?.season_id) {
			link = `https://www.bilibili.com/bangumi/play/ss${bangumi.season_id}`;
		} else if (bangumi?.media_id) {
			link = `https://www.bilibili.com/bangumi/media/md${bangumi.media_id}/`;
		}

		return {
			title: bangumi?.title || "Unknown",
			status: STATUS_MAP[status] || "planned",
			rating: bangumi?.rating?.score
				? parseFloat(bangumi.rating.score.toFixed(1))
				: 0,
			cover: cover,
			description: description,
			year: year,
			studio: studio,
			genre: genre,
			link: link,
			progress: progress,
			totalEpisodes: totalEpisodes,
			progressPercent: progressPercent,
		};
	});
}

async function processData(
	vmid,
	status,
	typeNum,
	useWebp,
	coverMirror,
	SESSDATA,
) {
	const page = await getDataPage(vmid, status, typeNum, SESSDATA);
	if (!page?.success) {
		throw new Error(`Failed to fetch Bilibili page count: ${page?.data}`);
	}

	const list = [];
	const totalPages = page.data - 1;

	for (let i = 1; i < page.data; i++) {
		process.stdout.write(`   Fetching page ${i}/${totalPages}...\r`);
		const data = await getData(
			vmid,
			status,
			typeNum,
			i,
			useWebp,
			coverMirror,
			SESSDATA,
		);
		list.push(...data);
		await delay(300); // 延迟避免请求过快
	}
	console.log("");
	return list;
}

async function main() {
	console.log("Initializing Bilibili data update script...");

	const animeMode = getAnimeModeFromConfig();
	if (animeMode !== "bilibili") {
		console.log(
			`Detected current anime mode is "${animeMode}", skipping Bilibili data update.`,
		);
		return;
	}

	const VMID = getUserIdFromConfig();
	if (!VMID) {
		console.error(
			"✘ Bilibili vmid is not set. Please set it in src/config/siteConfig.ts",
		);
		process.exit(1);
	}
	console.log(`Read User ID: ${VMID}`);

	const SESSDATA = await getSessdataFromConfig();
	const coverMirror = getCoverMirrorFromConfig();
	const useWebp = getUseWebpFromConfig();

	// 获取三种状态的数据 (1=想看, 2=在看, 3=已看)
	console.log("\nFetching Bilibili bangumi data...");
	const planned = await processData(
		VMID,
		1,
		1,
		useWebp,
		coverMirror,
		SESSDATA,
	);
	const watching = await processData(
		VMID,
		2,
		1,
		useWebp,
		coverMirror,
		SESSDATA,
	);
	const completed = await processData(
		VMID,
		3,
		1,
		useWebp,
		coverMirror,
		SESSDATA,
	);

	const finalAnimeList = [...planned, ...watching, ...completed];

	const dir = path.dirname(OUTPUT_FILE);
	try {
		await fs.access(dir);
	} catch {
		await fs.mkdir(dir, { recursive: true });
	}

	const temporaryFile = `${OUTPUT_FILE}.${process.pid}.tmp`;
	await fs.writeFile(temporaryFile, JSON.stringify(finalAnimeList, null, 2));
	await fs.rename(temporaryFile, OUTPUT_FILE);
	console.log(`\nUpdate complete! Data saved to: ${OUTPUT_FILE}`);
	console.log(`Total collected: ${finalAnimeList.length} anime series`);
	console.log(`  - Planned: ${planned.length}`);
	console.log(`  - Watching: ${watching.length}`);
	console.log(`  - Completed: ${completed.length}`);
}

main().catch((err) => {
	console.error("\n✘ Script execution error:");
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
