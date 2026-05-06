VOOTED v1.0.4

Highlights:
- Native folder picker on the Setup card — Browse… button next to VOD save location opens the OS-native folder dialog (Windows / macOS / Linux with zenity or kdialog).
- Folder-safety warning on Setup — detects when the app folder isn't dedicated (Downloads, Desktop, etc.) and lists the unrelated files it finds, before you commit to placing VOOTED there.
- ChannelStreams: items load unselected by default; Select visible / Clear / count toolbar moved directly above the list; "Filter streams" relabeled to "Search streams"; sort fallback uses uploadDate (YYYYMMDD) when timestamps are missing so the sort toggle now actually reorders.
- HomePage Queue download is now gated behind Preview details — picking a quality before queueing is no longer optional, and editing the URL clears the preview to prevent submitting against stale info.
- Honest stopped-tab overlay — removed the misleading "Try closing this tab again" button (the browser blocks scripted close the same way every time); shows clear keyboard shortcut guidance instead.
- Hero subtitle corrected — was duplicating the "Video on Ote demand" tagline, now describes what the app actually does.
- Frontend static config no longer carries default_channel_url (channel default is backend/runtime-owned only, so shipped frontend can't silently override user settings).
- Hero subtitle, Settings, and Release docs polish.
