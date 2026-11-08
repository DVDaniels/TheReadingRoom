# The Reading Room mail service

Gives each reader private email addresses like `quiet-river-4821@readingroomapp.com`. Mail sent to one
(newsletters, or anything forwarded from your own inbox) shows up in the app as stories in that address's feed.

It runs on Cloudflare (free plan): **Email Routing** receives the mail and hands it to this **Worker**,
which keeps it in a **D1** database and serves each address's feed at `mail.readingroomapp.com/feeds/<secret>.xml`.

- `POST /new` with a title makes an address and returns `{ email, feed }` (at most 10 a day from one place).
- `GET /feeds/<secret>.xml` is the feed. Knowing an address doesn't reveal its feed.
- `DELETE /feeds/<secret>` deletes the address and everything sent to it (the app's Remove button).
- Mail to an address that doesn't exist bounces. Emails over 5 MB bounce.
- Each address keeps its last 100 emails, none older than a year (tidied once a day).

## One-time setup (David does the sign-ins)

1. **Put readingroomapp.com on Cloudflare.** Make a free account at dash.cloudflare.com, choose *Add a domain*,
   enter readingroomapp.com, pick the Free plan. Cloudflare copies the current DNS records; check that the
   GitHub Pages ones (the four `A` records 185.199.108–111.153, and any `www` CNAME) came across.
   Then, where the domain is registered, change its nameservers to the two Cloudflare gives you.
   The site keeps working throughout. Wait for Cloudflare to say the domain is *Active*.
2. **Turn on Email Routing.** In the domain: *Email* › *Email Routing* › *Get started*, and let it add its
   MX and SPF records. (If you want a real address too, like hello@, add it as a custom address that
   forwards to your Gmail. Custom addresses win over the catch-all.)
3. **Make an API token** for GitHub: *My Profile* › *API Tokens* › *Create Token* › *Edit Cloudflare Workers*
   template, then add the permission *Account › D1 › Edit*. Limit it to your account and to readingroomapp.com.
4. **Add two secrets in GitHub** (repo › Settings › Secrets and variables › Actions):
   `CLOUDFLARE_API_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID` (on the right side of the domain's Overview page).
5. **Deploy:** Actions › *Mail service* › *Run workflow*. It makes the database, deploys the Worker and
   sets up mail.readingroomapp.com.
6. **Send mail to it:** *Email* › *Email Routing* › *Routing rules* › *Catch-all address* › Edit ›
   Action *Send to a Worker* › `reading-room-mail` › Save, and turn the catch-all on.
7. **Try it:** in the app, make an address under *Read newsletters here*, send it an email from Gmail,
   refresh. Until steps 1–6 are done, the app quietly falls back to Kill the Newsletter.

## Changing it

Edit `src/worker.js`, run `npm test` here, then run the *Mail service* workflow again.
