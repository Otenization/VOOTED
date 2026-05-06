VOOTED v1.0.3

Highlights:
- Added portable ffmpeg provisioning on Windows for setup/startup fallback.
- Wired ffmpeg location into yt-dlp execution via --ffmpeg-location when available.
- Exposed ffmpeg availability in setup status and updated setup progress messaging.
- Updated docs for runtime dependencies and platform behavior.
- Kept graceful fallback behavior when ffmpeg provisioning fails.
