import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { usePolling } from '../hooks/usePolling';
import {
  cancelVodJob,
  createVodJob,
  deleteVodJob,
  fetchVodJobs,
  fetchVodMeta,
  fetchVodPreview,
  pauseVodQueue,
  requeueVodJob,
  resumeVodJob,
  startVodQueue,
} from '../lib/vodApi';
import type { DownloadPreset, VodJob, VodJobStatus, VodMeta, VodPreview } from '../lib/vodApi';

const POLL_INTERVAL_MS = 3000;

const STATUS_LABEL: Record<VodJobStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  canceled: 'Canceled',
};

const ACTIVE_STATUSES: ReadonlyArray<VodJobStatus> = ['queued', 'running'];
const PAUSED_STATUS: VodJobStatus = 'paused';
const CANCELABLE_STATUSES: ReadonlyArray<VodJobStatus> = ['queued', 'running', 'paused'];

const formatTimestamp = (value: string | null): string => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

const truncateUrl = (url: string, max = 64): string =>
  url.length > max ? `${url.slice(0, max - 1)}…` : url;

const formatDuration = (seconds: number | null): string => {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return 'Unknown duration';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

const formatProgress = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0%';
  return `${value.toFixed(1)}%`;
};

const formatPresetLabel = (preset: VodJob['download_preset']): string => {
  switch (preset) {
    case '1080p':
      return '1080p (up to 60fps)';
    case '1080p30':
      return '1080p 30fps';
    case '720p':
      return '720p (up to 60fps)';
    case '720p30':
      return '720p 30fps';
    case '480p':
      return '480p';
    case 'best':
    default:
      return 'Best available';
  }
};

const formatJobQualityLabel = (job: VodJob): string => {
  const baseLabel = formatPresetLabel(job.download_preset);
  const actual = String(job.actual_quality_text || '').trim();
  if (!actual) {
    return baseLabel;
  }
  return `${baseLabel} (${actual})`;
};

const DEFAULT_PORT = 8111;
const PRESET_STORAGE_KEY = 'vooted.downloadPreset';
const FALLBACK_PRESET: DownloadPreset['key'] = 'best';
const PRESET_VALUES: DownloadPreset['key'][] = ['best', '1080p', '1080p30', '720p', '720p30', '480p'];

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

const getJobLabel = (job: VodJob, preview: VodPreview | null): string => {
  if (job.display_title) return job.display_title;
  if (preview && preview.url === job.url && preview.title) return preview.title;
  return job.output_filename || truncateUrl(job.url);
};

