import { apiUrl } from '../config';

export type VodJobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'canceled';

export type VodJob = {
  id: string;
  url: string;
  display_title?: string | null;
  download_preset?: 'best' | '1080p' | '1080p30' | '720p' | '720p30' | '480p';
  actual_quality_text?: string | null;
  progress_percent?: number | null;
  estimated_size_text?: string | null;
  speed_text?: string | null;
  eta_text?: string | null;
  status: VodJobStatus;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  output_filename: string | null;
  error: string | null;
  logs: string[];
};

export type DownloadPreset = {
  key: 'best' | '1080p' | '1080p30' | '720p' | '720p30' | '480p';
  label: string;
  description: string;
};

export type VodPreview = {
  url: string;
  title: string;
  thumbnail: string;
  uploader: string;
  duration: number | null;
  viewCount: number | null;
  presets: DownloadPreset[];
  defaultPreset: DownloadPreset['key'];
};

export type ChannelStreamItem = {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  uploader: string;
  duration: number | null;
  uploadDate: string | null;
  uploadTimestamp: number | null;
};

export type ChannelStreamsPreview = {
  channelUrl: string;
  streamsTabUrl: string;
  channelTitle: string;
  total: number;
  items: ChannelStreamItem[];
  presets: DownloadPreset[];
  defaultPreset: DownloadPreset['key'];
};

export type ChannelQueueResult = {
  queuedCount: number;
  skippedCount: number;
  queued: VodJob[];
};

export type ChannelQueueItem = {
  url: string;
  title?: string;
};

export type VodMeta = {
  projectName: string;
  databaseEnabled: boolean;
  appDir: string;
  runtimeConfigPath: string;
  vodOutputDir: string;
  portConflict: boolean;
  boundPort: number;
  ytDlp: {
    command: string;
    available: boolean;
  };
  cookieAuth?: {
    mode: 'none' | 'file' | 'browser';
    browser: string;
  };
  queue: {
    activeJobId: string | null;
    isPaused?: boolean;
    total: number;
    queued: number;
    running: number;
    paused?: number;
    completed: number;
    failed: number;
    canceled: number;
  };
};

type ApiResponse<T> = {
  ok: boolean;
  data?: T;
  message?: string;
};

const requestJson = async <T>(
  path: string,
  init?: RequestInit,
  signal?: AbortSignal,
): Promise<T> => {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
    signal,
  });

  let payload: ApiResponse<T> | null = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.ok) {
    const message = payload?.message || `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload.data as T;
};

export const fetchVodMeta = (signal?: AbortSignal): Promise<VodMeta> =>
  requestJson<VodMeta>('/api/vod/meta', undefined, signal);

export const fetchVodJobs = (signal?: AbortSignal): Promise<VodJob[]> =>
  requestJson<VodJob[]>('/api/vod/jobs', undefined, signal);

export const fetchVodJob = (id: string, signal?: AbortSignal): Promise<VodJob> =>
  requestJson<VodJob>(`/api/vod/jobs/${encodeURIComponent(id)}`, undefined, signal);

export const createVodJob = (
  url: string,
  downloadPreset: DownloadPreset['key'] = 'best',
  displayTitle?: string,
): Promise<VodJob> =>
  requestJson<VodJob>('/api/vod/jobs', {
    method: 'POST',
    body: JSON.stringify({ url, downloadPreset, displayTitle }),
  });

export const fetchVodPreview = (url: string): Promise<VodPreview> =>
  requestJson<VodPreview>('/api/vod/preview', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });

export const fetchChannelStreamsPreview = (channelUrl: string): Promise<ChannelStreamsPreview> =>
  requestJson<ChannelStreamsPreview>('/api/vod/channel/streams/preview', {
    method: 'POST',
    body: JSON.stringify({ channelUrl }),
  });

export const queueChannelStreams = (
  items: ChannelQueueItem[],
  downloadPreset: DownloadPreset['key'] = 'best',
): Promise<ChannelQueueResult> =>
  requestJson<ChannelQueueResult>('/api/vod/channel/streams/queue', {
    method: 'POST',
    body: JSON.stringify({ items, downloadPreset }),
  });

export const cancelVodJob = (id: string): Promise<VodJob> =>
  requestJson<VodJob>(`/api/vod/jobs/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
  });

export const resumeVodJob = (id: string): Promise<VodJob> =>
  requestJson<VodJob>(`/api/vod/jobs/${encodeURIComponent(id)}/resume`, {
    method: 'POST',
  });

export const requeueVodJob = (id: string): Promise<VodJob> =>
  requestJson<VodJob>(`/api/vod/jobs/${encodeURIComponent(id)}/requeue`, {
    method: 'POST',
  });

