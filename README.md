# VoxPod AI

VoxPod AI omvandlar text, bilder och PDF:er till uppläst ljud med Gemini.

## Run Locally

Prerequisites: Node.js 20+

1. Install dependencies:
   `npm install`
2. Create `.env.local` from `.env.example`
3. Add your Gemini API key to `.env.local`
4. Start the app:
   `npm run dev`

## GitHub + Cloudflare Pages

Gemini requests now go through `/api/gemini`, so the browser no longer needs direct access to the API key.

This project is prepared for Cloudflare Pages with Pages Functions:

1. Push the project to GitHub
2. In Cloudflare Pages, import the GitHub repository
3. Use the React (Vite) preset or set:
   `Build command: npm run build`
   `Build output directory: dist`
4. Add `GEMINI_API_KEY` in Cloudflare Pages environment variables
5. Deploy

Relevant files:

- Frontend API client: `services/geminiService.ts`
- Shared server handler: `server/geminiApi.ts`
- Cloudflare Pages Function: `functions/api/gemini.ts`
- Local dev middleware: `vite.config.ts`
- Pages routing control: `public/_routes.json`

## Supabase Cloud Sync

Supabase auth is wired into the frontend. For private per-user cloud sync across devices you must also:

1. Keep the `Audio` bucket private
2. Run `supabase/voxpod_cloud_sync.sql` in the Supabase SQL Editor
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Cloudflare Pages

What the SQL file sets up:

- `public.podcast_episodes` for per-user episode metadata
- `public.podcast_generation_usage` for server-recorded Gemini TTS token usage and calculated paid-tier USD cost per podcast chunk
- Row Level Security so each authenticated user only sees their own rows
- Storage policies so each user can only access objects inside `Audio/<their-user-id>/...`

Rerun `supabase/voxpod_cloud_sync.sql` after deploying usage tracking so new podcast generations can be logged. The app displays exact Gemini-reported TTS token counts; the USD badge is calculated using the published standard paid-tier price for `gemini-2.5-flash-preview-tts`. Free-tier requests remain free of charge.

## Public Trial Protection

The signed-out login page can offer one short audio trial of approximately two minutes. The API only permits this public generation after Cloudflare Turnstile validation and a server-side daily rate limit:

- one successful claim per browser device per 24 hours
- up to five claims per IP address per 24 hours
- no anonymous access to translation, imports, summaries, or the saved library

To activate it:

1. Rerun `supabase/voxpod_cloud_sync.sql` in Supabase SQL Editor. It creates `public.podcast_demo_rate_limits` and the restricted `claim_public_demo_generation` RPC.
2. Create a Cloudflare Turnstile widget for the production hostname.
3. Add the public site key as the Cloudflare Pages runtime variable `TURNSTILE_SITE_KEY`.
4. Add the private key as the Cloudflare Pages runtime secret `TURNSTILE_SECRET_KEY`.
5. Trigger a new deployment after both keys are present.

Signed-in podcast creation now opens a confirmation dialog with estimated duration, requests, tokens, and paid-tier cost before an API call is made. Text estimated beyond one hour is split into multiple episodes of at most approximately one hour each. Actual Gemini-reported cost remains the value written after generation.

## Secrets

- `.env.local` is for local development only and must not be committed
- `.env.example` is only a template for GitHub
- In production, set `GEMINI_API_KEY` in Cloudflare Pages instead of storing it in the repo
- Store `TURNSTILE_SECRET_KEY` only as a Cloudflare Pages secret; never expose it as a `VITE_` variable
