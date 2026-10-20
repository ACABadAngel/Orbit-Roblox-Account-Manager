# Publishing Orbit and connecting its license service

The Windows installer is standalone. Customers do not need Node, npm, Git, or
these server tools. Install `Orbit-Setup-0.3.0-x64.exe` once to bootstrap future
in-app updates. The portable executable and source checkout use manual updates.

## Release updates

The build workflow tests on Linux and Windows, packages NSIS and portable builds,
and uploads the installer, `.blockmap` and `latest.yml` update feed as artifacts.
A new package version pushed to main publishes those tested assets to GitHub
Releases, creating its matching `v` tag. Existing versions are never overwritten.
An explicit matching `v` tag can also publish a release.
For example, release `v0.3.1` only after changing package.json and its lockfile to
0.3.1. Beta versions use a suffix such as `0.4.0-beta.1` and a prerelease tag.

The updater checks this public repository, never requires a GitHub token in the
app, and verifies the installer against the feed's SHA-512 checksum. Downloads
are automatic by default. Installation is explicit, with automatic installation
on quit disabled. Open Roblox windows, pending launches, control sessions, and
sign-in windows block restart. Accounts stay in the existing user-data directory.
Switching from Beta to Stable never downgrades the application.

The repository currently builds unsigned installers. Checksums and HTTPS protect
transport integrity; they do **not** establish a verified Windows publisher.
For commercial distribution, obtain a Windows signing certificate and configure
electron-builder signing through CI secrets. Never commit a certificate, signing
password, private key, Stripe secret, or GitHub token. Keep signature verification
enabled when distributing signed updates.

## Run a private test service

Use Node 24 LTS on the server:

```sh
npm ci
npm run license:init
npm run license:serve
```

This creates `.orbit-service/signing.pem`, `admin-token`, and `public.pem` using
exclusive creation, without overwriting an existing identity. The service starts
on `http://127.0.0.1:8787`; open `/admin`. Read the admin-token file **on your own
machine** to sign in. The token stays in the admin browser tab's memory. A server
operator can generate permanent or timed keys, batches for giveaways, per-key
feature grants, installation limits, revoke/restore access, extend expiry, and
deactivate installations. Raw activation keys are displayed once; the license
lookup table stores hashes. Pending purchase keys are encrypted until delivery.

In Orbit, open **Account & License → Connect service**. Supply the service URL
and the contents of `public.pem` (never signing.pem). Localhost HTTP is allowed
for tests; external services must use HTTPS. Activate a generated key. No Roblox
cookies, login sessions, account names, or game data are sent to this service.
Only installation identity/name, activation data and purchase data are sent.

## Deploy with Docker and HTTPS

Provide a server and a domain pointing to it. Copy `deployment/example.env` to
`deployment/.env` and fill in LICENSE_DOMAIN. From `deployment/`:

```sh
docker compose --env-file .env build
docker compose --env-file .env run --rm licenses node scripts/license-init.mjs /data
docker compose --env-file .env up -d
```

Caddy terminates HTTPS on ports 80/443. The Node API is exposed only to the
compose network. Signing keys, admin token and SQLite data persist in the
`license-data` volume. Back up the whole volume, including SQLite WAL/SHM files
when present, using a consistent database backup or stopping the service first.
Losing the signing identity breaks existing activation receipts and encrypted
purchase delivery. Never initialize a new identity over an existing installation.

Use a secret manager or protected environment file for production Stripe values.
The sample `.env` is not committed. Start with test mode and manual keys before
accepting payments. Production hosting and payment accounts are not provisioned
by the repository and no live payment credentials are bundled.

Publish the public service URL and Ed25519 public key into either
`app/config/services.json` before the next build, or GitHub repository Variables
`ORBIT_LICENSE_SERVICE_URL` and `ORBIT_LICENSE_PUBLIC_KEY`. CI applies those
nonsecret values when packaging. Customers then get the official connection
without entering it manually. The desktop never receives the private key.

## Plans, device limits, expiry

Free includes unlimited local account records up to the workspace's 5,000-record
limit, local multiple sessions, native local play, previews, and one-time local
schedules. Plus grants two managed peer PCs, recurring local schedules, saved
local workflows, 1,000-entry history/export, and opt-in desktop alerts. Pro grants
five managed peer PCs and cross-PC bulk launch actions. Free displays the latest
100 history entries without deleting older stored history.

