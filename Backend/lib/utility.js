import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ISO6391 from "iso-639-1";
import cron from "node-cron";

let cachedConfig = null;
let logFilePath = null;
let requestLogFilePath = null;
let queryLogFilePath = null;
let serverStartOn = null;
let db = null;
const pendingLogRows = [];
const pendingRequestLogRows = [];

const utilityFilePath = fileURLToPath(import.meta.url);
const utilityDir = path.dirname(utilityFilePath);
const RUNTIME_CONFIG_FILENAME = "vooted.runtime.json";
const LEGACY_RUNTIME_CONFIG_FILENAME = "voote.runtime.json";

function resolveProjectRoot() {
    if (process.pkg) {
        return path.dirname(process.execPath);
    }

    return path.resolve(utilityDir, "..");
}

const projectRoot = resolveProjectRoot();

function getLogOptions() {
    const config = loadConfig();
    const messageConfig = config?.logging?.message || {};

    return {
        logToFile: messageConfig.log_to_file === true,
        logToConsole: messageConfig.log_to_console !== false,
        logToDatabase: messageConfig.log_to_database === true,
        logDirectory: messageConfig.log_directory || "./logs",
        logFilePrefix: messageConfig.log_file_prefix || "message_",
        logFilePostfix: messageConfig.log_file_postfix || "",
    };
}

function getRequestLogOptions() {
    const config = loadConfig();
    const requestConfig = config?.logging?.request || {};

    return {
        logToFile: requestConfig.log_to_file === true,
        logToConsole: requestConfig.log_to_console !== false,
        logToDatabase: requestConfig.log_to_database === true,
        logDirectory: requestConfig.log_directory || "./logs",
        logFilePrefix: requestConfig.log_file_prefix || "requests_",
        logFilePostfix: requestConfig.log_file_postfix || "",
    };
}

function getQueryLogOptions() {
    const config = loadConfig();
    const sequelizeConfig = config?.logging?.sequelize || {};

    return {
        logToFile: sequelizeConfig.log_to_file === true,
        logToConsole: sequelizeConfig.log_to_console !== false,
        logDirectory: sequelizeConfig.log_directory || "./logs",
        logFilePrefix: sequelizeConfig.log_file_prefix || "queries_",
        logFilePostfix: sequelizeConfig.log_file_postfix || "",
    };
}

function resolveRuntimeConfigPath() {
    const primary = path.resolve(projectRoot, RUNTIME_CONFIG_FILENAME);
    if (fs.existsSync(primary)) {
        return primary;
    }

    const legacy = path.resolve(projectRoot, LEGACY_RUNTIME_CONFIG_FILENAME);
    if (fs.existsSync(legacy)) {
        return legacy;
    }

    return primary;
}

function normalizeConfig(rawConfig) {
    const config = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
    const defaults = buildMinimalRuntimeConfig();

    config.app = {
        ...defaults.app,
        ...(config.app && typeof config.app === "object" ? config.app : {}),
    };

    config.database = {
        ...defaults.database,
        ...(config.database && typeof config.database === "object" ? config.database : {}),
    };

    const currentLogging = config.logging && typeof config.logging === "object" ? config.logging : {};
    config.logging = {
        ...defaults.logging,
        ...currentLogging,
        message: {
            ...defaults.logging.message,
            ...(currentLogging.message && typeof currentLogging.message === "object" ? currentLogging.message : {}),
        },
        request: {
            ...defaults.logging.request,
            ...(currentLogging.request && typeof currentLogging.request === "object" ? currentLogging.request : {}),
        },
        sequelize: {
            ...defaults.logging.sequelize,
            ...(currentLogging.sequelize && typeof currentLogging.sequelize === "object" ? currentLogging.sequelize : {}),
        },
    };

    return config;
}

