import fs from "fs";
import path from "path";
import { spawn, spawnSync } from "child_process";
import crypto from "crypto";

function nowIso() {
  return new Date().toISOString();
}

function toAbsolutePath(baseDir, value) {
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(baseDir, value);
}

function splitLines(chunk) {
  return String(chunk || "")
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function getYtDlpEnv() {
  return {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    LC_ALL: process.env.LC_ALL || "C.UTF-8",
    LANG: process.env.LANG || "C.UTF-8",
  };
}

function getCookieArgs(runtime) {
  const downloader = runtime.runtimeConfig?.downloader || {};

  if (typeof downloader.cookies_from_browser === "string" && downloader.cookies_from_browser.trim()) {
    return ["--cookies-from-browser", downloader.cookies_from_browser.trim()];
  }

  if (typeof downloader.cookies_file === "string" && downloader.cookies_file.trim()) {
    const cookiePath = toAbsolutePath(runtime.appDir, downloader.cookies_file.trim());
    if (fs.existsSync(cookiePath)) {
      return ["--cookies", cookiePath];
    }
  }

  return [];
}

function getFfmpegArgs(runtime) {
  const downloader = runtime.runtimeConfig?.downloader || {};
  const configured = String(downloader.ffmpeg_location || "").trim();

  if (!configured) {
    return [];
  }

  const ffmpegLocation = toAbsolutePath(runtime.appDir, configured);
  if (!fs.existsSync(ffmpegLocation)) {
    return [];
  }

  return ["--ffmpeg-location", ffmpegLocation];
}

function isCommandAvailable(command, baseDir) {
  const normalized = String(command || '').trim();
  if (!normalized) {
    return false;
  }

  if (path.isAbsolute(normalized) || normalized.includes('/') || normalized.includes('\\')) {
    const absolutePath = path.isAbsolute(normalized)
      ? normalized
      : path.resolve(baseDir, normalized);
    return fs.existsSync(absolutePath);
  }

  const whereCommand = process.platform === "win32" ? "where" : "which";
  const probe = spawnSync(whereCommand, [normalized], { encoding: "utf-8" });
  return probe.status === 0;
}

const DEFAULT_FORMAT = "bestvideo[height<=1440][fps<=60][ext=mp4]+bestaudio[ext=m4a]/best[height<=1440][fps<=60][ext=mp4]";

const DOWNLOAD_PRESETS = [
  {
    key: "best",
    label: "Best available (up to 1440p60)",
    description: "Highest quality with current VOOTED defaults.",
  },
  {
    key: "1080p",
    label: "1080p (up to 60fps)",
    description: "Smaller file size than best while still high quality.",
  },
  {
    key: "1080p30",
    label: "1080p 30fps",
    description: "1080p capped at 30fps — smaller file size than 1080p60.",
  },
  {
    key: "720p",
    label: "720p (up to 60fps)",
    description: "Balanced quality and download size.",
  },
  {
    key: "720p30",
    label: "720p 30fps",
    description: "720p capped at 30fps — good for slower connections.",
  },
  {
    key: "480p",
    label: "480p",
    description: "Lightweight files for quick downloads.",
  },
];

const PRESET_FORMAT_MAP = {
  "1080p": "bestvideo[height<=1080][fps<=60][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][fps<=60][ext=mp4]",
  "1080p30": "bestvideo[height<=1080][fps<=30][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][fps<=30][ext=mp4]",
  "720p": "bestvideo[height<=720][fps<=60][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][fps<=60][ext=mp4]",
  "720p30": "bestvideo[height<=720][fps<=30][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][fps<=30][ext=mp4]",
  "480p": "bestvideo[height<=480][fps<=60][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][fps<=60][ext=mp4]",
};

function normalizePreset(preset) {
  const normalized = String(preset || "best").trim().toLowerCase();
  if (DOWNLOAD_PRESETS.some((entry) => entry.key === normalized)) {
    return normalized;
  }
  return "best";
}

function getFormatForPreset(downloader, preset) {
  const normalizedPreset = normalizePreset(preset);
  if (normalizedPreset === "best") {
    return downloader.format || DEFAULT_FORMAT;
  }
  return PRESET_FORMAT_MAP[normalizedPreset] || downloader.format || DEFAULT_FORMAT;
}

function extractThumbnail(metadata) {
  if (typeof metadata?.thumbnail === "string" && metadata.thumbnail.trim()) {
    return metadata.thumbnail.trim();
  }

  if (Array.isArray(metadata?.thumbnails)) {
    const last = [...metadata.thumbnails]
      .map((item) => (typeof item?.url === "string" ? item.url : ""))
      .filter(Boolean)
      .pop();
    if (last) return last;
  }

  return "";
}

function parseYtDlpJson(stdout, parseErrorMessage) {
  try {
    return JSON.parse(stdout);
  } catch {
    const firstCurly = stdout.indexOf("{");
    const lastCurly = stdout.lastIndexOf("}");
    if (firstCurly < 0 || lastCurly <= firstCurly) {
      throw new Error(parseErrorMessage);
    }
    return JSON.parse(stdout.slice(firstCurly, lastCurly + 1));
  }
}

function normalizeStreamsTabUrl(channelUrl) {
  const normalizedUrl = String(channelUrl || "").trim();
  if (!normalizedUrl) {
    throw new Error("channelUrl is required");
  }

  if (!/^https?:\/\//i.test(normalizedUrl)) {
    throw new Error("channelUrl must start with http:// or https://");
  }

  let parsed;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    throw new Error("channelUrl is invalid");
  }

  if (!/youtube\.com$/i.test(parsed.hostname)) {
    throw new Error("channelUrl must be a YouTube channel URL");
  }

  const pathParts = parsed.pathname.split("/").filter(Boolean);
  if (pathParts.length === 0) {
    throw new Error("channelUrl is missing channel path");
  }

  if (pathParts[pathParts.length - 1].toLowerCase() !== "streams") {
    pathParts.push("streams");
  }

  parsed.pathname = `/${pathParts.join("/")}`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function formatUploadDate(raw) {
  const value = String(raw || "").trim();
  if (!/^\d{8}$/.test(value)) {
    return null;
  }
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function compactErrorText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(" ");
}

function buildYtDlpMetadataError(details, target) {
  const compact = compactErrorText(details);
  if (!compact) {
    return `Failed to fetch ${target} details from yt-dlp.`;
  }

  if (/sign in to confirm you're not a bot|cookies-from-browser|--cookies/i.test(compact)) {
    return `YouTube blocked metadata preview for this ${target}. Open Settings and refresh your cookie authentication, then try Preview again.`;
  }

  return `Failed to fetch ${target} details: ${compact}`;
}

function normalizeDisplayTitle(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function extractQualityLabel(rawText) {
  const value = String(rawText || "").replace(/\s+/g, " ").trim();
  if (!value) {
    return null;
  }

  const explicitMatch = value.match(/(\d{3,4}p\d{0,2})/i);
  if (explicitMatch?.[1]) {
    return explicitMatch[1].toLowerCase();
  }

  const bracketMatch = value.match(/\((\d{3,4}p)\)/i);
  if (bracketMatch?.[1]) {
    return bracketMatch[1].toLowerCase();
  }

  const resolutionMatch = value.match(/(\d{3,4})x(\d{3,4})/i);
  if (resolutionMatch?.[2]) {
    return `${resolutionMatch[2]}p`;
  }

  return null;
}

function parseProgressLine(line) {
  const match = String(line || "").match(
    /^\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+(~?\s*\S+)\s+at\s+(.+?)\s+ETA\s+(.+)$/i,
  );

  if (!match) {
    return null;
  }

  return {
    percent: Number(match[1]),
    estimatedSizeText: match[2].trim(),
    speedText: match[3].trim(),
    etaText: match[4].trim(),
  };
}

function terminateChildProcessTree(childProcess) {
  const pid = Number(childProcess?.pid);
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }

  if (process.platform === "win32") {
    const taskkill = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return taskkill.status === 0;
  }

  try {
    childProcess.kill("SIGTERM");
    return true;
  } catch {
    return false;
  }
}

function extractYouTubeVideoId(url) {
  const raw = String(url || "").trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();

    if (host.endsWith("youtube.com")) {
      const v = parsed.searchParams.get("v");
      if (v && v.trim()) {
        return v.trim();
      }
    }

    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      if (id && id.trim()) {
        return id.trim();
      }
    }
  } catch {
    return null;
  }

  return null;
}

