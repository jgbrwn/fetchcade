# Cloudflare deployment

Fetchcade uses one Cloudflare Worker with Workers Assets:

- static Vite output is served from `dist/`;
- `/fetch` is the Archive-only relay;
- `/health` is a small smoke-test endpoint;
- no R2 bucket, D1 database, KV namespace, or server-side ROM storage is required.

The checked-in `wrangler.json` intentionally contains no Worker name, account ID, custom domain, or credential. `scripts/generate-wrangler-config.mjs` creates an ignored `.wrangler.generated.json` from deployment environment variables.

## Manual CLI deployment

Install dependencies and set values only in your shell or secret manager:

```bash
npm ci
export CLOUDFLARE_API_TOKEN='...'
export CLOUDFLARE_ACCOUNT_ID='...'
export FETCHCADE_WORKER_NAME='my-fetchcade'
export FETCHCADE_CUSTOM_DOMAIN='play.example.com'
npm run deploy
```

The API token needs permission to deploy the account's Worker and configure the custom domain. Do not put the token, account ID, Worker name, or domain in a committed file if your operational policy requires those values to remain account-side.

With no custom domain:

```bash
export FETCHCADE_CUSTOM_DOMAIN=''
npm run deploy
```

Wrangler will report the resulting `workers.dev` hostname.

### For the connection screen in the screenshot

Change the defaults to:

- **Build command:** `npm run build && npm run generate-wrangler-config`
- **Deploy command:** `npx wrangler deploy --config .wrangler.generated.json`

In **Advanced settings**, add these Cloudflare **build-time** variables:

- `FETCHCADE_WORKER_NAME` = the existing Worker name chosen in Cloudflare.
- `FETCHCADE_CUSTOM_DOMAIN` = the existing production hostname, if any.

These values are intentionally stored in the Cloudflare build configuration instead of Git. The Worker runtime Variables/Secrets panel is a different environment: runtime variables are not a reliable source for the build/deploy shell. Fetchcade currently does not require any application runtime secret, R2 binding, D1 binding, or API token during a native Cloudflare Workers Builds deployment; Cloudflare's connected build integration supplies the deployment authentication.

If **Enable Preview builds** is selected, give preview builds a separate Worker name and leave `FETCHCADE_CUSTOM_DOMAIN` empty for previews. Do not let a preview deployment try to claim the production custom domain. The simplest first setup is to leave Preview builds off, confirm production deploys, and add a separate preview Worker later.

## Cloudflare Workers Builds / Git deploys

To deploy automatically after pushes to `main`:

1. Push this repository to GitHub.
2. In the Cloudflare dashboard, open **Workers & Pages**, create/import a Worker from the repository, and connect the GitHub account.
3. Set the production branch to `main`.
4. Use `/` as the project root.
5. If the dashboard has separate commands, use:
   - **Build command:** `npm run build && npm run generate-wrangler-config`
   - **Deploy command:** `npx wrangler deploy --config .wrangler.generated.json`
6. If it offers one command, use `npm run deploy`.
7. Add these build environment variables in Cloudflare—not in Git:
   - `FETCHCADE_WORKER_NAME` — the Worker name already chosen in Cloudflare.
   - `FETCHCADE_CUSTOM_DOMAIN` — optional hostname to attach as a custom domain.
   - `CLOUDFLARE_ACCOUNT_ID` — only if the connected build environment asks for it.
8. Use the Cloudflare-managed Git/Workers authentication where available. If a token is required, add it as a masked build secret named `CLOUDFLARE_API_TOKEN`.

The generated config is ignored by `.gitignore`, so public GitHub builds do not need to expose the deployment values. A pull request or push can build the app without having access to the production secret; only the Cloudflare deploy step needs the account credentials.

## Post-deploy checks

Replace `play.example.com` with the configured hostname:

```bash
curl -fsS https://play.example.com/health
curl -I https://play.example.com/
```

The home page should include:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`
- a restrictive Content Security Policy

The relay should return CORS/CORP headers and `Cache-Control: no-store`. It accepts only HTTPS Archive download/metadata targets and does not proxy arbitrary hosts.

## Updating the live deployment

The same `npm run deploy` command is idempotent. Keep the production Worker/domain values in Cloudflare build settings or a local secret manager, then push source changes to GitHub. Do not add a real `.wrangler.generated.json`, `.env`, API token, account ID, R2 name, D1 name, or private hostname to the repository.