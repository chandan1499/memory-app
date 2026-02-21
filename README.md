# Memory Assistant — Netlify Deployment

## Files
- index.html       Main app (React via CDN, no build step needed)
- manifest.json    PWA manifest for "Add to Home Screen" on iOS
- netlify.toml     SPA redirect config for Netlify
- _redirects       Fallback redirect rule
- netlify/functions/groq-chat.js  Netlify Function proxy for Groq (keeps API key server-side)
- README.md        This file

## Deploy Steps
### Option A (recommended): Deploy with Netlify + Git
1. Push this folder to a Git repo (GitHub/GitLab/Bitbucket)
2. In Netlify, click "Add new site" → "Import an existing project"
3. Deploy (no build command needed)
4. In Netlify site settings → "Environment variables", add:
   - `GROQ_API_KEY` = your Groq API key

### Option B: Deploy with Netlify CLI
1. Install Netlify CLI (one time):
   - `npm i -g netlify-cli`
2. From this folder:
   - `netlify login`
   - `netlify init` (or `netlify link`)
   - `netlify env:set GROQ_API_KEY "your_key_here"`
   - `netlify deploy --prod`

Note: the Netlify drag-and-drop deploy is static-only and will not run Functions, so it can't securely hide API keys.

## iOS Install
1. Open your Netlify URL in Safari on iPhone
2. Tap the Share button (box with arrow)
3. Tap "Add to Home Screen"
4. Name it "Memory" and tap Add

## Reminders
- Open the app → Reminders tab → tap "Enable Notifications"
- Notifications fire at 12:00 PM and 9:00 PM daily
- For iOS: keep the PWA open in background OR use Shortcuts app automation
  to open the app at those times (iOS restricts background notifications for web apps)

## Tech Stack
- React 18 (CDN, no npm needed)
- Babel Standalone (JSX in browser)
- Groq Chat Completions API (via Netlify Function proxy)
- localStorage for persistence
- Web Notifications API for reminders
