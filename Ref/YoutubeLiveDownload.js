#!/usr/bin/env node
"use strict";

/**
 * YoutubeLiveDownload.js
 * Download YouTube livestream VODs at best quality using yt-dlp.
 *
 * Usage:
 *   node YoutubeLiveDownload.js [URL]        — download a single video
 *   node YoutubeLiveDownload.js --bulk        — read URLs from urls.txt and download all
 *   node YoutubeLiveDownload.js               — download the defaultUrl from CONFIG
 *
 * urls.txt format:
 *   One YouTube URL per line.
 *   Lines starting with # and blank lines are ignored.
 *
 * Extend this file by adding new functions to the PIPELINE section.
 */

const { spawnSync, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const CONFIG = {
  // Default video URL (used when no CLI argument is provided)
  defaultUrl: "https://www.youtube.com/watch?v=nV_IdawCBzQ",

  // Path to the URL list file used by --bulk mode
  urlListFile: path.join(__dirname, "youtube_urls.txt"),

  // Path to your YouTube cookies file exported from browser
  // If the file doesn't exist, the script continues without it (public videos only)
  cookiesFile: "C:\\Users\\NotOte\\Downloads\\www.youtube.com_cookies.txt",

  // Output folder for downloaded videos
  outputDir: path.join(__dirname, "Youtube_VOD"),

  // Output path template — files land inside outputDir
  // Variables: %(upload_date)s, %(title)s, %(id)s, %(ext)s etc.
  get outputTemplate() {
    return path.join(this.outputDir, "%(upload_date)s_%(title).180B_[%(id)s].%(ext)s");
  },

  // Video format preference: best MP4-compatible stream up to 1440p60
  format:
    "bestvideo[height<=1440][fps<=60][ext=mp4]+bestaudio[ext=m4a]" +
    "/best[height<=1440][fps<=60][ext=mp4]",

  // Force output container to MP4
  mergeOutputFormat: "mp4",

  // Remux to MP4 if container mismatch (no quality loss)
  remuxVideo: "mp4",

  // Extra HTTP headers to pass with each request
  headers: {
    Referer: "https://www.youtube.com/",
  },

  // User-agent string
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function checkDependency(name) {
  try {
    execSync(`where ${name}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function log(level, message) {
  const prefix = { INFO: "[INFO]", WARN: "[WARN]", ERROR: "[ERROR]" }[level] ?? "[INFO]";
  console.log(`${prefix} ${message}`);
}

// ─── PIPELINE ────────────────────────────────────────────────────────────────
// Add new steps here. Each function receives the resolved URL and CONFIG.

function buildArgs(url) {
  const args = [
    "-f", CONFIG.format,
    "--user-agent", CONFIG.userAgent,
    "--hls-prefer-ffmpeg",
    "--no-check-certificates",
    "--merge-output-format", CONFIG.mergeOutputFormat,
    "--remux-video", CONFIG.remuxVideo,
    "--output", CONFIG.outputTemplate,
  ];

  for (const [key, value] of Object.entries(CONFIG.headers)) {
    args.push("--add-header", `${key}: ${value}`);
  }

  if (fs.existsSync(CONFIG.cookiesFile)) {
    args.push("--cookies", CONFIG.cookiesFile);
  } else {
    log("WARN", `Cookies file not found at: ${CONFIG.cookiesFile}`);
    log("WARN", "Continuing without cookies. Age-restricted or private videos may fail.");
  }

  args.push(url);
  return args;
}

function resolveFilename(url) {
  // Ask yt-dlp for the final output name using the same options as download.
  const probeArgs = buildArgs(url);
  probeArgs.pop(); // remove URL
  probeArgs.push("--get-filename", url);

  const probe = spawnSync("yt-dlp", probeArgs, { encoding: "utf-8" });
  if (probe.status !== 0) return null;

  const name = probe.stdout ? probe.stdout.trim().split("\n").pop() : null;
  return name ? path.basename(name) : null;
}

function download(url) {
  log("INFO", `Starting download: ${url}`);

  const filename = resolveFilename(url);
  const args = buildArgs(url);

  // Stream yt-dlp output directly to the terminal in real time
  const result = spawnSync("yt-dlp", args, { stdio: "inherit" });

  if (result.status !== 0) {
    log("ERROR", `yt-dlp exited with code ${result.status}`);
    return { ok: false, filename: null };
  }

  log("INFO", "Download complete.");
  return { ok: true, filename };
}

function bulkDownload() {
  const listFile = CONFIG.urlListFile;

  if (!fs.existsSync(listFile)) {
    log("ERROR", `URL list file not found: ${listFile}`);
    log("ERROR", "Create youtube_urls.txt and add one YouTube URL per line.");
    process.exit(1);
  }

  const rawContent = fs.readFileSync(listFile, "utf-8");
  const lines = rawContent.split(/\r?\n/);
  const urls = lines
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (urls.length === 0) {
    log("WARN", `${path.basename(listFile)} is empty or has no uncommented URLs. Nothing to do.`);
    process.exit(0);
  }

  log("INFO", `Bulk mode — ${urls.length} URL(s) queued from ${listFile}`);
  console.log("");

  // Mark a URL as done: # [done] <url> | <filename>
  function markDone(url, filename) {
    const suffix = filename ? ` | ${filename}` : "";
    const current = fs.readFileSync(listFile, "utf-8");
    const updated = current
      .split(/\r?\n/)
      .map((l) => (l.trim() === url ? `# [done] ${l.trim()}${suffix}` : l))
      .join("\n");
    fs.writeFileSync(listFile, updated, "utf-8");
  }

  const failed = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`${"-".repeat(60)}`);
    log("INFO", `[${i + 1}/${urls.length}] ${url}`);
    console.log("");

    const { ok, filename } = download(url);
    if (ok) {
      markDone(url, filename);
      log("INFO", `Marked as done in youtube_urls.txt`);
    } else {
      failed.push(url);
    }

    console.log("");
  }

  console.log("=".repeat(60));
  log("INFO", `Bulk download finished. ${urls.length - failed.length}/${urls.length} succeeded.`);

  if (failed.length > 0) {
    log("WARN", "The following URLs failed:");
    failed.forEach((u) => log("WARN", `  ${u}`));
    process.exit(1);
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

function main() {
  if (!checkDependency("yt-dlp")) {
    log("ERROR", "yt-dlp is not installed or not in PATH.");
    log("ERROR", "Run: winget install --id yt-dlp.yt-dlp -e");
    process.exit(1);
  }

  // Ensure output folder exists
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    log("INFO", `Created output folder: ${CONFIG.outputDir}`);
  }

  const arg = process.argv[2];

  if (arg === "--bulk") {
    bulkDownload();
  } else {
    const url = arg || CONFIG.defaultUrl;
    const { ok } = download(url);
    if (!ok) process.exit(1);
  }
}

main();
