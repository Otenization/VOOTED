import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage';
import ChannelStreamsPage from './pages/ChannelStreamsPage';
import JobDetailPage from './pages/JobDetailPage';
import SettingsPage from './pages/SettingsPage';
import SetupPage from './pages/SetupPage';
import Modal from './components/Modal';
import { fetchHealth, fetchSetupStatus, shutdownApp } from './lib/vodApi';
import type { SetupStatus } from './lib/vodApi';
import { getAppConfig } from './config';
import './index.css';

// null = still checking, true/false = result of /api/health probe.
type ServerLive = boolean | null;
const SHUTDOWN_TIMEOUT_MS = 5000;
// How long to wait after window.close() before deciding the browser blocked
// it. Browsers that allow it close synchronously; if we're still rendering
// after this delay, close was a silent no-op and we should show a manual
// fallback instead of leaving the user staring at a stale dashboard.
const TAB_CLOSE_FALLBACK_MS = 150;

export default function App() {
  const config = getAppConfig();
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [setupChecking, setSetupChecking] = useState(true);

  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [serverAlive, setServerAlive] = useState<ServerLive>(null);
  const [shuttingDown, setShuttingDown] = useState(false);
  // True once the server is confirmed stopped AND we've attempted to close
  // the tab. Drives the stopped-state overlay that replaces the dashboard
  // when the browser refuses script-driven tab close.
  const [showStoppedView, setShowStoppedView] = useState(false);

  const attemptWindowClose = useCallback(() => {
    // Try the script-driven close first. Browsers allow it for tabs opened
    // by window.open(); for user/OS-launched tabs (most VOOTED users) it's a
    // silent no-op. We can't tell which up front — so try it, then if we're
    // still rendering after a short delay, swap in a stopped-state view that
    // tells the user to close the tab themselves. Crucially we DO NOT
    // navigate to about:blank as a fallback — that produced a confusing
    // "blank page" UX where users thought the app crashed.
    window.close();
    window.setTimeout(() => {
      if (!document.hidden) {
        setShowStoppedView(true);
      }
    }, TAB_CLOSE_FALLBACK_MS);
  }, []);

  // Probe /api/health every time the dialog opens so the copy + primary action
  // reflect the *current* server state, not stale state from earlier in the
  // session (e.g. user already shut it down from another tab).
  const probeHealth = useCallback(async () => {
    setServerAlive(null);
    const result = await fetchHealth();
    setServerAlive(result.alive);
  }, []);

  const openCloseDialog = useCallback(() => {
    setCloseDialogOpen(true);
    void probeHealth();
  }, [probeHealth]);

  const cancelCloseDialog = useCallback(() => {
    if (shuttingDown) return;
    setCloseDialogOpen(false);
  }, [shuttingDown]);

  const confirmCloseApp = useCallback(async () => {
    if (serverAlive === null) return; // still probing — button should be disabled

    if (serverAlive === false) {
      // Server is already gone — try to close the tab, and fall back to
      // replacing this page if the browser blocks script-driven tab close.
      attemptWindowClose();
      return;
    }

    setShuttingDown(true);

    const timeout = new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error('Shutdown request timed out')), SHUTDOWN_TIMEOUT_MS);
    });

    try {
      await Promise.race([shutdownApp(), timeout]);
      attemptWindowClose();
    } catch {
      // shutdownApp() rejects when the server died before responding (or never
      // existed). Per spec: degrade to dead-state copy and let the user
      // confirm again to close the tab — don't auto-close, since the failure
      // might mean the request never reached the backend.
      setServerAlive(false);
    } finally {
      // If the browser blocks window.close() (common for non-script-opened tabs),
      // ensure the dialog exits the stuck "Stopping..." state and offers
      // the manual "Close Tab" fallback action.
      setShuttingDown(false);
    }
  }, [serverAlive, attemptWindowClose]);

  useEffect(() => {
    let cancelled = false;
    fetchSetupStatus()
      .then((status) => {
        if (!cancelled) setSetupStatus(status);
      })
      .catch(() => {
        // If we can't reach the API, assume setup is done and let normal
        // error handling in the main pages take over.
        if (!cancelled) setSetupStatus({ needsSetup: false, appDir: null, ytDlpAvailable: false });
      })
      .finally(() => {
        if (!cancelled) setSetupChecking(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (setupChecking) {
    return (
      <div className="setup-overlay">
        <p className="muted-copy">Starting VOOTED…</p>
      </div>
    );
  }

  if (setupStatus?.needsSetup) {
    return (
      <SetupPage
        setupStatus={setupStatus}
        onComplete={() =>
          setSetupStatus({
            needsSetup: false,
            appDir: setupStatus.appDir,
            ytDlpAvailable: setupStatus.ytDlpAvailable,
          })
        }
      />
    );
  }

  if (showStoppedView) {
    return (
      <div className="setup-overlay">
        <div className="setup-card">
          <p className="hero-kicker">VOOTED stopped</p>
          <h1 className="setup-title">You can close this tab now</h1>
          <p className="setup-subtitle">
            The local VOOTED server has been shut down. Your browser blocked
            the automatic tab close — that&rsquo;s normal for tabs that
            weren&rsquo;t opened by JavaScript, and a script retry would be
            blocked the same way. Close this tab manually:
          </p>

          <ul className="setup-stopped-shortcuts">
            <li>
              Press <strong>Ctrl + W</strong> (Windows / Linux) or{' '}
              <strong>⌘ + W</strong> (macOS)
            </li>
            <li>
              Or click the <strong>×</strong> on this browser tab
            </li>
          </ul>

          {setupStatus?.appDir ? (
            <div className="setup-section">
              <p className="setup-label">To open VOOTED again</p>
              <code className="setup-path">{setupStatus.appDir}</code>
              <p className="setup-hint">
                Launch the app from this folder again — the dashboard will
                open in a new browser tab.
              </p>
            </div>
          ) : (
            <p className="setup-hint">
              To open VOOTED again, launch the app from the folder where you
              placed it.
            </p>
          )}
        </div>
      </div>
    );
  }

  const isDead = serverAlive === false;
  const isChecking = serverAlive === null;
  const dialogTitle = isDead ? 'VOOTED server already stopped' : 'Close VOOTED?';
  const dialogDescription = isDead
    ? 'The VOOTED server appears to be down. This action will close this browser tab only.'
    : 'This will stop the local VOOTED server and close this browser tab.';
  const primaryLabel = isChecking
    ? 'Checking…'
    : shuttingDown
      ? 'Stopping…'
      : isDead
        ? 'Close Tab'
        : 'Stop VOOTED & Close Tab';

  return (
    <BrowserRouter>
      <main className="app-shell">
        <div className="app-glow app-glow-left" aria-hidden="true" />
        <div className="app-glow app-glow-right" aria-hidden="true" />

        <section className="app-frame">
          <header className="hero">
            <p className="hero-kicker">Video on Ote demand</p>
            <h1>{config.app.name}</h1>
            <p className="hero-copy">{config.app.subtitle}</p>
          </header>

          <nav className="app-nav" aria-label="Primary">
            <NavLink
              to="/"
              end
              className={({ isActive }) => (isActive ? 'app-nav-link active' : 'app-nav-link')}
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/channel-streams"
              className={({ isActive }) => (isActive ? 'app-nav-link active' : 'app-nav-link')}
            >
              Channel Streams
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) => (isActive ? 'app-nav-link active' : 'app-nav-link')}
            >
              Settings
            </NavLink>
            <button
              className="app-close-btn"
              onClick={openCloseDialog}
              disabled={shuttingDown || closeDialogOpen}
              title="Stop VOOTED and close this tab"
            >
              {shuttingDown ? 'Closing…' : '✕ Close App'}
            </button>
          </nav>

          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/channel-streams" element={<ChannelStreamsPage />} />
            <Route path="/jobs/:jobId" element={<JobDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<HomePage />} />
          </Routes>
        </section>

        <Modal
          open={closeDialogOpen}
          onClose={cancelCloseDialog}
          busy={shuttingDown}
          title={dialogTitle}
          description={dialogDescription}
          actions={
            <>
              <button
                type="button"
                className="secondary-btn"
                onClick={cancelCloseDialog}
                disabled={shuttingDown}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-btn"
                onClick={() => void confirmCloseApp()}
                disabled={isChecking || shuttingDown}
              >
                {primaryLabel}
              </button>
            </>
          }
        >
          {isChecking ? (
            <p className="muted-copy">Checking server status…</p>
          ) : null}
          <p className="close-dialog-reopen">
            {setupStatus?.appDir ? (
              <>
                To open VOOTED again, launch the app from:{' '}
                <code className="close-dialog-path">{setupStatus.appDir}</code>
              </>
            ) : (
              'To open VOOTED again, launch VOOTED from the folder where you placed the app.'
            )}
          </p>
        </Modal>
      </main>
    </BrowserRouter>
  );
}
