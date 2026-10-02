# Brain Arena · 脑力竞技场

A mobile-first PWA with 20 challenging mini games for adults. Runs fully offline, bilingual (中文 / English),
dark & light themes, synthesized sound effects and haptic feedback.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # typecheck + unit tests + production build
npm run smoke      # open every game in a mobile-emulated Chromium, check for errors, screenshots in .smoke/
```

See `docs/GAME_DEV_GUIDE.md` for how a game module is structured.

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`, which builds with `BASE_PATH=/<repo>/` and publishes to
GitHub Pages. Enable Pages once in the repository settings (Settings → Pages → Source: GitHub Actions).
