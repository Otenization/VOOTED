import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { downloadYtDlp, ensureYtDlpAvailable } from "./yt-dlp-manager.service.js";
import { downloadPortableFfmpeg, ensureFfmpegAvailable } from "./ffmpeg-manager.service.js";

const RUNTIME_CONFIG_FILENAME = "vooted.runtime.json";
const LEGACY_RUNTIME_CONFIG_FILENAME = "voote.runtime.json";
export const SUPPORTED_COOKIE_BROWSERS = [
  "chrome",
  "edge",
  "firefox",
  "brave",
  "chromium",
  "opera",
  "vivaldi",
];

function getBackendRootDir() {
  if (process.pkg) {
    return path.dirname(process.execPath);
  }

  const serviceFile = fileURLToPath(import.meta.url);
  const serviceDir = path.dirname(serviceFile);
  return path.resolve(serviceDir, "../..");
}

function toAbsolutePath(baseDir, value) {
  if (!value || typeof value !== "string") {
    return baseDir;
  }

  if (path.isAbsolute(value)) {
    return value;
  }

  return path.resolve(baseDir, value);
}

function buildDefaultConfig() {
  return {
    app_name: "VOOTED",
    version: 1,
    created_at: new Date().toISOString(),
    app: {
      port: 8111,
      auto_open_browser: true,
      default_channel_url: "",
    },
    database: {
      enabled: false,
    },
    logging: {
      fastify: false,
      message: {
        log_directory: "./logs",
        log_file_prefix: "message_",
        log_file_postfix: "",
        log_to_file: false,
        log_to_console: true,
        log_to_database: false,
      },
      request: {
        log_directory: "./logs",
        log_file_prefix: "requests_",
        log_file_postfix: "",
        log_to_file: false,
        log_to_console: true,
        log_to_database: false,
      },
      sequelize: {
        benchmark: true,
        log_directory: "./logs",
        log_file_prefix: "queries_",
        log_file_postfix: "",
        log_to_file: false,
        log_to_console: false,
      },
    },
    vod_output_dir: "./Youtube_VOD",
    data_dir: "./data",
    downloader: {
      yt_dlp_command: "yt-dlp",
      ffmpeg_location: "",
      cookies_file: "",
      cookies_from_browser: "",
      format:
        "bestvideo[height<=1440][fps<=60][ext=mp4]+bestaudio[ext=m4a]/best[height<=1440][fps<=60][ext=mp4]",
      merge_output_format: "mp4",
      remux_video: "mp4",
      user_agent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      headers: {
        Referer: "https://www.youtube.com/",
      },
    },
  };
}

function ensureRuntimeDirectories(runtimeConfig, appDir) {
  const vodOutputDirAbs = toAbsolutePath(appDir, runtimeConfig.vod_output_dir);
  const dataDirAbs = toAbsolutePath(appDir, runtimeConfig.data_dir);
  const jobsFileAbs = path.join(dataDirAbs, "youtube-jobs.json");

  if (!fs.existsSync(vodOutputDirAbs)) {
    fs.mkdirSync(vodOutputDirAbs, { recursive: true });
  }

  if (!fs.existsSync(dataDirAbs)) {
    fs.mkdirSync(dataDirAbs, { recursive: true });
  }

  if (!fs.existsSync(jobsFileAbs)) {
    fs.writeFileSync(jobsFileAbs, "[]\n", "utf-8");
  }

  return {
    appDir,
    runtimeConfig,
    runtimeConfigPath: path.join(appDir, RUNTIME_CONFIG_FILENAME),
    vodOutputDirAbs,
    dataDirAbs,
    jobsFileAbs,
  };
}