function findRelatedJobFiles(job, outputDirAbs) {
  if (!outputDirAbs || !fs.existsSync(outputDirAbs)) {
    return [];
  }

  let entries = [];
  try {
    entries = fs.readdirSync(outputDirAbs, { withFileTypes: true });
  } catch {
    return [];
  }

  const outputName = String(job?.output_filename || "").trim();
  const outputNameLower = outputName.toLowerCase();
  const outputStemLower = outputNameLower
    ? outputNameLower.replace(/\.[^.]+$/, "")
    : "";

  const videoId = extractYouTubeVideoId(job?.url);
  const idMarker = videoId ? `[${videoId}]`.toLowerCase() : "";

  const candidates = new Set();

  entries.forEach((entry) => {
    if (!entry.isFile()) {
      return;
    }

    const name = entry.name;
    const lower = name.toLowerCase();

    const matchesOutputName = Boolean(outputNameLower) && lower === outputNameLower;
    const matchesOutputSidecar = Boolean(outputNameLower) && lower.startsWith(`${outputNameLower}.`);
    const matchesStem = Boolean(outputStemLower)
      && (lower.startsWith(`${outputStemLower}.`) || lower.startsWith(`${outputStemLower}_`));
    const matchesVideoMarker = Boolean(idMarker) && lower.includes(idMarker);

    if (matchesOutputName || matchesOutputSidecar || matchesStem || matchesVideoMarker) {
      candidates.add(path.join(outputDirAbs, name));
    }
  });

  return [...candidates];
}

