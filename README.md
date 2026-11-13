# Desk ducks

Repo: [github.com/mazh-lycan/rubber-duck](https://github.com/mazh-lycan/rubber-duck). The Pages site, once Actions publishing is turned on, is [mazh-lycan.github.io/rubber-duck](https://mazh-lycan.github.io/rubber-duck).

Three desk toys, one token each. The token is a physical-backed pairing and an [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) agent identity. An NFC tag stores a URL. The page reads the slug from that URL and calls `tokenIdFor`. The token never moves: it is minted to the deployer, the desk wallet.

There is no chip signature and no sale. Scanning needs no wallet. A wallet is only for updating an agent or opening and answering a validation. The duck does not call a paid model. The chat runs in the browser.

Minecraft is the blue block duck. Frog is the crowned frog. Swimsuit is the yellow duck in blue goggles and an orange ring. Another toy is another slug.

## Map

| Slug | Tag URL | Photo |
| --- | --- | --- |
| `minecraft` | `https://mazh-lycan.github.io/rubber-duck/#minecraft` | [Minecraft.jpg](Minecraft.jpg) |
| `frog` | `https://mazh-lycan.github.io/rubber-duck/#frog` | [Frog.jpg](Frog.jpg) |
| `swimsuit` | `https://mazh-lycan.github.io/rubber-duck/#swimsuit` | [Swimsuit.jpg](Swimsuit.jpg) |

A phone only has to open that URL. The tag is an NDEF URL record. WebNFC is not required.

## Page

From this directory:

```bash
npm run web
```

Open [http://127.0.0.1:4173/web/](http://127.0.0.1:4173/web/). Before deploy, the page reads [metadata/catalog.json](metadata/catalog.json). After deploy, it reads the contract in [web/contracts.json](web/contracts.json) through the public Arbitrum Sepolia RPC.

The card shows the photo, the slug-to-token mapping, the desk address, and the registration JSON. **Copy registration** is the agent card. **Copy registry line** is `eip155:421614:<contract>:<agentId>`.

On a minted duck, **Identity** connects MetaMask on Arbitrum Sepolia. The desk wallet can replace the agent URI and set a metadata key. `agentWallet` is shown and cannot be rewritten. **Validation** lets that same wallet name a validator and a note. The page hashes the note with `keccak256` and calls `validationRequest`. The named wallet can Accept (`100`) or Reject (`0`). Anyone can paste the request hash and read the result. The hash stays in this browser.

**Talk** loads a small model in the browser the first time. GitHub Pages does not run it, and there is no API key. The duck's description is the prompt.

## Images

The three photos are pinned together on Pinata as one public directory:

`bafybeigk7fr4rswpb7tkw5xrhnoss35cn564hbsl2uteptfuhafwuqfrfq`

[metadata/minecraft.json](metadata/minecraft.json), [metadata/frog.json](metadata/frog.json), and [metadata/swimsuit.json](metadata/swimsuit.json) point at `Minecraft.jpg`, `Frog.jpeg`, and `Swimsuit.jpg` inside that directory. The page shows them through `https://gateway.pinata.cloud/ipfs/<cid>/<file>`, and falls back to `ducks/<slug>.jpg` if the gateway fails. This repo does not call Pinata and stores no API key.

## Contract

[contracts/DuckAgents.sol](contracts/DuckAgents.sol) is an ERC-721 named Desk Ducks (`DUCK`). Token id is the agent id.

- `pair(slug, agentURI)` mints the next id to `desk` and stores the slug. ASCII letters are lowercased.
- `tokenIdFor` returns `0` when the slug is not paired.
- `tokenURI` is the agent URI: a `data:application/json;base64,...` registration file.
- `agentWallet` is set once to `desk`. `setAgentURI` and `setMetadata` are the owner's calls.
- Transfers revert. `renounceOwnership` reverts, so a later toy can still be paired.

[contracts/ValidationRegistry.sol](contracts/ValidationRegistry.sol) is the ERC-8004 validation practice cut. It points at the duck contract. The desk wallet opens a request. Only the named validator can answer `0`–`100`.

```bash
npm test
```

## Deploy

Copy `.env.example` to `.env`. `DEPLOYER_PRIVATE_KEY` needs a little Arbitrum Sepolia ETH. `PUBLIC_BASE_URL` is `https://mazh-lycan.github.io/rubber-duck`, with no trailing slash.

```bash
npm run deploy:arbitrum-sepolia
```

This deploys `DuckAgents` and `ValidationRegistry`, pairs every slug, and writes both addresses into [web/contracts.json](web/contracts.json). `imageCid` becomes `ipfs://<cid>/<file>` in the registration. An empty `imageCid` uses `${PUBLIC_BASE_URL}/ducks/<slug>.jpg`.

Run it again with `DUCK_AGENTS_ADDRESS` and `VALIDATION_REGISTRY_ADDRESS` set when the contracts already exist. Paired ducks are updated with `setAgentURI`, so a CID you add later replaces the image. New slugs are paired. The signer must be the desk owner.

Commit `web/contracts.json` so the published page can find the contracts.

## GitHub Pages

[.github/workflows/pages.yml](.github/workflows/pages.yml) publishes `web/` plus a copy of `metadata/` on every push to `main` of [mazh-lycan/rubber-duck](https://github.com/mazh-lycan/rubber-duck). In the repo settings, set Pages to deploy from GitHub Actions. The tag URL is `https://mazh-lycan.github.io/rubber-duck/#<slug>`. The GitHub repo is empty until that first push.

## Add a duck

1. Put the photo at `web/ducks/<slug>.jpg`.
2. Add `metadata/<slug>.json` in the same shape as [metadata/minecraft.json](metadata/minecraft.json), including `imageCid`.
3. Append the slug to [metadata/catalog.json](metadata/catalog.json).
4. Pin the photo if you want, and paste the CID.
5. Pair or update it with the deploy script.
6. Write the tag as `https://mazh-lycan.github.io/rubber-duck/#<slug>`. Pin the new photo into the same Pinata directory, or paste that file's CID into `imageCid`.

The page lists every slug paired on chain. It looks for the photo at `ducks/<slug>.jpg` when the registration has no `ipfs://` image.
