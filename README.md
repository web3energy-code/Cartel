# Cartel — a NEAR marketplace with escrow

Folders: `api` (Express, deploy to Vercel) and `web` (Vite + React, deploy to Vercel).

## 1. Database
Supabase → SQL Editor → paste `cartel-setup.sql` → Run. This also creates the public `cartel-products` photo bucket.

## 2. Escrow wallet (testnet)
Use the account id and key from `escrow-testnet-key.txt`. Fund the account with testnet NEAR from a faucet (it needs a few NEAR for payouts).
Pick a second account (your own testnet wallet) as the fee account.

## 3. Deploy the API (Vercel project 1, Root Directory = `api`)
Environment variables:
- SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
- ESCROW_ACCOUNT_ID, ESCROW_PRIVATE_KEY (the `ed25519:...` value)
- FEE_ACCOUNT_ID (receives the 10% fee)
- ADMIN_TOKEN (any long random string, used to resolve disputes)
- NEAR_NETWORK = testnet
Optional: MARKETPLACE_FEE_BPS (1000), ESCROW_HOURS (24), NEAR_RPC_URL.
Open `<api-url>/config` — `escrowReady` should be true.

## 4. Deploy the web app (Vercel project 2, Root Directory = `web`)
Environment variables: VITE_API_URL = your API URL (no trailing slash), VITE_NEAR_NETWORK = testnet.

## Mainnet later
Set NEAR_NETWORK=mainnet and VITE_NEAR_NETWORK=mainnet, use a new escrow key holding real funds, and test small first.

## Resolving a dispute
POST `<api-url>/orders/<id>/resolve` with header `x-admin-token: <ADMIN_TOKEN>` and JSON body `{"action":"release"}` or `{"action":"refund"}`.