function deleteRelatedJobFiles(job, outputDirAbs) {
  const files = findRelatedJobFiles(job, outputDirAbs);
  let deletedCount = 0;

  files.forEach((filePath) => {
    try {
      fs.unlinkSync(filePath);
      deletedCount += 1;
    } catch {
      // Best-effort cleanup; keep job deletion resilient even if a file is locked/missing.
    }
  });

  return deletedCount;
}

class YoutubeJobService {
  constructor(runtime) {
    this.runtime = runtime;
    this.jobs = [];
    this.activeJobId = null;
    this.currentProcess = null;
    this.queuePaused = false;
    this.isLoaded = false;
  }

  recoverInterruptedJobs() {
    let changed = false;

    this.jobs.forEach((job) => {
      if (job?.status !== "running") {
        return;
      }

      job.status = "paused";
      job.updated_at = nowIso();
      job.finished_at = null;
      job.speed_text = null;
      job.eta_text = null;
      this.appendLog(job, "Download was interrupted by app shutdown. Job recovered as paused; continue or cancel it.");
      changed = true;
    });

    if (changed) {
      this.persist();
    }
  }

  loadFromDisk() {
    if (this.isLoaded) {
      return;
    }

    const raw = fs.readFileSync(this.runtime.jobsFileAbs, "utf-8");
    const parsed = JSON.parse(raw);
    this.jobs = Array.isArray(parsed) ? parsed : [];
    this.recoverInterruptedJobs();
    this.isLoaded = true;
  }

  persist() {
    fs.writeFileSync(this.runtime.jobsFileAbs, `${JSON.stringify(this.jobs, null, 2)}\n`, "utf-8");
  }

  getMeta() {
    this.loadFromDisk();

    const command = this.runtime.runtimeConfig?.downloader?.yt_dlp_command || "yt-dlp";

    return {
      projectName: "VOOTED",
      databaseEnabled: false,
      appDir: this.runtime.appDir,
      runtimeConfigPath: this.runtime.runtimeConfigPath,
      vodOutputDir: this.runtime.vodOutputDirAbs,
      ytDlp: {
        command,
        available: isCommandAvailable(command, this.runtime.appDir),
      },
      cookieAuth: {
        mode:
          this.runtime.runtimeConfig?.downloader?.cookies_from_browser
            ? "browser"
            : this.runtime.runtimeConfig?.downloader?.cookies_file
              ? "file"
              : "none",
        browser: this.runtime.runtimeConfig?.downloader?.cookies_from_browser || "",
      },
      queue: {
        activeJobId: this.activeJobId,
        isPaused: this.queuePaused,
        total: this.jobs.length,
        queued: this.jobs.filter((job) => job.status === "queued").length,
        running: this.jobs.filter((job) => job.status === "running").length,
        paused: this.jobs.filter((job) => job.status === "paused").length,
        completed: this.jobs.filter((job) => job.status === "completed").length,
        failed: this.jobs.filter((job) => job.status === "failed").length,
        canceled: this.jobs.filter((job) => job.status === "canceled").length,
      },
    };
  }