function parseRuntimeConfig(content, runtimeConfigPath) {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in ${runtimeConfigPath}`);
  }
}

function normalizeRuntimeConfig(runtimeConfig) {
  const defaults = buildDefaultConfig();
  const config = runtimeConfig && typeof runtimeConfig === "object" ? runtimeConfig : {};

  const app = config.app && typeof config.app === "object" ? config.app : {};
  const database = config.database && typeof config.database === "object" ? config.database : {};
  const logging = config.logging && typeof config.logging === "object" ? config.logging : {};
  const downloader = config.downloader && typeof config.downloader === "object" ? config.downloader : {};

  return {
    ...defaults,
    ...config,
    app: { ...defaults.app, ...app },
    database: { ...defaults.database, ...database },
    logging: {
      ...defaults.logging,
      ...logging,
      message: {
        ...defaults.logging.message,
        ...(logging.message && typeof logging.message === "object" ? logging.message : {}),
      },
      request: {
        ...defaults.logging.request,
        ...(logging.request && typeof logging.request === "object" ? logging.request : {}),
      },
      sequelize: {
        ...defaults.logging.sequelize,
        ...(logging.sequelize && typeof logging.sequelize === "object" ? logging.sequelize : {}),
      },
    },
    downloader: { ...defaults.downloader, ...downloader },
  };
}

function getRuntimeConfigPaths(appDir) {
  return {
    runtimeConfigPath: path.join(appDir, RUNTIME_CONFIG_FILENAME),
    legacyRuntimeConfigPath: path.join(appDir, LEGACY_RUNTIME_CONFIG_FILENAME),
  };
}

function writeRuntimeConfig(runtimeConfigPath, runtimeConfig) {
  fs.writeFileSync(runtimeConfigPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, "utf-8");
}

function setRuntimeYtDlpCommand(runtimeConfigPath, ytDlpCommand) {
  const currentConfig = parseRuntimeConfig(fs.readFileSync(runtimeConfigPath, "utf-8"), runtimeConfigPath);
  currentConfig.downloader = {
    ...(currentConfig.downloader && typeof currentConfig.downloader === "object" ? currentConfig.downloader : {}),
    yt_dlp_command: ytDlpCommand,
  };
  writeRuntimeConfig(runtimeConfigPath, currentConfig);
}

function setRuntimeFfmpegLocation(runtimeConfigPath, ffmpegLocation) {
  const currentConfig = parseRuntimeConfig(fs.readFileSync(runtimeConfigPath, "utf-8"), runtimeConfigPath);
  currentConfig.downloader = {
    ...(currentConfig.downloader && typeof currentConfig.downloader === "object" ? currentConfig.downloader : {}),
    ffmpeg_location: ffmpegLocation || "",
  };
  writeRuntimeConfig(runtimeConfigPath, currentConfig);
}

function readRuntimeFromDisk(appDir) {
  const { runtimeConfig, runtimeConfigPath } = readRuntimeConfigOrThrow(appDir);
  const normalized = normalizeRuntimeConfig(runtimeConfig);
  return {
    ...ensureRuntimeDirectories(normalized, appDir),
    runtimeConfigPath,
  };
}

function readRuntimeConfigOrThrow(appDir) {
  const { runtimeConfigPath, legacyRuntimeConfigPath } = getRuntimeConfigPaths(appDir);

  if (fs.existsSync(runtimeConfigPath)) {
    return {
      runtimeConfig: parseRuntimeConfig(fs.readFileSync(runtimeConfigPath, "utf-8"), runtimeConfigPath),
      runtimeConfigPath,
    };
  }

  if (fs.existsSync(legacyRuntimeConfigPath)) {
    const runtimeConfig = parseRuntimeConfig(
      fs.readFileSync(legacyRuntimeConfigPath, "utf-8"),
      legacyRuntimeConfigPath,
    );
    fs.writeFileSync(runtimeConfigPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, "utf-8");
    console.log(`[VOOTED] Migrated runtime config: ${legacyRuntimeConfigPath} -> ${runtimeConfigPath}`);
    return { runtimeConfig, runtimeConfigPath };
  }

  throw new Error("Runtime config not found. Complete setup first.");
}

export function getRuntimeConfigSnapshot() {
  const appDir = getBackendRootDir();
  const { runtimeConfig, runtimeConfigPath } = readRuntimeConfigOrThrow(appDir);
  const normalized = normalizeRuntimeConfig(runtimeConfig);

  return {
    appDir,
    runtimeConfigPath,
    runtimeConfig: normalized,
  };
}

export function patchRuntimeConfig(mutator) {
  const appDir = getBackendRootDir();
  const { runtimeConfigPath, runtimeConfig } = getRuntimeConfigSnapshot();

  const nextConfig = normalizeRuntimeConfig(mutator(runtimeConfig));
  fs.writeFileSync(runtimeConfigPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf-8");

  return ensureRuntimeDirectories(nextConfig, appDir);
}

export async function ensureRuntimeBootstrap() {
  const appDir = getBackendRootDir();
  const { runtimeConfigPath, legacyRuntimeConfigPath } = getRuntimeConfigPaths(appDir);

  let runtimeConfig = null;

  if (fs.existsSync(runtimeConfigPath)) {
    runtimeConfig = parseRuntimeConfig(fs.readFileSync(runtimeConfigPath, "utf-8"), runtimeConfigPath);
  } else if (fs.existsSync(legacyRuntimeConfigPath)) {
    runtimeConfig = parseRuntimeConfig(fs.readFileSync(legacyRuntimeConfigPath, "utf-8"), legacyRuntimeConfigPath);
    writeRuntimeConfig(runtimeConfigPath, runtimeConfig);
    console.log(`[VOOTED] Migrated runtime config: ${legacyRuntimeConfigPath} -> ${runtimeConfigPath}`);
  } else {
    // No runtime config found — signal that GUI setup is required.
    return { needsSetup: true, appDir };
  }

  runtimeConfig = normalizeRuntimeConfig(runtimeConfig);
  const runtime = ensureRuntimeDirectories(runtimeConfig, appDir);

  // Ensure yt-dlp is available at startup
  try {
    const ytDlpCmd = await ensureYtDlpAvailable(runtime.dataDirAbs);
    if (ytDlpCmd && ytDlpCmd !== "yt-dlp") {
      // Update runtime config if bundled yt-dlp is being used
      if (runtimeConfig.downloader.yt_dlp_command !== ytDlpCmd) {
        setRuntimeYtDlpCommand(runtime.runtimeConfigPath, ytDlpCmd);
        console.log(`[VOOTED] Using bundled yt-dlp at startup: ${ytDlpCmd}`);
        return readRuntimeFromDisk(appDir);
      }
    }
  } catch (err) {
    console.warn(`[VOOTED] yt-dlp availability check failed: ${err.message}`);
  }

  try {
    const ffmpegLocation = await ensureFfmpegAvailable(runtime.dataDirAbs);
    const desired = ffmpegLocation || "";
    if (runtimeConfig.downloader.ffmpeg_location !== desired) {
      setRuntimeFfmpegLocation(runtime.runtimeConfigPath, desired);
      if (desired) {
        console.log(`[VOOTED] Using bundled ffmpeg at startup: ${desired}`);
      }
      return readRuntimeFromDisk(appDir);
    }
  } catch (err) {
    console.warn(`[VOOTED] ffmpeg availability check failed: ${err.message}`);
  }

  return runtime;
}

/**
 * Called from the setup API after the user confirms in the browser GUI.
 * Creates the runtime config and required directories, then returns the
 * initialised runtime object ready for the job service.
 */
export async function completeSetup(vodOutputDir, ytDlpChoice = 'auto') {
  const appDir = getBackendRootDir();
  const { runtimeConfigPath } = getRuntimeConfigPaths(appDir);

  const defaults = buildDefaultConfig();

  if (vodOutputDir && typeof vodOutputDir === "string" && vodOutputDir.trim()) {
    defaults.vod_output_dir = vodOutputDir.trim();
  }

  writeRuntimeConfig(runtimeConfigPath, defaults);
  console.log(`[VOOTED] Created runtime config via GUI setup: ${runtimeConfigPath}`);

  const runtime = ensureRuntimeDirectories(defaults, appDir);

  // Handle yt-dlp based on user choice
  if (ytDlpChoice === 'system') {
    console.log('[VOOTED] User chose to use system yt-dlp');
    return readRuntimeFromDisk(appDir);
  }

  if (ytDlpChoice === 'portable') {
    console.log('[VOOTED] User chose to use portable yt-dlp, downloading...');
    const ytDlpCmd = await downloadYtDlp(runtime.dataDirAbs);
    setRuntimeYtDlpCommand(runtime.runtimeConfigPath, ytDlpCmd);
    console.log(`[VOOTED] Updated yt-dlp command to use bundled version: ${ytDlpCmd}`);

    try {
      const ffmpegLocation = await downloadPortableFfmpeg(runtime.dataDirAbs);
      setRuntimeFfmpegLocation(runtime.runtimeConfigPath, ffmpegLocation);
      console.log(`[VOOTED] Updated ffmpeg location to bundled version: ${ffmpegLocation}`);
    } catch (err) {
      console.warn(`[VOOTED] Portable ffmpeg setup failed (non-fatal): ${err.message}`);
    }

    return readRuntimeFromDisk(appDir);
  }

  try {
    const ytDlpCmd = await ensureYtDlpAvailable(runtime.dataDirAbs);
    if (ytDlpCmd && ytDlpCmd !== 'yt-dlp') {
      setRuntimeYtDlpCommand(runtime.runtimeConfigPath, ytDlpCmd);
      console.log(`[VOOTED] Updated yt-dlp command to use bundled version: ${ytDlpCmd}`);
    }
  } catch (err) {
    console.warn(`[VOOTED] yt-dlp setup failed (non-fatal): ${err.message}`);
  }

  try {
    const ffmpegLocation = await ensureFfmpegAvailable(runtime.dataDirAbs);
    const desired = ffmpegLocation || '';
    if (desired) {
      setRuntimeFfmpegLocation(runtime.runtimeConfigPath, desired);
      console.log(`[VOOTED] Updated ffmpeg location to bundled version: ${desired}`);
    }
  } catch (err) {
    console.warn(`[VOOTED] ffmpeg setup failed (non-fatal): ${err.message}`);
  }

  return readRuntimeFromDisk(appDir);
}

export function updateRuntimeDownloaderConfig(partialDownloaderConfig) {
  return patchRuntimeConfig((runtimeConfig) => ({
    ...runtimeConfig,
    downloader: {
      ...(runtimeConfig.downloader || {}),
      ...partialDownloaderConfig,
    },
  }));
}
