# Audiobooks Manager

Vite + React frontend and a Cloudflare Worker API. D1 holds audiobook records; chapter audio files go to R2 after you confirm names. Files over 99 MB are uploaded in chunks and joined in R2.

```bash
npm install
npm run dev
```

- Web: http://localhost:27183
- Production API: https://audiobooks-manager-api.juan-martinzzz.workers.dev/api/health

The sample HTML at the repo root is reference-only.

Read-only reference clones live under `repos/` (gitignored). Manifest: `reference-repos.json`. Update with `npm run repos:update`. Do not edit or install inside those clones.
