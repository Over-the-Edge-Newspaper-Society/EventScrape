# Admin Web Interface

React + TypeScript + Vite admin interface for EventScrape.

## Scripts

- `pnpm dev` starts the Vite dev server on port `3000`.
- `pnpm build` creates a production build.
- `pnpm lint` runs ESLint.
- `pnpm typecheck` runs TypeScript checks.

## Environment

- `VITE_API_URL` can be set to override the API base URL.
- If omitted, the app defaults to `${window.location.origin}/api`.
