# Troved frontend

The Vite/React frontend for Troved. Install dependencies with `npm ci`, then run `npm run dev`. The optional private AI server lives in the project-root `server/` directory; see the [project setup and deployment guide](../README.md).

The app runs without an AI server. Local Markdown and CSV parsing stays in the browser. If configured, cloud AI providers are called through the same-origin Troved server; API keys are never sent to the frontend. Only Markdown that a user explicitly chooses to improve is sent to the selected model.

Run `npm run build` for a production build.
