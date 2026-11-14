# 05 · Deploy

The game is a static site — `index.html`, `styles.css`, `favicon.svg` and `src/`. Any static
host works.

## Local

```bash
npm start            # http://127.0.0.1:5173  (PORT=8080 npm start to change)
```

ES modules do not load from `file://`, so open the game through the server, not by
double-clicking `index.html`.

## GitHub Pages (automatic)

`.github/workflows/pages.yml` runs on every push to `main`: tests → copy static files to
`_site/` → publish.

One-time setup: repository **Settings → Pages → Source: GitHub Actions**. The URL will be
`https://<user>.github.io/<repo>/`. All paths in the game are relative, so it works from a
sub-path.

## Other hosts

Netlify, Vercel, Cloudflare Pages: no build command, publish directory = repository root
(or upload the same four items). Nginx/Apache: serve the folder; make sure `.js` is sent as
`text/javascript` (default on all modern servers).

## CI

`.github/workflows/ci.yml` runs `node --check` on every source file and `npm test` on
Node 20, 22 and 24 for every push and pull request.
