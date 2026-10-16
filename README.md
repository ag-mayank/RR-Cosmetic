# Product Catalog + WhatsApp Sharing + Visitor Analytics

A small Node.js/Express website with a SQLite database. Admins can add, edit, and delete products. Every product has its own public page with Open Graph metadata for WhatsApp image previews. The admin dashboard includes page views, approximate unique browser visitors, today's counts, and popular pages/products.

## Requirements
- Node.js 20 or newer (https://nodejs.org/)
- npm (included with Node.js)

## Run locally
1. Extract this project folder.
2. Open a terminal inside `product-catalog-website`.
3. Install packages:
   ```bash
   npm install
   ```
4. Copy `.env.example` to `.env`.
   - Windows PowerShell: `Copy-Item .env.example .env`
   - macOS/Linux: `cp .env.example .env`
5. Edit `.env`. Change `ADMIN_PASSWORD` and `COOKIE_SECRET` to long random values.
6. Start the website:
   ```bash
   npm start
   ```
7. Open http://localhost:3000 for the catalog.
8. Open http://localhost:3000/admin to log in and manage products. The browser asks for the admin username and password from `.env`.

## WhatsApp image previews
- For local testing, WhatsApp cannot fetch `localhost`. Deploy the site to a public HTTPS URL first.
- Set `BASE_URL=https://your-real-domain.example` in the deployment environment (no trailing slash).
- Each `/product/<slug>` page renders `og:title`, `og:description`, `og:image`, and `og:url` in the initial HTML.
- Product images must be publicly accessible. WhatsApp may cache old previews, so changes may take time to appear.
- Test with a real public product URL. Share the link in a WhatsApp chat and check the preview before sending.

## Visitor analytics
The dashboard shows total page views, approximate unique browser visitors, today's views/visitors, most visited paths, and most viewed products. A random anonymous cookie is used to estimate unique browsers; raw IP addresses are not stored. Known preview bots/crawlers are excluded, but bot detection is not perfect. A person using multiple browsers/devices may count more than once, and clearing cookies can make the same person count as new.

## Important deployment notes
- This starter stores the database in `catalog.sqlite` and images in `public/uploads`. Deploy only on a host with persistent storage, or move the database and images to managed persistent services. Some free hosting services delete local files on restart/redeploy.
- Do not use default admin credentials in public. Configure `ADMIN_USER`, a strong `ADMIN_PASSWORD`, `COOKIE_SECRET`, and the correct `BASE_URL`.
- Use HTTPS for a public deployment. Add backups for the SQLite database and uploaded images.
- For larger stores, move images to a service such as Cloudinary or object storage and use a managed database.
- This starter is for a simple catalog; it does not include checkout, payment processing, inventory management, or customer accounts.
# RR-Cosmetic
