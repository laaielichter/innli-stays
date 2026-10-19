# Bijdragen aan INNLI

Fijn dat je wilt helpen. English is welcome too.

## Snel beginnen

```bash
npm install
npm run demo        # demo met voorbeeldverblijven op http://localhost:3000
npm test            # alle tests
npm run typecheck
```

Node.js 22.18 of nieuwer. Er is geen build-stap: Node draait de TypeScript direct.

## Waar hulp welkom is

- **Koppelingen met boekingssystemen.** De live-API staat beschreven in [docs/connector-contract.md](docs/connector-contract.md); Beds24 is een voorbeeld.
- **Vertalingen:** gastpagina's en e-mails in meer talen (`src/i18n`).
- **Agents:** probeer INNLI met jouw agent en meld wat beter kan. Zie [agent-kit](agent-kit/README.md).
- **Fouten:** open een issue met je versie (`/health`) en wat je deed.

## Open source, ook in de toekomst

De kern van INNLI is AGPL-3.0 en blijft open: alles staat hier, voor iedereen. Grote partijen die INNLI gesloten willen inbouwen, kunnen een commerciële licentie nemen ([COMMERCIAL.md](COMMERCIAL.md)). Daarmee blijft het project betaalbaar en onafhankelijk.

## Afspraken

- Houd onbekende gegevens onbekend: INNLI verzint nooit iets voor een agent.
- Schrijf een test bij elke wijziging (`test/`), en zorg dat `npm test` en `npm run typecheck` slagen.
- Door een pull request te sturen, ga je akkoord met de [bijdragersovereenkomst](CLA.md). Daarmee kan je bijdrage zowel onder de AGPL als onder de commerciële licentie gebruikt worden.
