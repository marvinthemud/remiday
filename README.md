# REMIDAY

Remi's weekly schedule, with a lead parent for every event. A static web app (one HTML page plus a small adapter) backed by Supabase, hosted free on GitHub Pages and added to the iPhone home screen.

## Files

- `index.html`: the app
- `backend.js`: connects the app to Supabase (data, live sync, photo storage, passcode sign-in)
- `config.js`: your Supabase project URL, anon key and the shared login email
- `schema.sql`: creates the database tables and security rules
- `media.enc`: built-in images (profile photos, Remi heads), encrypted; the key is stored in the database
- `manifest.webmanifest`, `apple-touch-icon.png`, `icon-*.png`, `mascot.png`: home-screen app icon and name

Family photos and the schedule are not in this repo. They live in Supabase and are only readable after signing in with the passcode.

## Setup

1. Supabase (free): create a project, then in SQL Editor run `schema.sql`, then run the private `seed-private.sql` (kept outside this repo).
2. Supabase > Authentication > Users > Add user: email `family@remiday.app` (or whatever is in `config.js`), password = your family passcode, tick "Auto confirm user".
3. Supabase > Authentication > Sign In / Providers: turn off "Allow new users to sign up".
4. Supabase > Project Settings > API: copy the Project URL and the `anon` public key into `config.js`.
5. GitHub: push this folder to a repo, then Settings > Pages > Deploy from branch `main`, folder `/ (root)`.
6. On each iPhone: open the Pages URL in Safari, enter the passcode, then Share > Add to Home Screen.