export const deleteVodJob = (id: string): Promise<VodJob> =>
  requestJson<VodJob>(`/api/vod/jobs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

export const pauseVodQueue = (): Promise<VodMeta['queue']> =>
  requestJson<VodMeta['queue']>('/api/vod/queue/pause', {
    method: 'POST',
  });

export const startVodQueue = (): Promise<VodMeta['queue']> =>
  requestJson<VodMeta['queue']>('/api/vod/queue/start', {
    method: 'POST',
  });

// --- Setup API ---

export type FolderSafety = {
  safe: boolean;
  neighbors: string[];
  totalCount: number;
};

export type SetupStatus = {
  needsSetup: boolean;
  appDir: string | null;
  ytDlpAvailable: boolean;
  ffmpegAvailable?: boolean;
  folderSafety?: FolderSafety;
};

export const fetchSetupStatus = (signal?: AbortSignal): Promise<SetupStatus> =>
  requestJson<SetupStatus>('/api/setup/status', undefined, signal);

export const completeSetup = (
  vodOutputDir?: string,
  ytDlpChoice: 'system' | 'portable' | 'auto' = 'auto',
): Promise<{ needsSetup: boolean }> =>
  requestJson<{ needsSetup: boolean }>('/api/setup/complete', {
    method: 'POST',
    body: JSON.stringify({ vodOutputDir: vodOutputDir || '', ytDlpChoice }),
  });

export const shutdownApp = (): Promise<{ message: string }> =>
  requestJson<{ message: string }>('/api/shutdown', { method: 'POST' });

// Open the OS-native folder picker on the host (only meaningful for the
// portable EXE flow — same machine as the user's browser). Resolves to the
// selected absolute path string, or null if the user canceled.
export const pickFolder = async (
  title?: string,
  initialDir?: string,
): Promise<string | null> => {
  const result = await requestJson<{ path: string | null }>('/api/setup/pick-folder', {
    method: 'POST',
    body: JSON.stringify({ title: title || '', initialDir: initialDir || '' }),
  });
  return result.path ?? null;
};

// --- Health probe ---
// Tolerant helper used by the Close App confirmation modal: must never throw,
// just resolve to { alive: boolean }. The /api/health response shape is
// { ok: true, service: 'VOOTED API', timestamp } — no `data` envelope, so
// requestJson<T> doesn't fit.

export type HealthProbe = { alive: boolean; service?: string };

export const fetchHealth = async (timeoutMs = 1500): Promise<HealthProbe> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(apiUrl('/api/health'), { signal: controller.signal });
    if (!response.ok) return { alive: false };
    const payload = (await response.json()) as { ok?: boolean; service?: string };
    return { alive: payload?.ok === true, service: payload?.service };
  } catch {
    return { alive: false };
  } finally {
    clearTimeout(timer);
  }
};

// --- Settings API ---

export type AppSettings = {
  app: {
    port: number;
    auto_open_browser: boolean;
    default_channel_url: string;
  };
  logging: {
    message_log_to_file: boolean;
    request_log_to_file: boolean;
  };
  downloader: {
    yt_dlp_command: string;
    cookies_file: string;
    cookies_from_browser: string;
  };
};

export type SettingsPatch = {
  app?: Partial<{ port: number; auto_open_browser: boolean; default_channel_url: string }>;
  logging?: Partial<{
    message_log_to_file: boolean;
    request_log_to_file: boolean;
  }>;
  downloader?: Partial<{ yt_dlp_command: string }>;
};

export type SettingsUpdateResponse = {
  settings: AppSettings;
  requiresRestart: boolean;
};

export const fetchSettings = (signal?: AbortSignal): Promise<AppSettings> =>
  requestJson<AppSettings>('/api/settings', undefined, signal);

export const updateSettings = (patch: SettingsPatch): Promise<SettingsUpdateResponse> =>
  requestJson<SettingsUpdateResponse>('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

// --- Cookies API ---

export type CookieMode = 'none' | 'file' | 'browser';

export type CookieStatus = {
  mode: CookieMode;
  browser: string;
  relativePath: string;
  absolutePath: string;
  exists: boolean;
  size: number;
  updatedAt: string | null;
};

export const fetchCookieStatus = (signal?: AbortSignal): Promise<CookieStatus> =>
  requestJson<CookieStatus>('/api/settings/cookies', undefined, signal);

export const importCookieFile = (
  filename: string,
  content: string,
): Promise<CookieStatus> =>
  requestJson<CookieStatus>('/api/settings/cookies/import', {
    method: 'POST',
    body: JSON.stringify({ filename, content }),
  });

export type PastedCookieResult = CookieStatus & { pastedCookieCount?: number };

export const importPastedCookies = (header: string): Promise<PastedCookieResult> =>
  requestJson<PastedCookieResult>('/api/settings/cookies/import-paste', {
    method: 'POST',
    body: JSON.stringify({ header }),
  });

export const clearCookies = (): Promise<CookieStatus> =>
  requestJson<CookieStatus>('/api/settings/cookies/clear', {
    method: 'POST',
    body: JSON.stringify({}),
  });

// --- Self-update API ---

export type SelfUpdateStatus = {
  repo: string;
  currentVersion: string;
  latestTag: string;
  latestVersion: string;
  updateAvailable: boolean;
  platformSupported: boolean;
  assetName: string;
  assetUrl: string;
  releaseUrl: string;
  publishedAt: string | null;
};

export const fetchSelfUpdateStatus = (): Promise<SelfUpdateStatus> =>
  requestJson<SelfUpdateStatus>('/api/update/status', undefined);

export type ApplySelfUpdateResult = SelfUpdateStatus & { message: string };

export const applySelfUpdate = (): Promise<ApplySelfUpdateResult> =>
  requestJson<ApplySelfUpdateResult>('/api/update/apply', {
    method: 'POST',
    body: JSON.stringify({}),
  });
