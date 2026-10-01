# Aguantame

Aguantame is a dependency-free focus timer web app for sustained work sessions. It runs as a static site and stores timer settings and history locally in the browser.

## Features

- Multiple focus timers with pause, resume, reset, and configurable durations.
- Stopwatch mode and compact popup / always-on-display timer windows.
- Generated background sounds and white-noise controls using the Web Audio API.
- Light and dark themes with reduced-motion-friendly UI behavior.
- Local persistence through `localStorage`.
- Offline caching through the included service worker.

## Run locally

Serve the project directory with any static HTTP server. For example:

```sh
python3 -m http.server 8080
```

Open <http://localhost:8080> in a browser. Audio requires a user interaction before playback.

## Deploy

Upload `index.html`, `styles.css`, `app.js`, `logo_aguantame.png`, and `sw.js` to a static host over HTTPS. Registering the service worker requires a secure context (HTTPS, or localhost during development).

## Data and privacy

Timer state, preferences, and local history remain in this browser profile. The project has no account system, server database, or synchronization service. Clearing site data removes the local state.

## Project structure

| Path | Purpose |
| --- | --- |
| `index.html` | Application shell and accessible controls |
| `app.js` | Timer state, rendering, persistence, audio, and popup behavior |
| `styles.css` | Responsive visual design |
| `sw.js` | Static-asset cache and offline fallback |
| `logo_aguantame.png` | Brand asset |
