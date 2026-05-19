# EasyUtils JSON

EasyUtils JSON is a pure frontend JSON web tool built with Vite, React and TypeScript. It runs common JSON operations directly in the browser, which makes it simple to deploy on Vercel and safer for private API payloads.

## Features

- Format, validate and minify JSON
- Sort object keys alphabetically
- Convert sample JSON to JSON Schema
- Generate demo JSON from common JSON Schema fields
- Escape and unescape JSON strings
- Base64 encode and decode text
- Decode JWT header and payload locally
- Show JSON parse error line and column when available
- Paste, clear and swap editor contents
- Copy or download transformed output
- Inspect basic JSON statistics
- SEO metadata, Open Graph image, favicon, web app manifest, `robots.txt`, `sitemap.xml` and structured data included

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The production output is generated in `dist/`.

## Deploy to Vercel

Import this repository in Vercel and use the default Vite settings:

- Build command: `npm run build`
- Output directory: `dist`

Before production launch, update the canonical URL in `index.html`, `public/robots.txt` and `public/sitemap.xml` to match your final domain.