export function loadConfig() {
    if (cachedConfig) {
        return cachedConfig;
    }

    const runtimeConfigPath = resolveRuntimeConfigPath();
    if (!fs.existsSync(runtimeConfigPath)) {
        cachedConfig = buildMinimalRuntimeConfig();
        return cachedConfig;
    }

    const raw = fs.readFileSync(runtimeConfigPath, "utf-8");

    try {
        cachedConfig = normalizeConfig(JSON.parse(raw));
    } catch {
        throw new Error(`Invalid JSON format in ${path.basename(runtimeConfigPath)}`);
    }

    return cachedConfig;
}

// In-memory defaults used while the GUI setup card is still being shown — keeps
// the server runnable without writing runtime config to the user's folder yet.
// All file-touching features (logging, DB) are forced off so the user's folder
// stays clean until they confirm setup.
export function buildMinimalRuntimeConfig() {
    return {
        app_name: "VOOTED",
        version: 1,
        app: { port: 8111, auto_open_browser: true },
        database: { enabled: false },
        logging: {
            fastify: false,
            message: { log_to_file: false, log_to_console: true, log_to_database: false },
            request: { log_to_file: false, log_to_console: true, log_to_database: false },
            sequelize: { log_to_file: false, log_to_console: false },
        },
    };
}

// Drop the cached config so the next loadConfig() call re-reads from disk.
// Used by the setup completion handler once runtime config is written.
export function resetConfigCache() {
    cachedConfig = null;
}

// Replace the cached config with a caller-provided value (used to seed the
// minimal first-run config without going through the file-creating path).
export function setCachedConfig(value) {
    cachedConfig = value;
}

// Logging functions
export function logInit() {
    const options = getLogOptions();

    const now = new Date();
    serverStartOn = now;

    if (!options.logToFile) {
        logFilePath = null;
        return null;
    }

    const logsDir = path.resolve(projectRoot, options.logDirectory);

    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    // Create log file with timestamp
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    logFilePath = path.resolve(
        logsDir,
        `${options.logFilePrefix}${timestamp}${options.logFilePostfix}.log`,
    );

    // Create empty log file
    fs.writeFileSync(logFilePath, "");

    return logFilePath;
}

export function requestLogInit() {
    const options = getRequestLogOptions();

    const now = new Date();

    if (!options.logToFile) {
        requestLogFilePath = null;
        return null;
    }

    const logsDir = path.resolve(projectRoot, options.logDirectory);

    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    // Create log file with timestamp
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    requestLogFilePath = path.resolve(
        logsDir,
        `${options.logFilePrefix}${timestamp}${options.logFilePostfix}.log`,
    );

    // Create empty log file
    fs.writeFileSync(requestLogFilePath, "");

    return requestLogFilePath;
}

export function queryLogInit() {
    const options = getQueryLogOptions();

    const now = new Date();

    if (!options.logToFile) {
        queryLogFilePath = null;
        return null;
    }

    const logsDir = path.resolve(projectRoot, options.logDirectory);

    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    // Create log file with timestamp
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    queryLogFilePath = path.resolve(
        logsDir,
        `${options.logFilePrefix}${timestamp}${options.logFilePostfix}.log`,
    );

    // Create empty log file
    fs.writeFileSync(queryLogFilePath, "");

    return queryLogFilePath;
}

function getRelativePath(importMetaUrl) {
    if (!importMetaUrl) {
        return "unknown";
    }

    const sourceFilePath = fileURLToPath(importMetaUrl);
    return path.relative(projectRoot, sourceFilePath).replace(/\\/g, "/");
}

function formatTimestamp() {
    return new Date().toISOString();
}

let log_levels = ["info", "warning", "error"];

