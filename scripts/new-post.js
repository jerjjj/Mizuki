/* This is a script to create a new post markdown file with front-matter */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { loadEnv } from "./load-env.js";

function getDate() {
	const today = new Date();
	const year = today.getFullYear();
	const month = String(today.getMonth() + 1).padStart(2, "0");
	const day = String(today.getDate()).padStart(2, "0");

	return `${year}-${month}-${day}`;
}

const args = process.argv.slice(2);

if (args.length === 0) {
	console.error(`Error: No filename argument provided
Usage: npm run new-post -- <filename>`);
	process.exit(1); // Terminate the script and return error code 1
}

let fileName = args[0];

// Add .md extension if not present
const fileExtensionRegex = /\.(md|mdx)$/i;
if (!fileExtensionRegex.test(fileName)) {
	fileName += ".md";
}

loadEnv();
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const externalContentEnabled = process.env.ENABLE_CONTENT_SYNC === "true";
const contentDir = externalContentEnabled
	? path.resolve(rootDir, process.env.CONTENT_DIR || "./content")
	: path.join(rootDir, "src", "content");
const targetDir = path.join(contentDir, "posts");
const fullPath = path.resolve(targetDir, fileName);
const relativePath = path.relative(targetDir, fullPath);

if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
	console.error("Error: post path must stay inside the posts directory");
	process.exit(1);
}

if (fs.existsSync(fullPath)) {
	console.error(`Error: File ${fullPath} already exists `);
	process.exit(1);
}

// recursive mode creates multi-level directories
const dirPath = path.dirname(fullPath);
if (!fs.existsSync(dirPath)) {
	fs.mkdirSync(dirPath, { recursive: true });
}

const content = `---
title: ${args[0]}
published: ${getDate()}
description: ''
image: ''
tags: []
category: ''
draft: false 
lang: ''
---
`;

fs.writeFileSync(fullPath, content);

console.log(`Post ${fullPath} created`);