  listJobs() {
    this.loadFromDisk();
    return [...this.jobs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  getJob(jobId) {
    this.loadFromDisk();
    return this.jobs.find((job) => job.id === jobId) || null;
  }

  appendLog(job, line) {
    job.logs = Array.isArray(job.logs) ? job.logs : [];
    job.logs.push(`[${nowIso()}] ${line}`);
    if (job.logs.length > 300) {
      job.logs = job.logs.slice(job.logs.length - 300);
    }
  }

  resolveFilename(url, preset = "best") {
    const downloader = this.runtime.runtimeConfig?.downloader || {};
    const outputTemplate = path.join(this.runtime.vodOutputDirAbs, "%(upload_date)s_%(title).180B_[%(id)s].%(ext)s");

    const args = [
      "-f", getFormatForPreset(downloader, preset),
      "--merge-output-format", downloader.merge_output_format || "mp4",
      "--remux-video", downloader.remux_video || "mp4",
      "--user-agent", downloader.user_agent || "Mozilla/5.0",
      "--output", outputTemplate,
    ];

    const headers = downloader.headers || {};
    Object.entries(headers).forEach(([key, value]) => {
      args.push("--add-header", `${key}: ${value}`);
    });

    args.push(...getCookieArgs(this.runtime));

    args.push("--get-filename", url);

    const command = downloader.yt_dlp_command || "yt-dlp";
    const probe = spawnSync(command, args, { encoding: "utf-8", env: getYtDlpEnv() });
    if (probe.status !== 0) {
      return null;
    }

    const finalLine = String(probe.stdout || "").trim().split("\n").pop();
    return finalLine ? path.basename(finalLine) : null;
  }

  resolveActualQuality(url, preset = "best") {
    const downloader = this.runtime.runtimeConfig?.downloader || {};
    const command = downloader.yt_dlp_command || "yt-dlp";
    const args = [
      "-f", getFormatForPreset(downloader, preset),
      "--merge-output-format", downloader.merge_output_format || "mp4",
      "--remux-video", downloader.remux_video || "mp4",
      "--user-agent", downloader.user_agent || "Mozilla/5.0",
      "--skip-download",
      "--no-warnings",
      "--print", "%(format)s",
    ];

    const headers = downloader.headers || {};
    Object.entries(headers).forEach(([key, value]) => {
      args.push("--add-header", `${key}: ${value}`);
    });

    args.push(...getCookieArgs(this.runtime));
    args.push(...getFfmpegArgs(this.runtime));
    args.push(url);

    const probe = spawnSync(command, args, {
      encoding: "utf-8",
      maxBuffer: 5 * 1024 * 1024,
      env: getYtDlpEnv(),
    });

    if (probe.status !== 0) {
      return null;
    }

    const line = splitLines(probe.stdout).find(Boolean);
    return extractQualityLabel(line || "");
  }

  buildDownloadArgs(url, preset = "best") {
    const downloader = this.runtime.runtimeConfig?.downloader || {};
    const outputTemplate = path.join(this.runtime.vodOutputDirAbs, "%(upload_date)s_%(title).180B_[%(id)s].%(ext)s");

    const args = [
      "-f", getFormatForPreset(downloader, preset),
      "--hls-prefer-ffmpeg",
      "--no-check-certificates",
      "--merge-output-format", downloader.merge_output_format || "mp4",
      "--remux-video", downloader.remux_video || "mp4",
      "--user-agent", downloader.user_agent || "Mozilla/5.0",
      "--output", outputTemplate,
    ];

    const headers = downloader.headers || {};
    Object.entries(headers).forEach(([key, value]) => {
      args.push("--add-header", `${key}: ${value}`);
    });

    args.push(...getCookieArgs(this.runtime));
    args.push(...getFfmpegArgs(this.runtime));

    args.push(url);
    return args;
  }

  getDownloadPresets() {
    return DOWNLOAD_PRESETS;
  }

  previewUrl(url) {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
      throw new Error("url is required");
    }

    if (!/^https?:\/\//i.test(normalizedUrl)) {
      throw new Error("url must start with http:// or https://");
    }

    const downloader = this.runtime.runtimeConfig?.downloader || {};
    const command = downloader.yt_dlp_command || "yt-dlp";
    const args = [
      "--dump-single-json",
      "--skip-download",
      "--no-warnings",
      "--encoding",
      "utf-8",
      ...getCookieArgs(this.runtime),
      normalizedUrl,
    ];

    const probe = spawnSync(command, args, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      env: getYtDlpEnv(),
    });

    if (probe.status !== 0) {
      const details = String(probe.stderr || probe.stdout || "").trim();
      throw new Error(buildYtDlpMetadataError(details, "video"));
    }

    const stdout = String(probe.stdout || "").trim();
    if (!stdout) {
      throw new Error("yt-dlp returned no metadata for this URL");
    }

    const metadata = parseYtDlpJson(stdout, "Could not parse yt-dlp metadata output");

    return {
      url: normalizedUrl,
      title: String(metadata.title || "Untitled video"),
      thumbnail: extractThumbnail(metadata),
      uploader: String(metadata.uploader || metadata.channel || ""),
      duration: Number.isFinite(Number(metadata.duration)) ? Number(metadata.duration) : null,
      viewCount: Number.isFinite(Number(metadata.view_count)) ? Number(metadata.view_count) : null,
      presets: this.getDownloadPresets(),
      defaultPreset: "best",
    };
  }

