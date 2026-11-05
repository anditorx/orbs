# Contributing to Orbs

Thanks for your interest! Orbs is in early development (Phase 0).

## Ground rules

- **Clean-room only.** Do not copy code, prompts, assets, or names from proprietary products.
  Orbs may be _inspired_ by publicly observable behavior, but every line here must be original
  or come from a compatibly licensed open-source project (keep its notice).
- Keep changes small and focused; include tests where practical.
- Run `pnpm lint && pnpm typecheck && pnpm test` before opening a pull request.

## Sign-off

Every commit must be signed off (Developer Certificate of Origin):

```bash
git commit -s -m "feat: ..."
```

A Contributor License Agreement may be introduced before the first public release to keep
future licensing options open; contributors will be asked to accept it at that time.

## Licensing

- `apps/*` and `packages/db`: AGPL-3.0-only (see `LICENSE`).
- `packages/protocol` and `packages/plugin-sdk`: MIT, so plugins and clients can be built freely.
