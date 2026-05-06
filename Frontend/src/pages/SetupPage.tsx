import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { completeSetup, pickFolder, shutdownApp } from '../lib/vodApi';
import type { SetupStatus } from '../lib/vodApi';

type Props = {
  setupStatus: SetupStatus;
  onComplete: () => void;
};

export default function SetupPage({ setupStatus, onComplete }: Props) {
  const [vodOutputDir, setVodOutputDir] = useState('');
  const [folderConfirmed, setFolderConfirmed] = useState(false);
  const [ytDlpChoice, setYtDlpChoice] = useState<'system' | 'portable' | 'auto'>('auto');
  const [submitting, setSubmitting] = useState(false);
  const [setupProgress, setSetupProgress] = useState(0);
  const [setupProgressText, setSetupProgressText] = useState('Preparing setup...');
  const [shuttingDown, setShuttingDown] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [error, setError] = useState('');
  const navTimeoutRef = useRef<number | null>(null);

  const handleBrowseFolder = async () => {
    setPickingFolder(true);
    setError('');
    try {
      const picked = await pickFolder(
        'Select VOD save folder',
        vodOutputDir.trim() || setupStatus.appDir || '',
      );
      if (picked) setVodOutputDir(picked);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Folder picker unavailable: ${err.message}. You can still type the path manually.`
          : 'Folder picker unavailable. You can still type the path manually.',
      );
    } finally {
      setPickingFolder(false);
    }
  };

  useEffect(() => {
    return () => {
      if (navTimeoutRef.current) {
        window.clearTimeout(navTimeoutRef.current);
      }
    };
  }, []);

  const handleConfirm = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!folderConfirmed) {
      setError('Please confirm this is the folder where VOOTED should live before starting.');
      return;
    }
    setError('');
    setSubmitting(true);
    setSetupProgress(10);
    const likelyDownload = ytDlpChoice === 'portable' || !setupStatus.ytDlpAvailable;
    setSetupProgressText(
      likelyDownload ? 'Downloading portable yt-dlp...' : 'Applying setup settings...',
    );

    let progressTimer: number | null = window.setInterval(() => {
      setSetupProgress((current) => {
        const cap = likelyDownload ? 92 : 84;
        if (current >= cap) return current;
        return Math.min(cap, current + (likelyDownload ? 3 : 7));
      });
    }, 250);

    try {
      await completeSetup(vodOutputDir.trim() || undefined, ytDlpChoice);
      setSetupProgress(100);
      setSetupProgressText('Setup complete. Opening dashboard...');
      navTimeoutRef.current = window.setTimeout(() => {
        onComplete();
      }, 260);
    } catch (err) {
      setSetupProgress(0);
      setError(err instanceof Error ? err.message : 'Setup failed. Please try again.');
    } finally {
      if (progressTimer) {
        window.clearInterval(progressTimer);
        progressTimer = null;
      }
      if (navTimeoutRef.current === null) {
        setSubmitting(false);
      }
    }
  };

  const handleClose = async () => {
    setShuttingDown(true);
    try {
      await shutdownApp();
    } catch {
      // Server closed before responding — expected.
    }
    window.close();
  };

  return (
    <div className="setup-overlay">
      <div className="setup-card">
        <button
          type="button"
          className="setup-close-btn"
          onClick={handleClose}
          disabled={shuttingDown}
          title="Close and exit setup"
          aria-label="Close setup"
        >
          ✕
        </button>
        <p className="hero-kicker">First Launch</p>
        <h1 className="setup-title">Welcome to VOOTED</h1>
        <p className="setup-subtitle">
          VOOTED is a portable app — once you confirm below, this folder becomes its
          permanent home. Settings, job history, and downloaded VODs will all live here.
          Please double-check the path before continuing.
        </p>

        <div className="setup-section setup-section-warning">
          <p className="setup-label setup-label-warning">⚠ Is this the right folder?</p>
          <code className="setup-path">{setupStatus.appDir || '(unknown)'}</code>
          <p className="setup-hint">
            After you hit <strong>Confirm &amp; Start</strong>, VOOTED will create
            <code> vooted.runtime.json</code>, <code>config.json</code>, a <code>data/</code>
            folder, and a <code>Youtube_VOD/</code> folder right inside this path. Picking the
            wrong place (Downloads, Desktop, a temp folder) will scatter those files there.
          </p>
        </div>

        <details className="setup-howto">
          <summary>Not the right place? Here&rsquo;s how to move VOOTED →</summary>
          <ol className="setup-steps">
            <li>
              Click the <strong>✕</strong> button at the top-right of this card to shut
              VOOTED down cleanly.
            </li>
            <li>
              In your file explorer, move the entire VOOTED app folder to where you want
              it to live long-term — for example
              <code> Documents\VOOTED</code>, <code>D:\Apps\VOOTED</code>, or a USB drive.
            </li>
            <li>
              Open the moved folder and run <code>run.bat</code> (or the EXE) again. This
              setup screen will reappear with the new path shown above.
            </li>
            <li>
              Once the path looks right, tick the confirmation below and start VOOTED.
            </li>
          </ol>
          <p className="setup-hint setup-hint-tip">
            Tip: pick a folder you won&rsquo;t accidentally delete or sync to the cloud,
            since downloaded VODs can get large.
          </p>
        </details>

        <form onSubmit={handleConfirm} className="setup-form">
          <div className="setup-field">
            <label htmlFor="vodOutputDir" className="setup-label">
              VOD save location
            </label>
            <div className="setup-input-row">
              <input
                id="vodOutputDir"
                type="text"
                className="setup-input"
                placeholder="./Youtube_VOD  (default)"
                value={vodOutputDir}
                onChange={(e) => setVodOutputDir(e.target.value)}
                disabled={submitting || pickingFolder}
              />
              <button
                type="button"
                className="setup-browse-btn"
                onClick={() => void handleBrowseFolder()}
                disabled={submitting || pickingFolder}
                title="Open folder picker"
              >
                {pickingFolder ? 'Opening…' : 'Browse…'}
              </button>
            </div>
            <p className="setup-hint">
              Where your downloaded YouTube VODs will be saved. Click <strong>Browse…</strong>
              {' '}to pick a folder, or leave blank to use the default
              {' '}<strong>Youtube_VOD</strong> folder inside the app folder.
            </p>
          </div>

          {setupStatus.ytDlpAvailable && (
            <div className="setup-section">
              <p className="setup-label">YouTube downloader (yt-dlp)</p>
              <fieldset className="setup-radio-group">
                <legend className="setup-hint">yt-dlp was detected on your system. Which would you prefer?</legend>
                <label className="setup-radio">
                  <input
                    type="radio"
                    name="ytDlpChoice"
                    value="system"
                    checked={ytDlpChoice === 'system'}
                    onChange={(e) => setYtDlpChoice(e.target.value as 'system' | 'portable' | 'auto')}
                    disabled={submitting}
                  />
                  <span>Use existing system yt-dlp</span>
                </label>
                <label className="setup-radio">
                  <input
                    type="radio"
                    name="ytDlpChoice"
                    value="portable"
                    checked={ytDlpChoice === 'portable'}
                    onChange={(e) => setYtDlpChoice(e.target.value as 'system' | 'portable' | 'auto')}
                    disabled={submitting}
                  />
                  <span>Download and use VOOTED portable yt-dlp (bundled in data folder)</span>
                </label>
                <label className="setup-radio">
                  <input
                    type="radio"
                    name="ytDlpChoice"
                    value="auto"
                    checked={ytDlpChoice === 'auto'}
                    onChange={(e) => setYtDlpChoice(e.target.value as 'system' | 'portable' | 'auto')}
                    disabled={submitting}
                  />
                  <span>Auto-detect (use system if available, otherwise download portable)</span>
                </label>
              </fieldset>
            </div>
          )}

          <label className="setup-confirm-check">
            <input
              type="checkbox"
              checked={folderConfirmed}
              onChange={(e) => {
                setFolderConfirmed(e.target.checked);
                if (e.target.checked) setError('');
              }}
              disabled={submitting}
            />
            <span>
              Yes, the folder above is where I want VOOTED to live. I understand its
              settings and downloaded VODs will be created here.
            </span>
          </label>

          {error && <p className="setup-error">{error}</p>}

          {submitting && (
            <div className="setup-progress-wrap" role="status" aria-live="polite">
              <div
                className="setup-progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={setupProgress}
                aria-label="Setup progress"
              >
                <div className="setup-progress-fill" style={{ width: `${setupProgress}%` }} />
              </div>
              <p className="setup-progress-text">{setupProgressText}</p>
            </div>
          )}

          <button
            type="submit"
            className="primary-btn setup-confirm-btn"
            disabled={submitting || shuttingDown || !folderConfirmed}
          >
            {submitting ? 'Setting up…' : 'Confirm & Start VOOTED'}
          </button>

          <button
            type="button"
            className="setup-cancel-btn"
            onClick={handleClose}
            disabled={submitting || shuttingDown}
          >
            {shuttingDown ? 'Closing…' : 'Close & move app to another folder'}
          </button>
        </form>
      </div>
    </div>
  );
}
