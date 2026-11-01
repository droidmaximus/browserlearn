# BrowserLearn backend

Cloudflare Worker + D1: Polar webhooks, claim-code Pro licenses, 300 hosted compiles per billing period, Anthropic proxy. Stores no recordings.

## Local tests

```bash
npm test --workspace @browserlearn/backend
```

## Deploy

1. Create a D1 database and set `database_id` in `wrangler.toml`.
2. Put secrets: `LICENSE_PRIVATE_KEY`, `POLAR_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`.
3. Set var `POLAR_PRODUCT_ID` to your Polar Pro product id.
4. Embed the matching public key in `packages/cli` (`LICENSE_PUBLIC_KEY_PEM`).
5. `npx wrangler deploy` from this directory (requires Wrangler).

Dev keypair used in tests is documented in `test/helpers.ts` — replace for production.