  previewChannelStreams(channelUrl) {
    const streamsTabUrl = normalizeStreamsTabUrl(channelUrl);
    const downloader = this.runtime.runtimeConfig?.downloader || {};
    const command = downloader.yt_dlp_command || "yt-dlp";
    const args = [
      "--flat-playlist",
      "--dump-single-json",
      "--skip-download",
      "--no-warnings",
      "--encoding",
      "utf-8",
      ...getCookieArgs(this.runtime),
      streamsTabUrl,
    ];

    const probe = spawnSync(command, args, {
      encoding: "utf-8",
      maxBuffer: 20 * 1024 * 1024,
      env: getYtDlpEnv(),
    });

    if (probe.status !== 0) {
      const details = String(probe.stderr || probe.stdout || "").trim();
      throw new Error(buildYtDlpMetadataError(details, "channel streams"));
    }

    const stdout = String(probe.stdout || "").trim();
    if (!stdout) {
      throw new Error("yt-dlp returned no stream metadata for this channel");
    }

    const metadata = parseYtDlpJson(stdout, "Could not parse yt-dlp channel metadata output");
    const entries = Array.isArray(metadata.entries) ? metadata.entries : [];

    const items = entries
      .map((entry) => {
        const videoId = String(entry?.id || "").trim();
        const watchUrl = typeof entry?.url === "string" && /^https?:\/\//i.test(entry.url)
          ? entry.url
          : (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");

        if (!watchUrl) {
          return null;
        }

        const thumbnail = extractThumbnail(entry)
          || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "");

        return {
          id: videoId || watchUrl,
          url: watchUrl,
          title: String(entry?.title || "Untitled stream"),
          thumbnail,
          uploader: String(entry?.uploader || metadata?.uploader || metadata?.title || ""),
          duration: Number.isFinite(Number(entry?.duration)) ? Number(entry.duration) : null,
          uploadDate: formatUploadDate(entry?.upload_date),
          uploadTimestamp: Number.isFinite(Number(entry?.timestamp)) ? Number(entry.timestamp) : null,
        };
      })
      .filter(Boolean);

    return {
      channelUrl: String(metadata?.channel_url || channelUrl || "").trim() || streamsTabUrl,
      streamsTabUrl,
      channelTitle: String(metadata?.uploader || metadata?.title || "YouTube channel"),
      total: items.length,
      items,
      presets: this.getDownloadPresets(),
      defaultPreset: "best",
    };
  }

  queueJobs(entries, preset = "best") {
    this.loadFromDisk();

    const inputEntries = Array.isArray(entries) ? entries : [];
    const normalizedPreset = normalizePreset(preset);

    const activeUrlSet = new Set(
      this.jobs
        .filter((job) => job && ["queued", "running"].includes(job.status))
        .map((job) => String(job.url || "").trim())
        .filter(Boolean),
    );

    const queued = [];
    let skipped = 0;

    for (const rawEntry of inputEntries) {
      const normalizedUrl = typeof rawEntry === "string"
        ? String(rawEntry || "").trim()
        : String(rawEntry?.url || "").trim();
      const displayTitle = typeof rawEntry === "string"
        ? null
        : normalizeDisplayTitle(rawEntry?.title);
      if (!normalizedUrl || !/^https?:\/\//i.test(normalizedUrl)) {
        skipped += 1;
        continue;
      }
      if (activeUrlSet.has(normalizedUrl)) {
        skipped += 1;
        continue;
      }

      const job = {
        id: crypto.randomUUID(),
        url: normalizedUrl,
        display_title: displayTitle,
        download_preset: normalizedPreset,
        actual_quality_text: null,
        status: "queued",
        created_at: nowIso(),
        updated_at: nowIso(),
        started_at: null,
        finished_at: null,
        output_filename: null,
        error: null,
        logs: [],
      };

      this.jobs.push(job);
      queued.push(job);
      activeUrlSet.add(normalizedUrl);
    }

    if (queued.length > 0) {
      this.persist();
      this.processQueue();
    }

    return {
      queued,
      queuedCount: queued.length,
      skippedCount: skipped,
    };
  }

