import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { usePolling } from '../hooks/usePolling';
import { cancelVodJob, deleteVodJob, fetchVodJob, requeueVodJob, resumeVodJob } from '../lib/vodApi';
import type { VodJob, VodJobStatus } from '../lib/vodApi';

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

const formatTimestamp = (value: string | null): string => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

const formatProgress = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)}%`;
};

const formatPresetLabel = (preset: VodJob['download_preset']): string => {
  switch (preset) {
    case '1080p':
      return '1080p';
    case '720p':
      return '720p';
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

export default function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [cancelInFlight, setCancelInFlight] = useState(false);
  const [resumeInFlight, setResumeInFlight] = useState(false);
  const [requeueInFlight, setRequeueInFlight] = useState(false);
  const [deleteInFlight, setDeleteInFlight] = useState(false);
  const [actionError, setActionError] = useState('');
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const fetcher = useCallback(
    (signal: AbortSignal) => {
      if (!jobId) {
        return Promise.reject(new Error('Missing job id'));
      }
      return fetchVodJob(jobId, signal);
    },
    [jobId],
  );

  const { data: job, error, loading, refresh } = usePolling<VodJob>(
    fetcher,
    [jobId],
    { intervalMs: POLL_INTERVAL_MS, enabled: Boolean(jobId) },
  );

  const cancelable = useMemo(
    () => Boolean(job && (ACTIVE_STATUSES.includes(job.status) || job.status === 'paused')),
    [job],
  );

  const resumable = useMemo(
    () => Boolean(job && job.status === 'paused'),
    [job],
  );

  const requeueable = useMemo(
    () => Boolean(job && job.status === 'canceled'),
    [job],
  );

  const deletable = useMemo(
    () => Boolean(job && !cancelable && !resumable),
    [job, cancelable, resumable],
  );

  useEffect(() => {
    if (!logEndRef.current) return;
    logEndRef.current.scrollIntoView({ block: 'end' });
  }, [job?.logs.length]);

  const handleCancel = useCallback(async () => {
    if (!jobId) return;
    setCancelInFlight(true);
    setActionError('');
    try {
      await cancelVodJob(jobId);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to cancel job');
    } finally {
      setCancelInFlight(false);
    }
  }, [jobId, refresh]);

  const handleResume = useCallback(async () => {
    if (!jobId) return;
    setResumeInFlight(true);
    setActionError('');
    try {
      await resumeVodJob(jobId);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to continue job');
    } finally {
      setResumeInFlight(false);
    }
  }, [jobId, refresh]);

  const handleDelete = useCallback(async () => {
    if (!jobId) return;
    setDeleteInFlight(true);
    setActionError('');
    try {
      await deleteVodJob(jobId);
      navigate('/', { replace: true });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete job');
    } finally {
      setDeleteInFlight(false);
    }
  }, [jobId, navigate]);

  const handleRequeue = useCallback(async () => {
    if (!jobId) return;
    setRequeueInFlight(true);
    setActionError('');
    try {
      await requeueVodJob(jobId);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to requeue job');
    } finally {
      setRequeueInFlight(false);
    }
  }, [jobId, refresh]);

  if (!jobId) {
    return (
      <article className="panel">
        <p className="message error">Missing job id in URL.</p>
        <Link className="secondary-btn" to="/">Back to dashboard</Link>
      </article>
    );
  }

  return (
    <section className="page-stack">
      <article className="panel voote-detail-header">
        <div>
          <p className="eyebrow">Job detail</p>
          <h2>{job?.display_title || job?.output_filename || job?.url || jobId}</h2>
          <p className="muted-copy voote-detail-id">ID: {jobId}</p>
        </div>
        <div className="voote-detail-actions">
          <Link to="/" className="secondary-btn">Back</Link>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => refresh()}
            disabled={loading && !job}
          >
            {loading && job ? 'Refreshing…' : 'Refresh'}
          </button>
          {resumable ? (
            <button
              type="button"
              className="secondary-btn"
              onClick={() => void handleResume()}
              disabled={resumeInFlight}
            >
              {resumeInFlight ? 'Continuing…' : 'Continue'}
            </button>
          ) : null}
          {cancelable ? (
            <button
              type="button"
              className="voote-cancel-btn"
              onClick={() => void handleCancel()}
              disabled={cancelInFlight}
            >
              {cancelInFlight ? 'Canceling…' : 'Cancel job'}
            </button>
          ) : null}
          {requeueable ? (
            <button
              type="button"
              className="secondary-btn"
              onClick={() => void handleRequeue()}
              disabled={requeueInFlight}
            >
              {requeueInFlight ? 'Requeuing…' : 'Requeue'}
            </button>
          ) : null}
          {deletable ? (
            <button
              type="button"
              className="voote-cancel-btn"
              onClick={() => void handleDelete()}
              disabled={deleteInFlight}
            >
              {deleteInFlight ? 'Deleting…' : 'Delete job'}
            </button>
          ) : null}
        </div>
      </article>

      {error ? <p className="message error">{error}</p> : null}
      {actionError ? <p className="message error">{actionError}</p> : null}

      {!job && loading ? (
        <article className="panel">
          <p className="muted-copy">Loading job…</p>
        </article>
      ) : null}

      {job ? (
        <>
          <article className="panel voote-detail-summary">
            <div className="voote-detail-row">
              <span className="voote-detail-label">Status</span>
              <span className={`voote-status-pill voote-status-${job.status}`}>
                <span className="voote-status-dot" aria-hidden="true" />
                {STATUS_LABEL[job.status]}
              </span>
            </div>
            <div className="voote-detail-row">
              <span className="voote-detail-label">Source URL</span>
              <a href={job.url} target="_blank" rel="noopener noreferrer" className="voote-detail-link">
                {job.url}
              </a>
            </div>
            <div className="voote-detail-row">
              <span className="voote-detail-label">Output file</span>
              <span className="voote-detail-value">{job.output_filename || '—'}</span>
            </div>
            <div className="voote-detail-row">
              <span className="voote-detail-label">Download quality</span>
              <span className="voote-detail-value">{formatJobQualityLabel(job)}</span>
            </div>
            <div className="voote-detail-row">
              <span className="voote-detail-label">Created</span>
              <span className="voote-detail-value">{formatTimestamp(job.created_at)}</span>
            </div>
            <div className="voote-detail-row">
              <span className="voote-detail-label">Started</span>
              <span className="voote-detail-value">{formatTimestamp(job.started_at)}</span>
            </div>
            <div className="voote-detail-row">
              <span className="voote-detail-label">Finished</span>
              <span className="voote-detail-value">{formatTimestamp(job.finished_at)}</span>
            </div>
            <div className="voote-detail-row">
              <span className="voote-detail-label">Last update</span>
              <span className="voote-detail-value">{formatTimestamp(job.updated_at)}</span>
            </div>
            {(job.status === 'running' || job.status === 'paused') ? (
              <div className="voote-detail-row">
                <span className="voote-detail-label">Download progress</span>
                <div className="voote-detail-value voote-detail-progress">
                  <div className="voote-progress-track" aria-hidden="true">
                    <div className="voote-progress-fill" style={{ width: `${job.progress_percent ?? 0}%` }} />
                  </div>
                  <span>{formatProgress(job.progress_percent)}</span>
                  {job.estimated_size_text ? <span>Estimated size: {job.estimated_size_text}</span> : null}
                  {job.speed_text ? <span>Speed: {job.speed_text}</span> : null}
                  {job.eta_text ? <span>ETA: {job.eta_text}</span> : null}
                </div>
              </div>
            ) : null}
            {job.error ? (
              <div className="voote-detail-row voote-detail-row-error">
                <span className="voote-detail-label">Error</span>
                <span className="voote-detail-value voote-detail-error">{job.error}</span>
              </div>
            ) : null}
          </article>

          <article className="panel voote-log-panel">
            <header className="voote-jobs-header">
              <div>
                <p className="eyebrow">Logs</p>
                <h3>Latest output ({job.logs.length} lines)</h3>
              </div>
            </header>
            {job.logs.length === 0 ? (
              <p className="muted-copy">No log lines yet.</p>
            ) : (
              <div className="voote-log-wrap">
                <pre className="voote-log-pre">{job.logs.join('\n')}</pre>
                <div ref={logEndRef} />
              </div>
            )}
          </article>
        </>
      ) : null}
    </section>
  );
}
