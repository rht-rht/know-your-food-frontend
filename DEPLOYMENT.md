# Production deployment and going public

## Architecture

- **Frontend** (this repo): Next.js app. Build with `npm run build`, run with `npm run start`. Serves the UI and proxies `/api/*` to the backend via `BACKEND_URL`.
- **Backend**: FastAPI (see [know-your-food](../know-your-food) repo). Deploy separately (e.g. Render); expose a public URL and set that as `BACKEND_URL` in the frontend.

## Frontend environment variables

Set these in your host (Vercel, Render, or your server). Do not rely on `.env.local` in production.

See [.env.example](.env.example) for a template. Summary:

| Variable | Required | Description |
|----------|----------|-------------|
| `BACKEND_URL` | Yes | Full URL of the backend API (e.g. `https://know-your-food-api.onrender.com`), no trailing slash. |
| `NEXT_PUBLIC_APP_URL` | Yes | Public URL of this frontend (e.g. `https://yourapp.vercel.app` or your custom domain). Used for Stripe redirects. |
| `NEXT_PUBLIC_FIREBASE_*` | Yes | All six Firebase client config vars (API key, auth domain, project ID, storage bucket, messaging sender ID, app ID). |
| `STRIPE_SECRET_KEY` | Yes | Stripe secret key for checkout. |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe webhook signing secret; endpoint `https://<NEXT_PUBLIC_APP_URL>/api/credits/webhook`. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Yes | Full JSON string of Firebase service account key (for webhook to add credits). |
| `NEXT_PUBLIC_ADSENSE_ID` / `NEXT_PUBLIC_AD_SLOT_LOADING` | No | Banner ads. |
| `NEXT_PUBLIC_AD_MANAGER_REWARDED_SLOT` | No | Rewarded ads when approved. |

## Backend environment variables

- **Required**: `OPENAI_API_KEY`
- **Optional**: `YTDL_COOKIES_FILE` — path to a Netscape-format cookie file (e.g. exported from a browser). Helps both **YouTube** and **Instagram** URL analysis when the site blocks or rate-limits server requests. Step-by-step: backend [COOKIES.md](../know-your-food/COOKIES.md); env key in [render.yaml](../know-your-food/render.yaml).

## Checklist before going public

- [ ] Backend is deployed and `GET <BACKEND_URL>/health` returns 200.
- [ ] Frontend is built with `npm run build` and run with `npm run start` (or your host’s equivalent).
- [ ] All production env vars above are set on the **frontend** host (no reliance on `.env.local` in prod).
- [ ] `BACKEND_URL` points to the live backend URL; run an analysis from the deployed frontend to confirm.
- [ ] In Firebase Console, add your production frontend URL to **Authorized domains**.
- [ ] In Stripe Dashboard, add webhook endpoint `https://<NEXT_PUBLIC_APP_URL>/api/credits/webhook` and set `STRIPE_WEBHOOK_SECRET`; test buy-credits once.
- [ ] (Optional) Custom domain and HTTPS configured; set `NEXT_PUBLIC_APP_URL` to that domain.

## Deploying the frontend

- **Vercel**: Connect this repo; set env vars in the project settings. [vercel.json](vercel.json) configures long timeouts for analysis API routes.
- **Render**: Use [render.yaml](render.yaml) in this repo; set env vars in the Render dashboard (Environment).
- **Own server**: Run `npm install && npm run build && npm run start`; set env vars in the process (e.g. systemd, PM2, or shell export). Use a reverse proxy (Nginx/Caddy) with TLS for HTTPS.