  createJob(url, preset = "best", displayTitle = null) {
    this.loadFromDisk();

    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
      throw new Error("url is required");
    }

    if (!/^https?:\/\//i.test(normalizedUrl)) {
      throw new Error("url must start with http:// or https://");
    }

    const normalizedPreset = normalizePreset(preset);

    const job = {
      id: crypto.randomUUID(),
      url: normalizedUrl,
      display_title: normalizeDisplayTitle(displayTitle),
      download_preset: normalizedPreset,
      actual_quality_text: null,
      progress_percent: null,
      estimated_size_text: null,
      speed_text: null,
      eta_text: null,
      status: "queued",
      created_at: nowIso(),
      updated_at: nowIso(),
      started_at: null,
      finished_at: null,
      output_filename: null,
      error: null,
      logs: [],
    };

    this.jobs.push(job);
    this.persist();
    this.processQueue();

    return job;
  }

  cancelJob(jobId) {
    this.loadFromDisk();

    const job = this.jobs.find((entry) => entry.id === jobId);
    if (!job) {
      return null;
    }

    if (job.status === "queued") {
      job.status = "canceled";
      job.updated_at = nowIso();
      job.finished_at = nowIso();
      this.appendLog(job, "Job canceled before start.");
      this.persist();
      return job;
    }

    if (job.status === "paused") {
      job.status = "canceled";
      job.updated_at = nowIso();
      job.finished_at = nowIso();
      job.speed_text = null;
      job.eta_text = null;
      this.appendLog(job, "Paused job canceled.");
      this.persist();
      return job;
    }

    if (job.status === "running" && this.activeJobId === job.id && this.currentProcess) {
      const terminated = terminateChildProcessTree(this.currentProcess);
      this.appendLog(job, "Cancellation requested.");
      if (!terminated) {
        this.appendLog(job, "Warning: downloader process tree did not acknowledge termination immediately.");
      }
      job.status = "canceled";
      job.updated_at = nowIso();
      job.finished_at = nowIso();
      this.persist();
      return job;
    }

    return job;
  }

  resumeJob(jobId) {
    this.loadFromDisk();

    const job = this.jobs.find((entry) => entry.id === jobId);
    if (!job) {
      return null;
    }

    if (job.status !== "paused") {
      throw new Error("Only paused jobs can be continued.");
    }

    job.status = "queued";
    job.updated_at = nowIso();
    job.finished_at = null;
    job.speed_text = null;
    job.eta_text = null;
    this.appendLog(job, "Paused job returned to queue.");
    this.persist();
    this.processQueue();
    return job;
  }

  requeueJob(jobId) {
    this.loadFromDisk();

    const job = this.jobs.find((entry) => entry.id === jobId);
    if (!job) {
      return null;
    }

    if (job.status !== "canceled") {
      throw new Error("Only canceled jobs can be requeued.");
    }

    job.status = "queued";
    job.updated_at = nowIso();
    job.finished_at = null;
    job.error = null;
    job.speed_text = null;
    job.eta_text = null;
    this.appendLog(job, "Canceled job returned to queue.");
    this.persist();
    this.processQueue();
    return job;
  }

  deleteJob(jobId) {
    this.loadFromDisk();

    const jobIndex = this.jobs.findIndex((entry) => entry.id === jobId);
    if (jobIndex < 0) {
      return null;
    }

    const job = this.jobs[jobIndex];
    if (["queued", "running", "paused"].includes(job.status)) {
      throw new Error("Queued, running, or paused jobs must be canceled before they can be deleted.");
    }

    const deletedFileCount = deleteRelatedJobFiles(job, this.runtime.vodOutputDirAbs);
    const [deletedJob] = this.jobs.splice(jobIndex, 1);
    deletedJob.deleted_file_count = deletedFileCount;
    this.persist();
    return deletedJob;
  }

  pauseQueue() {
    this.loadFromDisk();
    this.queuePaused = true;
    return this.getMeta().queue;
  }

  startQueue() {
    this.loadFromDisk();
    this.queuePaused = false;
    this.processQueue();
    return this.getMeta().queue;
  }

  processQueue() {
    if (this.activeJobId) {
      return;
    }

    if (this.queuePaused) {
      return;
    }

    const nextJob = this.jobs.find((job) => job.status === "queued");
    if (!nextJob) {
      return;
    }

    this.runJob(nextJob);
  }

  runJob(job) {
    const downloader = this.runtime.runtimeConfig?.downloader || {};
    const command = downloader.yt_dlp_command || "yt-dlp";
    const preset = normalizePreset(job?.download_preset);

    job.status = "running";
    job.started_at = nowIso();
    job.updated_at = nowIso();
    job.error = null;
    job.progress_percent = 0;
    job.estimated_size_text = null;
    job.speed_text = null;
    job.eta_text = null;
    job.actual_quality_text = this.resolveActualQuality(job.url, preset) || job.actual_quality_text || null;
    job.output_filename = this.resolveFilename(job.url, preset);
    this.appendLog(job, `Starting download with ${command} (preset: ${preset})`);
    this.persist();

    const args = this.buildDownloadArgs(job.url, preset);
    this.activeJobId = job.id;
    this.currentProcess = spawn(command, args, {
      cwd: this.runtime.appDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: getYtDlpEnv(),
    });

    this.currentProcess.stdout.on("data", (chunk) => {
      splitLines(chunk).forEach((line) => {
        this.appendLog(job, line);
        const progress = parseProgressLine(line);
        if (progress) {
          job.progress_percent = progress.percent;
          job.estimated_size_text = progress.estimatedSizeText;
          job.speed_text = progress.speedText;
          job.eta_text = progress.etaText;
        }
      });
      job.updated_at = nowIso();
      this.persist();
    });

    this.currentProcess.stderr.on("data", (chunk) => {
      splitLines(chunk).forEach((line) => {
        this.appendLog(job, line);
        const progress = parseProgressLine(line);
        if (progress) {
          job.progress_percent = progress.percent;
          job.estimated_size_text = progress.estimatedSizeText;
          job.speed_text = progress.speedText;
          job.eta_text = progress.etaText;
        }
      });
      job.updated_at = nowIso();
      this.persist();
    });

    this.currentProcess.on("error", (err) => {
      job.status = "failed";
      job.error = err.message;
      job.speed_text = null;
      job.eta_text = null;
      job.finished_at = nowIso();
      job.updated_at = nowIso();
      this.appendLog(job, `Process error: ${err.message}`);
      this.activeJobId = null;
      this.currentProcess = null;
      this.persist();
      this.processQueue();
    });

    this.currentProcess.on("close", (code) => {
      if (job.status !== "canceled") {
        job.status = code === 0 ? "completed" : "failed";
      }

      if (code === 0) {
        job.progress_percent = 100;
        job.eta_text = null;
        job.speed_text = null;
      }

      if (code !== 0 && job.status !== "canceled") {
        job.error = `yt-dlp exited with code ${code}`;
        job.speed_text = null;
        job.eta_text = null;
      }

      job.finished_at = nowIso();
      job.updated_at = nowIso();
      this.appendLog(job, `Process exited with code ${code}`);

      this.activeJobId = null;
      this.currentProcess = null;
      this.persist();
      this.processQueue();
    });
  }
}

let singleton = null;

export function getYoutubeJobService(runtime) {
  if (!singleton) {
    singleton = new YoutubeJobService(runtime);
  }
  return singleton;
}

/** Replace the singleton after GUI setup completes. */
export function resetYoutubeJobService(runtime) {
  singleton = new YoutubeJobService(runtime);
  return singleton;
}

/**
 * Read the current singleton without creating one. Routes use this to detect
 * the post-setup state — fastify decorators propagate from parent to child but
 * a re-assignment on a sibling route's local instance doesn't (so reading
 * `fastify.youtubeJobs` from a sibling can lag). Reading the module-level
 * singleton sidesteps that scoping quirk.
 */
export function peekYoutubeJobService() {
  return singleton;
}
