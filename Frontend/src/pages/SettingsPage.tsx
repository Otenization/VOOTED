import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import Modal from '../components/Modal';
import {
  applySelfUpdate,
  clearCookies,
  fetchCookieStatus,
  fetchSelfUpdateStatus,
  fetchSettings,
  importCookieFile,
  importPastedCookies,
  updateSettings,
} from '../lib/vodApi';
import type {
  ApplySelfUpdateResult,
  AppSettings,
  CookieStatus,
  SelfUpdateStatus,
  SettingsPatch,
  SettingsUpdateResponse,
} from '../lib/vodApi';

type CookieDialog = 'import' | 'clear' | null;
type ImportMode = 'file' | 'paste';

const formatBytes = (size: number): string => {
  if (!size) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
};

const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString();
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [cookies, setCookies] = useState<CookieStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [restartNotice, setRestartNotice] = useState(false);

  // Local form state — kept separate from the loaded settings so unsaved edits
  // don't get clobbered by a refetch.
  const [portInput, setPortInput] = useState('8111');
  const [autoOpen, setAutoOpen] = useState(true);
  const [msgLog, setMsgLog] = useState(false);
  const [reqLog, setReqLog] = useState(false);
  const [channelInput, setChannelInput] = useState('');
  const [ytdlpInput, setYtdlpInput] = useState('yt-dlp');

  const [dialog, setDialog] = useState<CookieDialog>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [importMode, setImportMode] = useState<ImportMode>('file');
  const [importFilename, setImportFilename] = useState('');
  const [importContent, setImportContent] = useState('');
  const [pasteHeader, setPasteHeader] = useState('');
  const [updateStatus, setUpdateStatus] = useState<SelfUpdateStatus | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateError, setUpdateError] = useState('');

  const applySettingsToForm = useCallback((s: AppSettings) => {
    setPortInput(String(s.app.port));
    setAutoOpen(s.app.auto_open_browser);
    setMsgLog(s.logging.message_log_to_file);
    setReqLog(s.logging.request_log_to_file);
    setChannelInput(s.app.default_channel_url);
    setYtdlpInput(s.downloader.yt_dlp_command);
  }, []);

  const refreshAll = useCallback(async () => {
    setLoadError('');
    try {
      const [s, c] = await Promise.all([fetchSettings(), fetchCookieStatus()]);
      setSettings(s);
      setCookies(c);
      applySettingsToForm(s);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [applySettingsToForm]);

  const refreshUpdateStatus = useCallback(async () => {
    setUpdateError('');
    try {
      const status = await fetchSelfUpdateStatus();
      setUpdateStatus(status);
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : 'Failed to check updates');
    }
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    void refreshUpdateStatus();
  }, [refreshUpdateStatus]);

  const dirty = useMemo(() => {
    if (!settings) return false;
    return (
      portInput !== String(settings.app.port) ||
      autoOpen !== settings.app.auto_open_browser ||
      msgLog !== settings.logging.message_log_to_file ||
      reqLog !== settings.logging.request_log_to_file ||
      channelInput !== settings.app.default_channel_url ||
      ytdlpInput !== settings.downloader.yt_dlp_command
    );
  }, [settings, portInput, autoOpen, msgLog, reqLog, channelInput, ytdlpInput]);

  const handleSave = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!settings) return;

      const portNum = Number(portInput);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        setSaveError('Port must be an integer between 1 and 65535.');
        return;
      }

      setSaving(true);
      setSaveError('');
      setSaveNotice('');
      try {
        const patch: SettingsPatch = {
          app: { port: portNum, auto_open_browser: autoOpen, default_channel_url: channelInput.trim() },
          logging: {
            message_log_to_file: msgLog,
            request_log_to_file: reqLog,
          },
          downloader: { yt_dlp_command: ytdlpInput.trim() || 'yt-dlp' },
        };
        const result: SettingsUpdateResponse = await updateSettings(patch);
        setSettings(result.settings);
        applySettingsToForm(result.settings);
        setRestartNotice(result.requiresRestart);
        setSaveNotice(
          result.requiresRestart
            ? 'Saved. Restart VOOTED to apply the new port.'
            : 'Settings saved.',
        );
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to save settings');
      } finally {
        setSaving(false);
      }
    },
    [settings, portInput, autoOpen, msgLog, reqLog, channelInput, ytdlpInput, applySettingsToForm],
  );

  const closeDialog = useCallback(() => {
    if (dialogBusy) return;
    setDialog(null);
    setDialogError('');
    setImportMode('file');
    setImportFilename('');
    setImportContent('');
    setPasteHeader('');
  }, [dialogBusy]);

  const handleImportFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      setImportFilename(file.name);
      setImportContent(text);
      setDialogError('');
    },
    [],
  );

  const handleImportSubmit = useCallback(async () => {
    if (importMode === 'paste') {
      const trimmed = pasteHeader.trim();
      if (!trimmed) {
        setDialogError('Paste the Cookie header value first.');
        return;
      }
      setDialogBusy(true);
      setDialogError('');
      try {
        const next = await importPastedCookies(trimmed);
        setCookies(next);
        setDialog(null);
        const count = next.pastedCookieCount ?? 0;
        setSaveNotice(`Imported ${count} pasted cookies.`);
        setSaveError('');
        setPasteHeader('');
      } catch (err) {
        setDialogError(err instanceof Error ? err.message : 'Failed to import pasted cookies');
      } finally {
        setDialogBusy(false);
      }
      return;
    }

    if (!importContent.trim()) {
      setDialogError('Pick a cookie file first.');
      return;
    }
    setDialogBusy(true);
    setDialogError('');
    try {
      const next = await importCookieFile(importFilename || 'youtube.cookies.txt', importContent);
      setCookies(next);
      setDialog(null);
      setImportFilename('');
      setImportContent('');
      setSaveNotice('Cookie file imported.');
      setSaveError('');
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : 'Failed to import cookie file');
    } finally {
      setDialogBusy(false);
    }
  }, [importMode, pasteHeader, importContent, importFilename]);

  const handleClearCookies = useCallback(async () => {
    setDialogBusy(true);
    setDialogError('');
    try {
      const next = await clearCookies();
      setCookies(next);
      setDialog(null);
      setSaveNotice('Cookie auth cleared.');
      setSaveError('');
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : 'Failed to clear cookies');
    } finally {
      setDialogBusy(false);
    }
  }, []);

  const handleApplyUpdate = useCallback(async () => {
    setUpdateBusy(true);
    setUpdateError('');
    setSaveNotice('');
    setSaveError('');
    try {
      const result: ApplySelfUpdateResult = await applySelfUpdate();
      setSaveNotice(result.message || 'Update downloaded. Restarting VOOTED...');
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : 'Failed to apply update');
    } finally {
      setUpdateBusy(false);
    }
  }, []);

  if (loading) {
    return (
      <section className="page-stack">
        <article className="panel">
          <p className="muted-copy">Loading settings…</p>
        </article>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="page-stack">
        <article className="panel">
          <p className="message error">{loadError}</p>
          <button type="button" className="secondary-btn" onClick={() => void refreshAll()}>
            Retry
          </button>
        </article>
      </section>
    );
  }

  return (
    <section className="page-stack">
      <article className="panel feature-hero settings-hero">
        <p className="eyebrow">Settings</p>
        <h2>App preferences</h2>
        <p className="muted-copy">
          Edit runtime config, logging behaviour, and YouTube cookie auth without touching files
          on disk.
        </p>
      </article>

      <form className="panel settings-form" onSubmit={(e) => void handleSave(e)}>
        <div className="settings-section">
          <h3>App</h3>
          <div className="settings-grid">
            <label className="settings-field">
              <span>Default port</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={65535}
                value={portInput}
                onChange={(e) => setPortInput(e.target.value)}
                disabled={saving}
              />
              <small className="settings-hint">
                Where VOOTED will try to listen. Restart required after changing.
              </small>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={autoOpen}
                onChange={(e) => setAutoOpen(e.target.checked)}
                disabled={saving}
              />
              <div>
                <span className="settings-toggle-label">Auto-open browser on launch</span>
                <small className="settings-hint">
                  When enabled, VOOTED opens this dashboard in your default browser at startup.
                </small>
              </div>
            </label>
            <label className="settings-field settings-field-wide">
              <span>Default channel URL</span>
              <input
                type="url"
                value={channelInput}
                placeholder="https://www.youtube.com/@YourChannel/streams"
                onChange={(e) => setChannelInput(e.target.value)}
                disabled={saving}
              />
              <small className="settings-hint">
                Pre-fills the channel URL on the Channel Streams page.
              </small>
            </label>
          </div>
        </div>

        <div className="settings-section">
          <h3>Logging</h3>
          <div className="settings-grid">
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={msgLog}
                onChange={(e) => setMsgLog(e.target.checked)}
                disabled={saving}
              />
              <div>
                <span className="settings-toggle-label">Write message log to file</span>
                <small className="settings-hint">Stored under <code>logs/message_*.log</code>.</small>
              </div>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={reqLog}
                onChange={(e) => setReqLog(e.target.checked)}
                disabled={saving}
              />
              <div>
                <span className="settings-toggle-label">Write HTTP request log to file</span>
                <small className="settings-hint">Stored under <code>logs/requests_*.log</code>.</small>
              </div>
            </label>

          </div>
        </div>

        <div className="settings-section">
          <h3>Downloader</h3>
          <div className="settings-grid">
            <label className="settings-field">
              <span>yt-dlp command</span>
              <input
                type="text"
                value={ytdlpInput}
                onChange={(e) => setYtdlpInput(e.target.value)}
                disabled={saving}
                placeholder="yt-dlp"
                spellCheck={false}
                autoComplete="off"
              />
              <small className="settings-hint">
                Full command or path. Defaults to <code>yt-dlp</code> on PATH.
              </small>
            </label>
          </div>
        </div>

        {restartNotice ? (
          <p className="message warning settings-restart">
            Restart VOOTED to apply the new port.
          </p>
        ) : null}
        {saveError ? <p className="message error">{saveError}</p> : null}
        {saveNotice ? <p className="message success">{saveNotice}</p> : null}

        <div className="settings-actions">
          <button
            type="submit"
            className="primary-btn"
            disabled={saving || !dirty}
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
          <button
            type="button"
            className="secondary-btn"
            disabled={saving || !dirty}
            onClick={() => settings && applySettingsToForm(settings)}
          >
            Discard changes
          </button>
        </div>
      </form>

      <article className="panel cookie-manager-panel">
        <header className="cookie-manager-header">
          <div>
            <p className="eyebrow">YouTube cookies</p>
            <h3>Cookie auth</h3>
          </div>
          <CookieModeBadge mode={cookies?.mode || 'none'} browser={cookies?.browser || ''} />
        </header>

        <p className="muted-copy">
          Some YouTube videos (age-gated, members-only, region-locked) require an authenticated
          session. Export a cookies file from your browser using the guide below, then import it
          here. Auto-pull from the running browser was removed because it&rsquo;s blocked by
          modern browser cookie encryption — see the import guide for the reliable manual flow.
        </p>

        <dl className="cookie-status-grid">
          <div>
            <dt>Mode</dt>
            <dd>{cookies?.mode || 'none'}</dd>
          </div>
          <div>
            <dt>File</dt>
            <dd>
              <code className="cookie-status-path">
                {cookies?.relativePath || '—'}
              </code>
            </dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{cookies?.exists ? formatBytes(cookies.size) : '—'}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatDate(cookies?.updatedAt || null)}</dd>
          </div>
        </dl>

        <div className="cookie-manager-actions">
          <button
            type="button"
            className="primary-btn"
            onClick={() => {
              setDialog('import');
              setDialogError('');
              setImportFilename('');
              setImportContent('');
            }}
          >
            Import cookie file
          </button>
          <button
            type="button"
            className="voote-cancel-btn"
            disabled={cookies?.mode === 'none'}
            onClick={() => {
              setDialog('clear');
              setDialogError('');
            }}
          >
            Clear cookies
          </button>
        </div>
      </article>

      <article className="panel cookie-manager-panel">
        <header className="cookie-manager-header">
          <div>
            <p className="eyebrow">App update</p>
            <h3>Self-update</h3>
          </div>
        </header>

        <p className="muted-copy">
          Check GitHub releases and update VOOTED in-place. When an update is applied,
          VOOTED downloads the new binary, exits, replaces the old executable, and
          launches the new version.
        </p>

        <dl className="cookie-status-grid">
          <div>
            <dt>Current</dt>
            <dd>{updateStatus?.currentVersion || '—'}</dd>
          </div>
          <div>
            <dt>Latest</dt>
            <dd>{updateStatus?.latestTag || '—'}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              {!updateStatus
                ? 'Unknown'
                : updateStatus.updateAvailable
                  ? 'Update available'
                  : 'Up to date'}
            </dd>
          </div>
          <div>
            <dt>Asset</dt>
            <dd><code className="cookie-status-path">{updateStatus?.assetName || '—'}</code></dd>
          </div>
        </dl>

        {updateError ? <p className="message error">{updateError}</p> : null}

        <div className="cookie-manager-actions">
          <button
            type="button"
            className="secondary-btn"
            disabled={updateBusy}
            onClick={() => void refreshUpdateStatus()}
          >
            {updateBusy ? 'Working…' : 'Check for updates'}
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={
              updateBusy
              || !updateStatus
              || !updateStatus.platformSupported
              || !updateStatus.updateAvailable
            }
            onClick={() => void handleApplyUpdate()}
          >
            {updateBusy ? 'Applying update…' : 'Download and restart'}
          </button>
        </div>
      </article>

      <Modal
        open={dialog === 'import'}
        onClose={closeDialog}
        busy={dialogBusy}
        title="Import cookies"
        description="Two ways to get YouTube cookies into VOOTED. Pick whichever fits — the file path is more complete; the DevTools paste path needs no extension."
        actions={
          <>
            <button
              type="button"
              className="secondary-btn"
              onClick={closeDialog}
              disabled={dialogBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={() => void handleImportSubmit()}
              disabled={
                dialogBusy ||
                (importMode === 'file' ? !importContent.trim() : !pasteHeader.trim())
              }
            >
              {dialogBusy ? 'Importing…' : 'Import'}
            </button>
          </>
        }
      >
        <CookieExportGuide />

        <div
          className="cookie-import-tabs"
          role="tablist"
          aria-label="Cookie import method"
        >
          <button
            type="button"
            role="tab"
            aria-selected={importMode === 'file'}
            data-active={importMode === 'file'}
            onClick={() => {
              setImportMode('file');
              setDialogError('');
            }}
            disabled={dialogBusy}
          >
            From file (extension export)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={importMode === 'paste'}
            data-active={importMode === 'paste'}
            onClick={() => {
              setImportMode('paste');
              setDialogError('');
            }}
            disabled={dialogBusy}
          >
            Paste from DevTools
          </button>
        </div>

        {importMode === 'file' ? (
          <label className="settings-field cookie-import-field">
            <span>Cookie file</span>
            <input
              type="file"
              accept=".txt,text/plain"
              onChange={(e) => void handleImportFile(e)}
              disabled={dialogBusy}
            />
            {importFilename ? (
              <small className="settings-hint">
                Picked: <code>{importFilename}</code> ({formatBytes(importContent.length)})
              </small>
            ) : (
              <small className="settings-hint">
                File is read in your browser; only its text is sent to VOOTED.
              </small>
            )}
          </label>
        ) : (
          <label className="settings-field cookie-import-field">
            <span>Cookie header from DevTools</span>
            <textarea
              className="cookie-paste-textarea"
              value={pasteHeader}
              onChange={(e) => setPasteHeader(e.target.value)}
              disabled={dialogBusy}
              rows={5}
              placeholder="SAPISID=...; __Secure-3PAPISID=...; LOGIN_INFO=...; HSID=...; SSID=..."
              spellCheck={false}
              autoComplete="off"
            />
            <small className="settings-hint">
              <strong>How to grab it:</strong> open <code>youtube.com</code> while signed in,
              press <code>F12</code> → <strong>Network</strong> tab → click any request to{' '}
              <code>youtube.com</code> → <strong>Headers</strong> → scroll to{' '}
              <strong>Request Headers</strong> → right-click the <code>Cookie:</code> row and
              copy the value. Paste it above.
            </small>
            <small className="settings-hint">
              Note: the paste flow loses each cookie&rsquo;s domain/expiry attributes. VOOTED
              fills in sensible defaults (<code>.youtube.com</code> + <code>.google.com</code>,
              path <code>/</code>, secure, 1-year expiry). Works for most downloads; switch to
              the file path if a download still fails with auth errors.
            </small>
          </label>
        )}
        {dialogError ? <p className="message error">{dialogError}</p> : null}
      </Modal>

      <Modal
        open={dialog === 'clear'}
        onClose={closeDialog}
        busy={dialogBusy}
        title="Clear cookie auth?"
        description="VOOTED will delete the active cookie file and stop sending cookies with downloads."
        actions={
          <>
            <button
              type="button"
              className="secondary-btn"
              onClick={closeDialog}
              disabled={dialogBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="voote-cancel-btn"
              onClick={() => void handleClearCookies()}
              disabled={dialogBusy}
            >
              {dialogBusy ? 'Clearing…' : 'Yes, clear'}
            </button>
          </>
        }
      >
        <p>
          Current source: <strong>{cookies?.mode || 'none'}</strong>
          {cookies?.relativePath ? (
            <>
              {' '}— <code>{cookies.relativePath}</code>
            </>
          ) : null}
        </p>
        {dialogError ? <p className="message error">{dialogError}</p> : null}
      </Modal>
    </section>
  );
}

