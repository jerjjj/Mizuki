import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const astroConfig = await readFile(
	new URL("../astro.config.mjs", import.meta.url),
	"utf8",
);
const layoutSource = await readFile(
	new URL("../src/layouts/Layout.astro", import.meta.url),
	"utf8",
);
const mainStyles = await readFile(
	new URL("../src/styles/main.css", import.meta.url),
	"utf8",
);
const configTypes = await readFile(
	new URL("../src/types/config.ts", import.meta.url),
	"utf8",
);
const fontModeSource = await readFile(
	new URL("../src/utils/fontMode.ts", import.meta.url),
	"utf8",
);
const fontCheckSource = await readFile(
	new URL("../scripts/check-font-loading.mjs", import.meta.url),
	"utf8",
);
const lxgwWenKaiChunks = [
	["base", "U+0-33FF"],
	["cjk-ext-a", "U+3400-4DFF"],
	["cjk-1", "U+4E00-65FF"],
	["cjk-2", "U+6600-7DFF"],
	["cjk-3", "U+7E00-9FFF"],
	["high", "U+A000-10FFFF"],
];

describe("Custom font loading boundary", () => {
	it("uses Nunito with chunked LXGW WenKai web fonts", async () => {
		assert.match(
			astroConfig,
			/name: "Nunito"[\s\S]*provider: fontProviders\.fontsource\(\)[\s\S]*weights: \["400 700"\]/,
		);
		assert.match(
			astroConfig,
			/name: "LXGW WenKai"[\s\S]*provider: fontProviders\.local\(\)/,
		);
		assert.doesNotMatch(
			astroConfig,
			/ZenMaruGothic-Medium\.woff2|loli\.woff2|name: "Loli"/,
		);
		assert.match(
			astroConfig,
			/lxgw-wenkai-500-\$\{name\}\.woff2/,
		);

		for (const [name, unicodeRange] of lxgwWenKaiChunks) {
			const font = await readFile(
				new URL(
					`../src/assets/fonts/lxgw-wenkai-500-${name}.woff2`,
					import.meta.url,
				),
			);
			assert.equal(font.subarray(0, 4).toString("ascii"), "wOF2");
			assert.ok(font.length > 1_000, `${name} must not be empty`);
			assert.ok(font.length <= 4 * 1024 * 1024, `${name} exceeds 4 MiB`);
			assert.ok(astroConfig.includes(unicodeRange));
		}
	});

	it("keeps the Nunito -> LXGW WenKai fallback contract", () => {
		assert.equal((astroConfig.match(/fallbacks: \[\]/g) ?? []).length, 2);
		assert.equal(
			(astroConfig.match(/optimizedFallbacks: false/g) ?? []).length,
			2,
		);
		assert.match(astroConfig, /name: "Nunito"[\s\S]*cssVariable: "--font-body"/);
		assert.match(
			astroConfig,
			/name: "LXGW WenKai"[\s\S]*cssVariable: "--font-cjk"/,
		);

		const bodyIndex = mainStyles.indexOf("var(--font-body");
		const cjkIndex = mainStyles.indexOf("var(--font-cjk");
		assert.ok(bodyIndex >= 0 && cjkIndex > bodyIndex);
	});

	it("only renders Astro Font components when custom mode is enabled", () => {
		assert.match(astroConfig, /fonts:\s*customFontsEnabled\s*\?\s*\[/);
		assert.equal(
			(layoutSource.match(/customFontsEnabled\s*&&\s*[(]?\s*<Font/g) ?? [])
				.length,
			3,
		);
		assert.match(
			layoutSource,
			/cssVariable="--font-body"\s+preload=\{\[\{ subset: "latin" \}\]\}/,
		);
	});

	it("defaults older configurations without a font block to custom mode", () => {
		assert.match(configTypes, /font\?:\s*{\s*mode\?:\s*"custom" \| "system"/);
		assert.match(
			fontModeSource,
			/environmentMode\s*\?\?\s*config\.font\?\.mode\s*\?\?\s*"custom"/,
		);
	});

	it("checks the font files referenced by output instead of a fixed directory", () => {
		assert.match(
			fontCheckSource,
			/MAX_FONT_FILE_BYTES\s*=\s*4 \* 1024 \* 1024/,
		);
		assert.match(fontCheckSource, /FONT_REFERENCE_PATTERN/);
		assert.match(fontCheckSource, /CUSTOM_FONT_VARIABLE_PATTERN/);
		assert.match(fontCheckSource, /emittedFontFiles/);
		assert.match(fontCheckSource, /referencedFontFiles/);
		assert.doesNotMatch(
			fontCheckSource,
			/join\(distDir,\s*"_astro",\s*"fonts"\)/,
		);
	});
});