export default function HomePage() {
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitNotice, setSubmitNotice] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [preview, setPreview] = useState<VodPreview | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<DownloadPreset['key']>(loadSavedPreset);
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);
  const [pendingResumeId, setPendingResumeId] = useState<string | null>(null);
  const [pendingRequeueId, setPendingRequeueId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [bulkActionInFlight, setBulkActionInFlight] = useState(false);
  const [queueToggleInFlight, setQueueToggleInFlight] = useState(false);
  const [portWarningDismissed, setPortWarningDismissed] = useState(false);

  const metaState = usePolling<VodMeta>(
    (signal) => fetchVodMeta(signal),
    [],
    { intervalMs: POLL_INTERVAL_MS },
  );

  const jobsState = usePolling<VodJob[]>(
    (signal) => fetchVodJobs(signal),
    [],
    { intervalMs: POLL_INTERVAL_MS },
  );

  const meta = metaState.data;
  const jobs = useMemo(() => jobsState.data || [], [jobsState.data]);
  const initialJobsLoading = jobsState.loading && !jobsState.data;
  const initialMetaLoading = metaState.loading && !metaState.data;

  useEffect(() => {
    try {
      window.localStorage.setItem(PRESET_STORAGE_KEY, selectedPreset);
    } catch {
      // Ignore storage failures in locked-down environments.
    }
  }, [selectedPreset]);

  useEffect(() => {
    const visibleIds = new Set(jobs.map((job) => job.id));
    setSelectedJobIds((current) => current.filter((id) => visibleIds.has(id)));
  }, [jobs]);

  const handlePreview = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setPreviewError('Paste a YouTube URL first.');
      setPreview(null);
      return;
    }

    setPreviewLoading(true);
    setPreviewError('');
    setSubmitError('');

    try {
      const data = await fetchVodPreview(trimmed);
      setPreview(data);
      const available = new Set(data.presets.map((preset) => preset.key));
      if (!available.has(selectedPreset)) {
        setSelectedPreset(normalizePreset(data.defaultPreset));
      }
    } catch (err) {
      setPreview(null);
      setPreviewError(err instanceof Error ? err.message : 'Failed to load video details.');
    } finally {
      setPreviewLoading(false);
    }
  }, [url, selectedPreset]);

  // Form submit. Two phases: if no preview loaded yet, Enter / submit triggers
  // a preview fetch (so users can't queue blind). Once preview is loaded and
  // they pick a quality, the visible Queue download button (rendered inside
  // the preview section) submits the form and we run the actual queue call.
  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = url.trim();
      if (!trimmed) {
        setSubmitError('Paste a YouTube URL first.');
        return;
      }
      if (!preview) {
        void handlePreview();
        return;
      }

      setSubmitting(true);
      setSubmitError('');
      setSubmitNotice('');

      try {
        const job = await createVodJob(trimmed, selectedPreset, preview.title || undefined);
        setUrl('');
        setPreview(null);
        setPreviewError('');
        setSubmitNotice(`Queued job ${job.id.slice(0, 8)}.`);
        jobsState.refresh();
        metaState.refresh();
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Failed to create job');
      } finally {
        setSubmitting(false);
      }
    },
    [url, selectedPreset, preview, handlePreview, jobsState, metaState],
  );

  const handleCancel = useCallback(
    async (jobId: string) => {
      setPendingCancelId(jobId);
      try {
        await cancelVodJob(jobId);
        jobsState.refresh();
        metaState.refresh();
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Failed to cancel job');
      } finally {
        setPendingCancelId((current) => (current === jobId ? null : current));
      }
    },
    [jobsState, metaState],
  );

  const handleDelete = useCallback(
    async (jobId: string) => {
      setPendingDeleteId(jobId);
      try {
        await deleteVodJob(jobId);
        jobsState.refresh();
        metaState.refresh();
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Failed to delete job');
      } finally {
        setPendingDeleteId((current) => (current === jobId ? null : current));
      }
    },
    [jobsState, metaState],
  );

  const handleResume = useCallback(
    async (jobId: string) => {
      setPendingResumeId(jobId);
      try {
        await resumeVodJob(jobId);
        jobsState.refresh();
        metaState.refresh();
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Failed to continue job');
      } finally {
        setPendingResumeId((current) => (current === jobId ? null : current));
      }
    },
    [jobsState, metaState],
  );

  const handleRequeue = useCallback(
    async (jobId: string) => {
      setPendingRequeueId(jobId);
      try {
        await requeueVodJob(jobId);
        jobsState.refresh();
        metaState.refresh();
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Failed to requeue job');
      } finally {
        setPendingRequeueId((current) => (current === jobId ? null : current));
      }
    },
    [jobsState, metaState],
  );

  const handleToggleJobSelection = useCallback((jobId: string) => {
    setSelectedJobIds((current) => {
      if (current.includes(jobId)) {
        return current.filter((id) => id !== jobId);
      }
      return [...current, jobId];
    });
  }, []);

  const handleSelectAllJobs = useCallback(() => {
    setSelectedJobIds(jobs.map((job) => job.id));
  }, [jobs]);

  const handleClearSelectedJobs = useCallback(() => {
    setSelectedJobIds([]);
  }, []);

  const handleBulkCancel = useCallback(async () => {
    const selectedJobs = jobs.filter((job) => selectedJobIds.includes(job.id));
    const cancelableJobs = selectedJobs.filter((job) => CANCELABLE_STATUSES.includes(job.status));
    if (cancelableJobs.length === 0) {
      setSubmitError('No selected jobs are cancelable.');
      return;
    }

    setBulkActionInFlight(true);
    setSubmitError('');
    setSubmitNotice('');

    let successCount = 0;
    for (const job of cancelableJobs) {
      try {
        await cancelVodJob(job.id);
        successCount += 1;
      } catch {
        // Continue through batch; summary notice/error shown after loop.
      }
    }

    jobsState.refresh();
    metaState.refresh();
    setBulkActionInFlight(false);

    if (successCount === cancelableJobs.length) {
      setSubmitNotice(`Canceled ${successCount} selected job(s).`);
    } else {
      setSubmitError(`Canceled ${successCount}/${cancelableJobs.length} selected job(s).`);
    }
  }, [jobs, selectedJobIds, jobsState, metaState]);

  const handleBulkDelete = useCallback(async () => {
    const selectedJobs = jobs.filter((job) => selectedJobIds.includes(job.id));
    const deletableJobs = selectedJobs.filter((job) => !CANCELABLE_STATUSES.includes(job.status));
    if (deletableJobs.length === 0) {
      setSubmitError('No selected jobs are deletable. Cancel active ones first.');
      return;
    }

    setBulkActionInFlight(true);
    setSubmitError('');
    setSubmitNotice('');

    let successCount = 0;
    for (const job of deletableJobs) {
      try {
        await deleteVodJob(job.id);
        successCount += 1;
      } catch {
        // Continue through batch; summary notice/error shown after loop.
      }
    }

    jobsState.refresh();
    metaState.refresh();
    setBulkActionInFlight(false);
    setSelectedJobIds([]);

    if (successCount === deletableJobs.length) {
      setSubmitNotice(`Deleted ${successCount} selected job(s).`);
    } else {
      setSubmitError(`Deleted ${successCount}/${deletableJobs.length} selected job(s).`);
    }
  }, [jobs, selectedJobIds, jobsState, metaState]);

  const handlePauseQueue = useCallback(async () => {
    setQueueToggleInFlight(true);
    setSubmitError('');
    try {
      await pauseVodQueue();
      metaState.refresh();
      setSubmitNotice('Queue paused. New queued jobs will wait until start queue is pressed.');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to pause queue');
    } finally {
      setQueueToggleInFlight(false);
    }
  }, [metaState]);

  const handleStartQueue = useCallback(async () => {
    setQueueToggleInFlight(true);
    setSubmitError('');
    try {
      await startVodQueue();
      metaState.refresh();
      jobsState.refresh();
      setSubmitNotice('Queue started. Waiting jobs will resume processing.');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to start queue');
    } finally {
      setQueueToggleInFlight(false);
    }
  }, [metaState, jobsState]);

  const showPortWarning = !!meta?.portConflict && !portWarningDismissed;

  return (
    <section className="page-stack">
      {showPortWarning ? (
        <div className="voote-port-banner" role="status" aria-live="polite">
          <span className="voote-port-banner-icon" aria-hidden="true">⚠</span>
          <div className="voote-port-banner-body">
            <strong>Port {DEFAULT_PORT} was in use.</strong>
            <span>
              VOOTED is running on port {meta?.boundPort ?? DEFAULT_PORT} instead.
            </span>
          </div>
          <button
            type="button"
            className="voote-port-banner-dismiss"
            onClick={() => setPortWarningDismissed(true)}
            aria-label="Dismiss port conflict warning"
          >
            ✕
          </button>
        </div>
      ) : null}

      <article className="panel feature-hero voote-status-panel">
        <div>
          <p className="eyebrow">Runtime status</p>
          <h2>Queue overview</h2>
          <p className="muted-copy">
            Submit a YouTube URL and VOOTED will queue, download, and merge it locally with yt-dlp.
          </p>
        </div>

        <div className="voote-status-grid">
          <div className="voote-status-card">
            <span className="voote-status-label">yt-dlp</span>
            <strong className={meta?.ytDlp.available ? 'voote-status-good' : 'voote-status-bad'}>
              {initialMetaLoading
                ? 'Checking…'
                : meta?.ytDlp.available
                  ? `Ready · ${meta.ytDlp.command}`
                  : `Not found (${meta?.ytDlp.command || 'yt-dlp'})`}
            </strong>
          </div>
          <div className="voote-status-card">
            <span className="voote-status-label">Output folder</span>
            <strong className="voote-status-path">
              {meta?.vodOutputDir || (initialMetaLoading ? 'Loading…' : 'Unknown')}
            </strong>
          </div>
          {meta?.queue.activeJobId ? (
            <Link
              to={`/jobs/${meta.queue.activeJobId}`}
              className="voote-status-card voote-status-card-link"
              aria-label={`Open active job ${meta.queue.activeJobId.slice(0, 8)}`}
            >
              <span className="voote-status-label">Active job</span>
              <strong>{`${meta.queue.activeJobId.slice(0, 8)}…`}</strong>
            </Link>
          ) : (
            <div className="voote-status-card">
              <span className="voote-status-label">Active job</span>
              <strong>Idle</strong>
            </div>
          )}
        </div>

        <div className="voote-counter-row">
          <CounterPill label="Queued" value={meta?.queue.queued ?? 0} status="queued" />
          <CounterPill label="Running" value={meta?.queue.running ?? 0} status="running" />
          <CounterPill label="Paused" value={meta?.queue.paused ?? 0} status="paused" />
          <CounterPill label="Completed" value={meta?.queue.completed ?? 0} status="completed" />
          <CounterPill label="Failed" value={meta?.queue.failed ?? 0} status="failed" />
          <CounterPill label="Canceled" value={meta?.queue.canceled ?? 0} status="canceled" />
          <CounterPill label="Total" value={meta?.queue.total ?? 0} />
        </div>

        <div className="voote-queue-controls">
          <span
            className={`voote-queue-state ${meta?.queue.isPaused ? 'voote-queue-state-paused' : 'voote-queue-state-running'}`}
            role="status"
            aria-live="polite"
          >
            <span className="voote-queue-state-dot" aria-hidden="true" />
            {meta?.queue.isPaused ? 'Queue paused' : 'Queue running'}
          </span>
          {meta?.queue.isPaused ? (
            <button
              type="button"
              className="secondary-btn"
              onClick={() => void handleStartQueue()}
              disabled={queueToggleInFlight}
            >
              {queueToggleInFlight ? 'Starting…' : 'Start queue'}
            </button>
          ) : (
            <button
              type="button"
              className="secondary-btn"
              onClick={() => void handlePauseQueue()}
              disabled={queueToggleInFlight}
            >
              {queueToggleInFlight ? 'Pausing…' : 'Pause queue'}
            </button>
          )}
        </div>
      </article>

      {metaState.error ? (
        <p className="message error">Meta poll error: {metaState.error}</p>
      ) : null}

      <article className="panel voote-submit-panel">
        <p className="eyebrow">New download</p>
        <h3>Queue a YouTube VOD</h3>
        <p className="muted-copy">
          Paste any YouTube watch URL. VOOTED will download the highest available 1440p60 mp4 and
          remux into a single file.
        </p>

        <p className="muted-copy voote-cookie-status">
          Cookie auth:{' '}
          <strong>
            {meta?.cookieAuth?.mode === 'browser'
              ? `Browser (${meta.cookieAuth.browser})`
              : meta?.cookieAuth?.mode === 'file'
                ? 'Cookie file'
                : 'Off'}
          </strong>{' '}
          ·{' '}
          <Link className="voote-cookie-link" to="/settings">
            Manage in Settings →
          </Link>
        </p>

        <form className="voote-submit-form" onSubmit={(event) => void handleSubmit(event)}>
          <label className="field voote-url-field">
            <span>YouTube URL</span>
            <input
              type="url"
              inputMode="url"
              placeholder="https://www.youtube.com/watch?v=…"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                // Editing the URL invalidates the previously-loaded preview —
                // force the user to re-preview so the Queue download button
                // can't fire against stale details.
                if (preview) setPreview(null);
                if (previewError) setPreviewError('');
              }}
              disabled={submitting}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="voote-submit-actions">
            <button
              className="secondary-btn"
              type="button"
              onClick={() => void handlePreview()}
              disabled={submitting || previewLoading || url.trim().length === 0}
            >
              {previewLoading ? 'Loading details…' : 'Preview details'}
            </button>
          </div>

          {preview ? (
            <section className="voote-preview" aria-live="polite">
              <div className="voote-preview-media">
                {preview.thumbnail ? (
                  <img src={preview.thumbnail} alt={preview.title} className="voote-preview-thumb" />
                ) : (
                  <div className="voote-preview-thumb voote-preview-thumb-empty">No thumbnail</div>
                )}
              </div>
              <div className="voote-preview-content">
                <p className="voote-preview-title">{preview.title}</p>
                <p className="voote-preview-meta">
                  {preview.uploader || 'Unknown channel'} · {formatDuration(preview.duration)}
                </p>
                <label className="field voote-preset-field">
                  <span>Download quality</span>
                  <select
                    value={selectedPreset}
                    onChange={(event) => setSelectedPreset(event.target.value as DownloadPreset['key'])}
                    disabled={submitting}
                  >
                    {preview.presets.map((preset) => (
                      <option key={preset.key} value={preset.key}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="voote-preview-preset-help">
                  {preview.presets.find((preset) => preset.key === selectedPreset)?.description || ''}
                </p>
                <button
                  className="primary-btn voote-preview-queue-btn"
                  type="submit"
                  disabled={submitting}
                >
                  {submitting ? 'Submitting…' : 'Queue download'}
                </button>
              </div>
            </section>
          ) : null}
        </form>

        {previewError ? <p className="message error">Preview error: {previewError}</p> : null}

        {submitError ? <p className="message error">{submitError}</p> : null}
        {submitNotice ? <p className="message success">{submitNotice}</p> : null}
      </article>

      <article className="panel voote-jobs-panel">
        <header className="voote-jobs-header">
          <div>
            <p className="eyebrow">Jobs</p>
            <h3>Recent downloads</h3>
          </div>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              jobsState.refresh();
              metaState.refresh();
            }}
            disabled={jobsState.loading}
          >
            {jobsState.loading && !initialJobsLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </header>

        {jobs.length > 0 ? (
          <div className="voote-jobs-bulk-actions">
            <span className="muted-copy">Selected {selectedJobIds.length}</span>
            <button
              type="button"
              className="secondary-btn"
              onClick={handleSelectAllJobs}
              disabled={bulkActionInFlight || selectedJobIds.length === jobs.length}
            >
              Select all
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={handleClearSelectedJobs}
              disabled={bulkActionInFlight || selectedJobIds.length === 0}
            >
              Clear
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => void handleBulkCancel()}
              disabled={bulkActionInFlight || selectedJobIds.length === 0}
            >
              {bulkActionInFlight ? 'Working…' : 'Cancel selected'}
            </button>
            <button
              type="button"
              className="voote-cancel-btn"
              onClick={() => void handleBulkDelete()}
              disabled={bulkActionInFlight || selectedJobIds.length === 0}
            >
              {bulkActionInFlight ? 'Working…' : 'Delete selected'}
            </button>
          </div>
        ) : null}

        {jobsState.error ? (
          <p className="message error">Jobs poll error: {jobsState.error}</p>
        ) : null}

        {initialJobsLoading ? (
          <p className="muted-copy">Loading jobs…</p>
        ) : jobs.length === 0 ? (
          <p className="muted-copy">No downloads yet. Queue one above to get started.</p>
        ) : (
          <ul className="voote-job-list">
            {jobs.map((job) => {
              const cancelable = ACTIVE_STATUSES.includes(job.status);
              const resumable = job.status === PAUSED_STATUS;
              const requeueable = job.status === 'canceled';
              const selected = selectedJobIds.includes(job.id);
              const cancelInFlight = pendingCancelId === job.id;
              const resumeInFlight = pendingResumeId === job.id;
              const requeueInFlight = pendingRequeueId === job.id;
              const deletable = !cancelable && !resumable;
              const deleteInFlight = pendingDeleteId === job.id;
              return (
                <li key={job.id} className="voote-job-row">
                  <label className="voote-job-select" aria-label={`Select job ${job.id.slice(0, 8)}`}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => handleToggleJobSelection(job.id)}
                      disabled={bulkActionInFlight}
                    />
                  </label>
                  <div className="voote-job-main">
                    <div className="voote-job-header">
                      <StatusPill status={job.status} />
                      <Link className="voote-job-link" to={`/jobs/${job.id}`}>
                        {getJobLabel(job, preview)}
                      </Link>
                    </div>
                    <p className="voote-job-meta">
                      <span className="voote-job-id">{job.id.slice(0, 8)}</span>
                      <span>Quality {formatJobQualityLabel(job)}</span>
                      <span>Created {formatTimestamp(job.created_at)}</span>
                      {job.finished_at ? (
                        <span>Finished {formatTimestamp(job.finished_at)}</span>
                      ) : null}
                    </p>
                    {job.error ? (
                      <p className="voote-job-error">{job.error}</p>
                    ) : null}
                    {(job.status === 'running' || job.status === 'paused') && typeof job.progress_percent === 'number' ? (
                      <div className="voote-job-progress">
                        <div className="voote-progress-track" aria-hidden="true">
                          <div className="voote-progress-fill" style={{ width: `${job.progress_percent}%` }} />
                        </div>
                        <p className="voote-job-progress-meta">
                          <span>{formatProgress(job.progress_percent)}</span>
                          {job.estimated_size_text ? <span>Est. size {job.estimated_size_text}</span> : null}
                          {job.speed_text ? <span>{job.speed_text}</span> : null}
                          {job.eta_text ? <span>ETA {job.eta_text}</span> : null}
                        </p>
                      </div>
                    ) : null}
                  </div>
                  <div className="voote-job-actions">
                    <Link to={`/jobs/${job.id}`} className="secondary-btn voote-job-action-btn">
                      Open
                    </Link>
                    {cancelable ? (
                      <button
                        type="button"
                        className="voote-cancel-btn"
                        onClick={() => void handleCancel(job.id)}
                        disabled={cancelInFlight}
                      >
                        {cancelInFlight ? 'Canceling…' : 'Cancel'}
                      </button>
                    ) : null}
                    {resumable ? (
                      <>
                        <button
                          type="button"
                          className="secondary-btn voote-job-action-btn"
                          onClick={() => void handleResume(job.id)}
                          disabled={resumeInFlight}
                        >
                          {resumeInFlight ? 'Continuing…' : 'Continue'}
                        </button>
                        <button
                          type="button"
                          className="voote-cancel-btn"
                          onClick={() => void handleCancel(job.id)}
                          disabled={cancelInFlight}
                        >
                          {cancelInFlight ? 'Canceling…' : 'Cancel'}
                        </button>
                      </>
                    ) : null}
                    {requeueable ? (
                      <button
                        type="button"
                        className="secondary-btn voote-job-action-btn"
                        onClick={() => void handleRequeue(job.id)}
                        disabled={requeueInFlight}
                      >
                        {requeueInFlight ? 'Requeuing…' : 'Requeue'}
                      </button>
                    ) : null}
                    {deletable ? (
                      <button
                        type="button"
                        className="voote-cancel-btn"
                        onClick={() => void handleDelete(job.id)}
                        disabled={deleteInFlight}
                      >
                        {deleteInFlight ? 'Deleting…' : 'Delete'}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </article>
    </section>
  );
}

function StatusPill({ status }: { status: VodJobStatus }) {
  return (
    <span className={`voote-status-pill voote-status-${status}`}>
      <span className="voote-status-dot" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

function CounterPill({
  label,
  value,
  status,
}: {
  label: string;
  value: number;
  status?: VodJobStatus;
}) {
  const className = status
    ? `voote-counter voote-counter-${status}`
    : 'voote-counter voote-counter-total';
  return (
    <div className={className}>
      <span className="voote-counter-value">{value}</span>
      <span className="voote-counter-label">{label}</span>
    </div>
  );
}