export async function log(message, level = "info", importMetaUrl) {
    if (!serverStartOn) {
        serverStartOn = new Date();
    }

    const options = getLogOptions();

    let resolvedLevel = level;
    let resolvedImportMetaUrl = importMetaUrl;

    if (
        resolvedImportMetaUrl === undefined &&
        typeof resolvedLevel === "string" &&
        !log_levels.includes(resolvedLevel.toLowerCase())
    ) {
        resolvedImportMetaUrl = resolvedLevel;
        resolvedLevel = "info";
    }

    resolvedLevel = typeof resolvedLevel === "string"
        ? resolvedLevel.toLowerCase()
        : "info";

    if (!log_levels.includes(resolvedLevel)) {
        resolvedLevel = "info";
    }

    const relPath = getRelativePath(resolvedImportMetaUrl);
    const reportOn = new Date();
    const timestamp = formatTimestamp();
    const normalizedMessage = String(message);
    const logMessage = `[${timestamp}] [${resolvedLevel.toUpperCase()}] [${relPath}]: ${normalizedMessage}\n`;

    if (options.logToConsole) {
        console.log(logMessage.trimEnd());
    }

    if (options.logToFile && logFilePath) {
        try {
            await fs.promises.appendFile(logFilePath, logMessage);
        } catch (err) {
            console.error("Error writing to log file:", err);
        }
    }

    if (options.logToDatabase) {
        if (db?.LogMessages) {
            try {
                await db.LogMessages.create({
                    server_start_on: serverStartOn,
                    report_by: relPath,
                    report_on: reportOn,
                    level: resolvedLevel,
                    messages: normalizedMessage,
                });
            } catch (err) {
                console.error("Error writing log to database:", err);
            }
        } else {
            pendingLogRows.push({
                server_start_on: serverStartOn,
                report_by: relPath,
                report_on: reportOn,
                level: resolvedLevel,
                messages: normalizedMessage,
            });
        }
    }
}

log.info = async function info(message, importMetaUrl) {
    return log(message, "info", importMetaUrl);
};

log.warning = async function warning(message, importMetaUrl) {
    return log(message, "warning", importMetaUrl);
};

log.error = async function error(message, importMetaUrl) {
    return log(message, "error", importMetaUrl);
};

export function getLogPath() {
    return logFilePath;
}

export function setDB(db_from_plugin_init) {
    db = db_from_plugin_init;
    log_levels = db?.choices?.log_messages_level || log_levels;

    const messageOptions = getLogOptions();
    const requestOptions = getRequestLogOptions();

    // Flush pending message logs
    if (
        messageOptions.logToDatabase &&
        db?.LogMessages &&
        pendingLogRows.length > 0
    ) {
        const rowsToInsert = pendingLogRows.splice(0, pendingLogRows.length);
        Promise.all(
            rowsToInsert.map((row) => db.LogMessages.create(row)),
        ).catch((err) => {
            console.error(
                "Error flushing pending message logs to database:",
                err,
            );
        });
    } else if (!messageOptions.logToDatabase) {
        pendingLogRows.splice(0, pendingLogRows.length);
    }

    // Flush pending request logs
    if (
        requestOptions.logToDatabase &&
        db?.LogRequests &&
        pendingRequestLogRows.length > 0
    ) {
        const rowsToInsert = pendingRequestLogRows.splice(
            0,
            pendingRequestLogRows.length,
        );
        Promise.all(
            rowsToInsert.map((row) => db.LogRequests.create(row)),
        ).catch((err) => {
            console.error(
                "Error flushing pending request logs to database:",
                err,
            );
        });
    } else if (!requestOptions.logToDatabase) {
        pendingRequestLogRows.splice(0, pendingRequestLogRows.length);
    }
}

export async function logRequest(requestData) {
    const options = getRequestLogOptions();
    const timestamp = formatTimestamp();

    const logLine = `[${timestamp}] ${requestData.request_method} ${requestData.request_protocol}://${requestData.request_to} from ${requestData.request_ip}\n`;

    if (options.logToConsole) {
        console.log(logLine.trimEnd());
    }

    if (options.logToFile && requestLogFilePath) {
        try {
            await fs.promises.appendFile(requestLogFilePath, logLine);
        } catch (err) {
            console.error("Error writing request log to file:", err);
        }
    }

    if (options.logToDatabase) {
        if (db?.LogRequests) {
            try {
                await db.LogRequests.create(requestData);
            } catch (err) {
                console.error("Error writing request log to database:", err);
            }
        } else {
            pendingRequestLogRows.push(requestData);
        }
    }
}

