---
name: shyvo-widget
version: "0.1.0"
tags: ["shyvo", "feedback", "widget", "integration", "setup"]
description: >-
  Add the Shyvo feedback widget to the user's web app so end users can send
  bugs, ideas and questions straight into Shyvo. Detects the framework
  (Next.js, TanStack Start, React Router, Vite, Astro, SvelteKit, Nuxt, Vue,
  plain HTML), writes the component and public env values, mounts it, and
  tests it.

  Use it when the user says "add the Shyvo widget", "add a feedback button",
  "intègre le widget Shyvo", "let my users send feedback".
---

# Shyvo feedback widget

The widget is a small Feedback button. Messages go to the Shyvo project linked
to this repository, where they can be triaged into issues.

Run `shyvo status` first. If there is no token or no linked project, follow
the setup check of the `shyvo` skill. The token needs the `widget:setup` scope.

## 1. Find the origins

The widget accepts feedback only from allowed origins. Collect:

- the production URL: look in the repo (site config, `.env*`, `vercel.json`,
  `wrangler.toml`, README, package.json `homepage`). If you cannot find it,
  ask the user once.
- the local dev URL: `http://localhost:<port>` from the dev script.

## 2. Install

```bash
shyvo widget install --origin https://app.example.com --origin http://localhost:3000
```

It enables the project's collector in Shyvo, allows the origins, detects the
framework and:

- **React frameworks**: writes `components/shyvo-feedback.tsx` (or `.jsx`)
  exporting `<ShyvoFeedbackWidget />`, and appends two public env values
  (`<PREFIX>SHYVO_PROJECT_KEY`, `<PREFIX>SHYVO_ENDPOINT`) to the framework's
  env file. It uses the npm package `@shyvo/feedback` when it is already a
  dependency (`--mode npm` to force it), otherwise the hosted script
  (`--mode script`).
- **Other frameworks**: prints a `<script>` tag to paste.

Flags: `--dry-run` (show what it would do), `--no-env` (print the env values
instead of writing them), `--json`.

It never runs `npm install` and never edits the layout: the next steps are
yours, so the change stays in a reviewable diff.

## 3. Mount it

Follow the `nextSteps` it printed. Mount the component **once**, at the root:

| Framework      | Where                                                          |
| -------------- | -------------------------------------------------------------- |
| Next.js        | `app/layout.tsx` (or `pages/_app.tsx`), just before `</body>`  |
| TanStack Start | `src/routes/__root.tsx`, inside `<body>` next to `<Scripts />` |
| React Router   | `app/root.tsx`, inside `<body>` next to `<Scripts />`          |
| Vite + React   | `src/App.tsx` (or `main.tsx`), top level                       |
| Astro          | base layout, script tag before `</body>`                       |
| SvelteKit      | `src/app.html`, script tag before `</body>`                    |
| Nuxt / Vue     | `app.head.script` / `index.html`                               |

With `--mode npm`, add the package with the repo's package manager
(`pnpm add @shyvo/feedback`, `npm i @shyvo/feedback`, `bun add ...`).

## 4. Test

1. Run the app's typecheck and lint.
2. Start the dev server the way the repo expects, open the app, check that the
   Feedback button appears, and send a test message.
3. `shyvo feedback list --state new` shows it. Then
   `shyvo feedback dismiss <id>` to keep the inbox clean.

## 5. Production

The env values are public (the key only accepts feedback for this project,
from allowed origins), but production needs them too. Tell the user which two
variables to add on their host (Vercel, Cloudflare, Netlify...). Do not change
production env or deploy without the user's explicit approval.

## Rules

- Never put the agent token (`shy_...`) in the app, an env file or the widget.
  Only the public project key goes there.
- One widget per app, mounted once.
- Never merge, deploy or resolve anything as part of this setup: open the
  change for the user's review like any other.
- Feedback refused with an origin error: allow the origin with
  `shyvo widget setup --origin <url>`.
- End with: files changed, env variable names added, where it is mounted, the
  test result, and what the user must add in production.