`maxDevices` counts paired PCs controlled from a workspace. `maxActivations`
separately counts installations on which a key can be activated. Purchased Plus
keys default to one controller installation and Pro to two; admin-issued keys can
choose these limits separately. Hosting a PC for a licensed controller remains
free. Basic Stop/release/unpair actions remain usable when a license expires;
expiry does not close games or erase data. New paid actions are blocked in the
main process, including direct IPC calls.

Custom grants can assign individual features to a Free key. If granting remote
control, also choose a managed-PC limit greater than zero. Timed manual/prepaid
keys start their duration on first activation; a fixed expiry can also be set via
the admin API. Subscription keys expire at the paid Stripe billing period end.

An activation receipt is signed with Ed25519, bound to the installation ID, and
valid offline for at most 72 hours or its plan expiry, whichever comes first.
Online revalidation runs every six hours and can be requested immediately.
Revocation/deactivation therefore takes effect on the next successful check;
an offline client may retain access until its signed allowance expires. Large
clock rollback requires revalidation. Already-running games are not closed.

Opt-in trials are controlled by ORBIT_TRIAL_DAYS (0 disables; maximum 30).
They are limited per installation, **not** per verified person/account. Reinstall
abuse cannot be reliably prevented by this lightweight trial design. Use manually
issued single-installation trial keys when you need tighter distribution.

The public source cannot make local feature locks tamper-proof. The server
controls issuance, payment fulfillment, installation slots and signed receipt
renewal. Peer-PC allowances and local tools are enforced by the standard desktop
client and can be modified in a fork. No Roblox client modifications are involved.

## Stripe purchases

Create Plus and Pro products and these Price types in your Stripe account:

| Offer ID | Stripe price type |
| --- | --- |
| plus.month / pro.month | Recurring monthly, interval count 1 |
| plus.year / pro.year | Recurring yearly, interval count 1 |
| plus.prepaid / pro.prepaid | One-time, grants 30 days from activation |

Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and ORBIT_STRIPE_PRICES (a JSON map
of offer IDs to real Price IDs). The catalog reads actual active prices; missing
or incompatible offers are not offered. Configure Stripe Customer Portal for
self-service billing. The desktop opens Stripe-hosted Checkout and Portal pages;
it never handles card data. No prices, live products, or charges are created
until you configure your account and a customer deliberately completes checkout.

Register `https://YOUR_DOMAIN/v1/webhook` for these events:

- checkout.session.completed
- checkout.session.async_payment_succeeded
- invoice.paid
- customer.subscription.created / updated / deleted / paused / resumed
- charge.refunded
- charge.dispute.created

Use the endpoint's own signing secret. The API verifies the **raw** request body
with Stripe's SDK. It then retrieves current Stripe objects, verifies the expected
Price ID, and fulfills only confirmed paid sessions/invoices. It does not trust
the success redirect or arbitrary browser payment-status messages. Processed
event IDs are recorded; repeated events do not extend prepaid access. Failed
renewals do not extend paid time. Risk holds are kept until an operator reviews
and clears them. Refund/dispute handling applies to payments that can be matched
to a stored order/subscription; review unmatched risk events in Stripe as well.

Return to Orbit after paying and use **Check purchase** to retrieve the key via
its private purchase token and activate it. Incomplete or failed purchases stay
pending and do not unlock features. Use Cancel pending checkout to expire an
unfinished checkout; already-paid purchases are collected rather than discarded. Upgrading currently creates a separate new
license/subscription; manage or cancel any previous subscription in the billing
portal to avoid paying twice. Direct plan migration/proration is not implemented.

## Validation and operational limits

`npm test` covers real local HTTP activation/revocation plus signature forgery,
expiry, installation limits, trial redemption, permission checks, bounded offline
access, and mocked signed Stripe webhook fulfillment/renewal/replay/refund flows.
Windows CI additionally exercises the actual Electron main-process license gates
and encrypted activation persistence. UI checks cover plan/updates/workflow views
and admin key creation. Live Stripe sandbox, a two-version installed-app update,
and real Roblox gameplay remain manual release checks; do those before selling.

The server is a single Node process with SQLite; use one service replica with its
persistent volume. Its in-memory IP rate limit and SQLite write serialization
are not a distributed anti-abuse system. Put production traffic behind an HTTPS
proxy with appropriate request/connection limits, retain backups, and monitor
billing webhook deliveries. There is no customer email/password account or email
recovery in this release: the activation key is the license-management credential.