export function logQuery(query, duration_ms) {
    const options = getQueryLogOptions();
    const timestamp = formatTimestamp();

    const normalizedQuery =
        typeof query === "string" ? query : JSON.stringify(query);
    const hasDuration = Number.isFinite(duration_ms);
    const durationText = hasDuration ? ` (${duration_ms}ms)` : "";
    const logLine = `[${timestamp}] Query${durationText}: ${normalizedQuery}\n`;

    if (options.logToConsole) {
        console.log(logLine.trimEnd());
    }

    if (options.logToFile && queryLogFilePath) {
        fs.promises.appendFile(queryLogFilePath, logLine).catch((err) => {
            console.error("Error writing query log to file:", err);
        });
    }
}

// Cron Manager
class CronManager {
    constructor() {
        this.jobs = new Map();
    }

    createJob(name, schedule, task, options = {}) {
        if (this.jobs.has(name)) {
            throw new Error(`Cron job with name '${name}' already exists`);
        }

        // Extract context from options
        const context = options.context;
        const cronOptions = { ...options };
        delete cronOptions.context; // Remove context from cron options

        const wrappedTask = options.isLog
            ? async () => {
                await log(`Running cron job ${name} (cron: "${schedule}")`, "info", import.meta.url);
                await task(context);
            }
            : async () => {
                await task(context);
            };

        const job = cron.createTask(schedule, wrappedTask, {
            name,
            ...cronOptions
        });

        this.jobs.set(name, {
            job,
            name,
            schedule,
            task,
            context,
            options
        });

        return job;
    }

    startJob(name) {
        const jobData = this.jobs.get(name);
        if (!jobData) {
            throw new Error(`Cron job '${name}' not found`);
        }
        jobData.job.start();
        return jobData.job;
    }

    stopJob(name) {
        const jobData = this.jobs.get(name);
        if (!jobData) {
            throw new Error(`Cron job '${name}' not found`);
        }
        jobData.job.stop();
        return jobData.job;
    }

    getJob(name) {
        const jobData = this.jobs.get(name);
        return jobData ? jobData.job : null;
    }

    hasJob(name) {
        return this.jobs.has(name);
    }

    deleteJob(name) {
        const jobData = this.jobs.get(name);
        if (jobData) {
            jobData.job.stop();
            this.jobs.delete(name);
            return true;
        }
        return false;
    }

    startAll() {
        for (const [name, jobData] of this.jobs) {
            jobData.job.start();
        }
    }

    stopAll() {
        for (const [name, jobData] of this.jobs) {
            jobData.job.stop();
        }
    }

    listJobs() {
        return Array.from(this.jobs.keys());
    }
}

export const cronManager = new CronManager();

export function emojiToSvgFilename(emoji) {
    const codepoints = Array.from(emoji)
        .map(char => char.codePointAt(0))
        .filter(cp =>
            cp !== undefined &&
            cp !== 0xfe0f // remove variation selector-16
        )
        .map(cp => cp.toString(16).toLowerCase());

    return `${codepoints.join("-")}.svg`;
}

export async function resolveEmojiSvg(emoji) {
    if (!emoji || typeof emoji !== "string") {
        throw new Error("emoji is required");
    }

    const filename = emojiToSvgFilename(emoji);
    const svgPath = path.resolve(
        projectRoot,
        "assets",
        "twemoji",
        "svg",
        filename,
    );

    if (!fs.existsSync(svgPath)) {
        throw new Error(`Emoji SVG not found for '${emoji}' (${filename})`);
    }

    return fs.promises.readFile(svgPath, "utf-8");
}

export function validateIso6391(value) {
    if (!value) return true;
    return ISO6391.validate(value);
}

export function getAllIso6391Codes() {
    return ISO6391.getAllCodes();
}

export function getIso6391Name(code) {
    return ISO6391.getName(code);
}

export function getIso6391NativeName(code) {
    return ISO6391.getNativeName(code);
}