import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchChannelStreamsPreview,
  fetchVodJobs,
  queueChannelStreams,
  fetchSettings,
} from '../lib/vodApi';
import type { ChannelStreamsPreview, DownloadPreset } from '../lib/vodApi';

const PRESET_STORAGE_KEY = 'vooted.downloadPreset';
const DEFAULT_CHANNEL_STORAGE_KEY = 'vooted.defaultChannelUrl';
const FALLBACK_PRESET: DownloadPreset['key'] = 'best';
const PRESET_VALUES: DownloadPreset['key'][] = ['best', '1080p', '720p', '480p'];

const normalizePreset = (value: unknown): DownloadPreset['key'] => {
  const preset = String(value || '').trim() as DownloadPreset['key'];
  return PRESET_VALUES.includes(preset) ? preset : FALLBACK_PRESET;
};

const loadSavedPreset = (): DownloadPreset['key'] => {
  if (typeof window === 'undefined') return FALLBACK_PRESET;
  try {
    return normalizePreset(window.localStorage.getItem(PRESET_STORAGE_KEY));
  } catch {
    return FALLBACK_PRESET;
  }
};

const normalizeStreamsTabUrl = (input: string): string => {
  const normalized = String(input || '').trim();
  if (!normalized) return '';

  if (!/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return normalized;
  }

  if (!/youtube\.com$/i.test(parsed.hostname)) {
    return normalized;
  }

  const pathParts = parsed.pathname.split('/').filter(Boolean);
  if (pathParts.length === 0) {
    return normalized;
  }

  if (pathParts[pathParts.length - 1].toLowerCase() !== 'streams') {
    pathParts.push('streams');
  }

  parsed.pathname = `/${pathParts.join('/')}`;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
};

const loadDefaultChannelUrl = (): string => {
  if (typeof window === 'undefined') return '';
  try {
    const saved = normalizeStreamsTabUrl(window.localStorage.getItem(DEFAULT_CHANNEL_STORAGE_KEY) || '');
    if (saved) return saved;
  } catch {
    // Ignore localStorage read failures.
  }
  return '';
};