function CookieModeBadge({ mode, browser }: { mode: string; browser: string }) {
  const label =
    mode === 'browser'
      ? `Browser · ${browser || '?'}`
      : mode === 'file'
        ? 'Cookie file'
        : 'Off';
  return <span className={`cookie-mode-badge cookie-mode-${mode}`}>{label}</span>;
}

// Detailed step-by-step export guide. Lives inside the import modal so users
// can read it inline while they work, instead of clicking around external docs.
function CookieExportGuide() {
  return (
    <details className="cookie-export-guide" open>
      <summary>Step-by-step: export YouTube cookies from your browser</summary>

      <ol className="cookie-export-steps">
        <li>
          <h4>Install a cookies-export browser extension</h4>
          <p>
            VOOTED needs a Netscape-format <code>cookies.txt</code> file. Browsers don&rsquo;t
            export this on their own, so install one of these free extensions in the same browser
            you&rsquo;re signed into YouTube with:
          </p>
          <ul className="cookie-export-extensions">
            <li>
              <strong>Chrome / Brave / Opera / Vivaldi / Chromium:</strong>{' '}
              <a
                href="https://chromewebstore.google.com/search/Get%20cookies.txt%20LOCALLY"
                target="_blank"
                rel="noreferrer noopener"
              >
                Get cookies.txt LOCALLY (Chrome Web Store)
              </a>
              . Must be the <em>LOCALLY</em> version — older &ldquo;cookies.txt&rdquo;
              extensions were removed from the store.
            </li>
            <li>
              <strong>Microsoft Edge:</strong>{' '}
              <a
                href="https://microsoftedge.microsoft.com/addons/search/Get%20cookies.txt%20LOCALLY"
                target="_blank"
                rel="noreferrer noopener"
              >
                Get cookies.txt LOCALLY (Edge Add-ons)
              </a>
              . Same extension; Edge has its own store.
            </li>
            <li>
              <strong>Firefox:</strong>{' '}
              <a
                href="https://addons.mozilla.org/firefox/search/?q=cookies.txt"
                target="_blank"
                rel="noreferrer noopener"
              >
                cookies.txt (Firefox Add-ons)
              </a>
              . The popular one is by Lennon Hill — first result for the search.
            </li>
          </ul>
          <p className="settings-hint">
            Tip: pin the extension to your toolbar so the next steps are one click each. Can&rsquo;t
            install an extension? Use the <strong>Paste from DevTools</strong> tab below the guide
            — same end result, no install needed.
          </p>
        </li>

        <li>
          <h4>Make sure you&rsquo;re signed in to YouTube</h4>
          <p>
            Open <code>https://www.youtube.com/</code> in a normal tab and confirm your account
            avatar shows in the top-right. The export only captures the session that&rsquo;s
            active right now.
          </p>
          <p className="settings-hint">
            For age-gated or members-only content, also open one of those videos once and confirm
            it plays — that ensures the right consent cookies are set.
          </p>
        </li>

        <li>
          <h4>Export the cookies for youtube.com</h4>
          <p>
            With <code>youtube.com</code> still in the active tab, click the cookies-export
            extension icon. A small popup appears.
          </p>
          <ul>
            <li>
              <strong>Get cookies.txt LOCALLY:</strong> click <em>Export As</em> →{' '}
              <em>Netscape</em>. It downloads <code>youtube.com_cookies.txt</code> (or similar)
              to your <code>Downloads</code> folder.
            </li>
            <li>
              <strong>cookies.txt (Firefox):</strong> click <em>Current Site</em> →{' '}
              <em>Export</em>. Same result.
            </li>
          </ul>
          <p className="settings-hint">
            The file is a plain-text list of cookies — open it in Notepad if you want to see
            what&rsquo;s inside. Don&rsquo;t share it; it&rsquo;s as sensitive as your YouTube
            password.
          </p>
        </li>

        <li>
          <h4>Import it into VOOTED</h4>
          <p>
            Use the <em>Cookie file</em> picker below to pick the file you just downloaded.
            VOOTED reads it in your browser and posts the contents to{' '}
            <code>localhost:8111</code> — nothing leaves your machine. The file is saved under{' '}
            <code>data/cookies/</code> next to the EXE and used for every download from now on.
          </p>
        </li>

        <li>
          <h4>Refresh when downloads start failing again</h4>
          <p>
            YouTube cookies expire after a few weeks (sooner if you sign out anywhere). When a
            download fails with an auth error, repeat steps 2–4 with a fresh export. You can use
            the same filename — VOOTED will overwrite the previous file.
          </p>
        </li>
      </ol>
    </details>
  );
}
