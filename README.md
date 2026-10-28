# Qiita Atlas

Interactive map of 7,236 full-text human microbiome manuscripts (2010–2026), arranged by textual similarity and colored by the MONDO disease hierarchy, body site, disease class, or topic cluster.

- `index.html` — page shell + data loader
- `app.js` — rendering and interaction (vanilla JS, canvas)
- `data.json` — paper coordinates and labels (MONDO-mapped, with confidence tiers)

Static site — no build step. Deployed on Vercel.
