# Contributing to INNLI

Nederlands: [CONTRIBUTING.nl.md](CONTRIBUTING.nl.md).

Thanks for wanting to help. Dutch is welcome too.

## Quick start

```bash
npm install
npm run demo        # demo with sample stays at http://localhost:3000
npm test            # all tests
npm run typecheck
```

Node.js 22.18 or newer. There is no build step: Node runs the TypeScript directly.

## Where help is welcome

- **Connections to booking systems.** The live API is described in [docs/connector-contract.md](docs/connector-contract.md); Beds24 is an example.
- **Translations:** guest pages and e-mails in more languages (`src/i18n`).
- **Agents:** try INNLI with your agent and report what could be better. See [agent-kit](agent-kit/README.md).
- **Bugs:** open an issue with your version (`/health`) and what you did.

## Open source, now and in the future

The core of INNLI is AGPL-3.0 and stays open: everything is here, for everyone. Large parties that want to build INNLI into closed software can take a commercial licence ([COMMERCIAL.md](COMMERCIAL.md)). That keeps the project affordable and independent.

## Agreements

- Keep unknown facts unknown: INNLI never makes anything up for an agent.
- Write a test with every change (`test/`), and make sure `npm test` and `npm run typecheck` pass.
- By sending a pull request, you agree to the [contributor agreement](CLA.md). This allows your contribution to be used under both the AGPL and the commercial licence.