const formatDuration = (seconds: number | null): string => {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return 'Unknown';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

export default function ChannelStreamsPage() {
  const [channelUrl, setChannelUrl] = useState(loadDefaultChannelUrl);
    const defaultLoadedRef = useRef(false);

    // Fetch the backend-persisted default channel URL on mount.
    useEffect(() => {
      void fetchSettings().then((s) => {
        const backendDefault = normalizeStreamsTabUrl(s.app.default_channel_url);
        if (backendDefault && !defaultLoadedRef.current) {
          defaultLoadedRef.current = true;
          setChannelUrl((current) => (current ? current : backendDefault));
        }
      }).catch(() => { /* silently ignore — static config is fallback */ });
    }, []);

  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [queueError, setQueueError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<ChannelStreamsPreview | null>(null);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<DownloadPreset['key']>(loadSavedPreset);
  const [filterText, setFilterText] = useState('');
  const [newestFirst, setNewestFirst] = useState(true);
  const [completedUrls, setCompletedUrls] = useState<string[]>([]);
  const [queueing, setQueueing] = useState(false);

  const selectedSet = useMemo(() => new Set(selectedUrls), [selectedUrls]);
  const completedSet = useMemo(() => new Set(completedUrls), [completedUrls]);
  const unseenUrls = useMemo(() => {
    if (!preview) return [];
    return preview.items
      .map((item) => item.url)
      .filter((url) => !completedSet.has(url));
  }, [preview, completedSet]);

  const visibleItems = useMemo(() => {
    if (!preview) return [];
    const query = filterText.trim().toLowerCase();
    const filtered = preview.items.filter((item) =>
      query.length === 0
        ? true
        : item.title.toLowerCase().includes(query) || item.uploader.toLowerCase().includes(query),
    );

    filtered.sort((a, b) => {
      // Prefer numeric timestamp; fall back to uploadDate string (YYYYMMDD sorts
      // correctly as string in the same direction as numeric timestamps).
      const leftKey: number | string | null =
        a.uploadTimestamp ?? (a.uploadDate ? a.uploadDate.replace(/-/g, '') : null);
      const rightKey: number | string | null =
        b.uploadTimestamp ?? (b.uploadDate ? b.uploadDate.replace(/-/g, '') : null);

      if (leftKey !== null && rightKey !== null) {
        if (leftKey < rightKey) return newestFirst ? 1 : -1;
        if (leftKey > rightKey) return newestFirst ? -1 : 1;
      } else if (leftKey !== null) {
        return -1;
      } else if (rightKey !== null) {
        return 1;
      }

      return a.title.localeCompare(b.title);
    });

    return filtered;
  }, [preview, filterText, newestFirst]);

  const handleLoadStreams = useCallback(async () => {
    const trimmed = normalizeStreamsTabUrl(channelUrl.trim());
    if (!trimmed) {
      setPreviewError('Paste a YouTube channel URL first.');
      return;
    }

    setChannelUrl(trimmed);

    setLoading(true);
    setPreviewError('');
    setQueueError('');
    setNotice('');

    try {
      const data = await fetchChannelStreamsPreview(trimmed);
      const jobs = await fetchVodJobs();
      const completed = jobs
        .filter((job) => job.status === 'completed')
        .map((job) => String(job.url || '').trim())
        .filter(Boolean);

      setPreview(data);
      setChannelUrl(data.streamsTabUrl);
      setSelectedUrls([]);
      setCompletedUrls([...new Set(completed)]);
      try {
        window.localStorage.setItem(DEFAULT_CHANNEL_STORAGE_KEY, data.streamsTabUrl);
      } catch {
        // Ignore localStorage write failures.
      }
      const available = new Set(data.presets.map((preset) => preset.key));
      if (!available.has(selectedPreset)) {
        setSelectedPreset(normalizePreset(data.defaultPreset));
      }
    } catch (err) {
      setPreview(null);
      setSelectedUrls([]);
      setPreviewError(err instanceof Error ? err.message : 'Failed to load channel streams.');
    } finally {
      setLoading(false);
    }
  }, [channelUrl, selectedPreset]);

  const toggleUrl = useCallback((url: string) => {
    setSelectedUrls((current) => {
      if (current.includes(url)) {
        return current.filter((item) => item !== url);
      }
      return [...current, url];
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedUrls(visibleItems.map((item) => item.url));
  }, [visibleItems]);

  const clearAll = useCallback(() => {
    setSelectedUrls([]);
  }, []);

  const handleQueueSelected = useCallback(async () => {
    if (selectedUrls.length === 0) {
      setQueueError('Select at least one stream to queue.');
      return;
    }

    setQueueing(true);
    setQueueError('');
    setNotice('');

    try {
      const result = await queueChannelStreams(
        preview?.items
          .filter((item) => selectedUrls.includes(item.url))
          .map((item) => ({ url: item.url, title: item.title })) || [],
        selectedPreset,
      );
      setNotice(`Queued ${result.queuedCount} stream(s). Skipped ${result.skippedCount}.`);
      try {
        window.localStorage.setItem(PRESET_STORAGE_KEY, selectedPreset);
      } catch {
        // Ignore storage errors.
      }
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : 'Failed to queue selected streams.');
    } finally {
      setQueueing(false);
    }
  }, [selectedUrls, selectedPreset, preview?.items]);

  const handleQueueUnseen = useCallback(async () => {
    if (unseenUrls.length === 0) {
      setQueueError('No unseen completed-history streams to queue.');
      return;
    }

    setQueueing(true);
    setQueueError('');
    setNotice('');

    try {
      const result = await queueChannelStreams(
        preview?.items
          .filter((item) => unseenUrls.includes(item.url))
          .map((item) => ({ url: item.url, title: item.title })) || [],
        selectedPreset,
      );
      setNotice(`Queued ${result.queuedCount} unseen stream(s). Skipped ${result.skippedCount}.`);
      try {
        window.localStorage.setItem(PRESET_STORAGE_KEY, selectedPreset);
      } catch {
        // Ignore storage errors.
      }
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : 'Failed to queue unseen streams.');
    } finally {
      setQueueing(false);
    }
  }, [unseenUrls, selectedPreset, preview?.items]);

  return (
    <section className="page-stack">
      <article className="panel voote-channel-panel">
        <p className="eyebrow">Bulk from channel</p>
        <h2>Channel Streams</h2>
        <p className="muted-copy">
          Paste your channel URL and VOOTED will pull VODs from the streams tab so you can queue many at once.
        </p>

        <div className="voote-channel-form">
          <label className="field">
            <span>Channel URL (or /streams URL)</span>
            <input
              type="url"
              inputMode="url"
              value={channelUrl}
              onChange={(event) => setChannelUrl(event.target.value)}
              onBlur={() => setChannelUrl((current) => normalizeStreamsTabUrl(current))}
              placeholder="https://www.youtube.com/@YourChannel/streams"
              disabled={loading || queueing}
            />
          </label>
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleLoadStreams()}
            disabled={loading || queueing || channelUrl.trim().length === 0}
          >
            {loading ? 'Loading streams…' : 'Load streams'}
          </button>
        </div>

        {previewError ? <p className="message error">{previewError}</p> : null}

        {preview ? (
          <div className="voote-channel-results">
            <div className="voote-channel-results-head">
              <div>
                <p className="voote-channel-title">{preview.channelTitle}</p>
                <p className="muted-copy">
                  Found {preview.total} stream(s) from {preview.streamsTabUrl}
                </p>
              </div>
              <div className="voote-channel-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setNewestFirst((value) => !value)}
                  disabled={queueing}
                >
                  Sort: {newestFirst ? 'Newest first' : 'Oldest first'}
                </button>
              </div>
            </div>

            <label className="field voote-channel-filter" role="search">
              <span>Search streams</span>
              <input
                type="text"
                value={filterText}
                onChange={(event) => setFilterText(event.target.value)}
                placeholder="Search by title or channel"
                disabled={queueing}
              />
            </label>

            <p className="muted-copy voote-channel-stats">
              Showing {visibleItems.length} of {preview.items.length} streams · Unseen from completed history: {unseenUrls.length}
            </p>

            <label className="field voote-channel-quality">
              <span>Quality preset for selected streams</span>
              <select
                value={selectedPreset}
                onChange={(event) => setSelectedPreset(event.target.value as DownloadPreset['key'])}
                disabled={queueing}
              >
                {preview.presets.map((preset) => (
                  <option key={preset.key} value={preset.key}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="voote-channel-list-toolbar">
              <div className="voote-channel-actions">
                <button type="button" className="secondary-btn" onClick={selectAll} disabled={queueing}>
                  Select visible
                </button>
                <button type="button" className="secondary-btn" onClick={clearAll} disabled={queueing}>
                  Clear
                </button>
                <span className="muted-copy">{selectedUrls.length} selected</span>
              </div>
              <div className="voote-channel-actions">
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => void handleQueueSelected()}
                  disabled={queueing || selectedUrls.length === 0}
                >
                  {queueing ? 'Queueing…' : `Queue selected (${selectedUrls.length})`}
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => void handleQueueUnseen()}
                  disabled={queueing || unseenUrls.length === 0}
                >
                  {queueing ? 'Queueing…' : `Queue all unseen (${unseenUrls.length})`}
                </button>
              </div>
            </div>

            <ul className="voote-channel-list">
              {visibleItems.map((item) => (
                <li key={item.id} className="voote-channel-item">
                  <label className="voote-channel-item-toggle">
                    <input
                      type="checkbox"
                      checked={selectedSet.has(item.url)}
                      onChange={() => toggleUrl(item.url)}
                      disabled={queueing}
                    />
                    <span className="sr-only">Select stream</span>
                  </label>
                  {item.thumbnail ? (
                    <img className="voote-channel-thumb" src={item.thumbnail} alt={item.title} loading="lazy" />
                  ) : (
                    <div className="voote-channel-thumb voote-channel-thumb-empty">No thumb</div>
                  )}
                  <div className="voote-channel-item-main">
                    <a href={item.url} target="_blank" rel="noreferrer" className="voote-channel-item-link">
                      {item.title}
                    </a>
                    <p className="voote-channel-item-meta">
                      {item.uploader || 'Unknown channel'} · {formatDuration(item.duration)}
                      {item.uploadDate ? ` · ${item.uploadDate}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {queueError ? <p className="message error">{queueError}</p> : null}
        {notice ? <p className="message success">{notice}</p> : null}
      </article>
    </section>
  );
}
