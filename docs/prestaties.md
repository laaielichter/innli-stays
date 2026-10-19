# Prestaties (0.6)

Gemeten met `npm run bench` (`scripts/bench.ts`) op dezelfde machine, vóór en na de 0.6-optimalisaties. De benchmark maakt 300 accommodaties met elk 3 kamers aan (verspreid over vijf regio's), plus 12 accommodaties met een live boekingssysteem dat 40 ms per antwoord nodig heeft, 20.000 aanvragen en 200.000 gebeurtenissen. Daarna meet hij het gemiddelde van herhaalde aanroepen. Aantallen zijn aan te passen met `BENCH_PROPERTIES`, `BENCH_REQUESTS` en `BENCH_EVENTS`.

| Meting | 0.5 | 0.6 | Factor |
|---|---:|---:|---:|
| `search_stays` regio, met datums | 6,30 ms | 4,21 ms | 1,5× |
| `search_stays` heel NL, met datums | 9,81 ms | 5,92 ms | 1,7× |
| `search_stays` met 12 live boekingssystemen (40 ms per stuk) | 417 ms | 46 ms | 9× |
| `find_available_dates`, live boekingssysteem | 1.152 ms | 123 ms | 9× |
| `get_quote` | 0,76 ms | 0,19 ms | 4× |
| `find_available_dates`, 30 dagen | 18,8 ms | 1,3 ms | 14× |
| Dashboard: funnel | 11,0 ms | 0,18 ms | 61× |
| Dashboard: wat agents zoeken | 3,05 ms | 0,22 ms | 14× |
| Statuslink opzoeken (token) | 2,95 ms | < 0,01 ms | > 100× |
| 1 gebeurtenis opslaan, inclusief schijf | 1.280 ms | 0,02 ms | > 10.000× |

De metingen met live boekingssystemen in de kolom 0.5 zijn gedaan met de nieuwe opslag maar met de oude, opeenvolgende controles. Het verschil komt dus alleen van de parallelle controles.

## Wat er veranderd is

- **Opslag.** Gebeurtenissen, offertes, links, aanvragen, vragen, vraagdata en de wachtlijst staan nu in append-only bestanden (`innli.<naam>.jsonl`). Een schrijfactie voegt één regel toe in plaats van het hele bestand opnieuw te schrijven. Instellingen, accommodaties en agents blijven in `innli.json`. Bestanden worden vanzelf compact gemaakt. Een half geschreven laatste regel (stroomuitval) wordt overgeslagen. Oude installaties worden bij de eerste start automatisch omgezet.
- **Indexen.** Aanvragen, vragen, gebeurtenissen en wachtlijst zijn in het geheugen geïndexeerd per accommodatie en per token. Daardoor zijn het dashboard en de statuslinks niet meer afhankelijk van het totale aantal gebeurtenissen.
- **Vraag per dag.** *Wat agents zoeken* telt per accommodatie per dag (eisen, uitkomst, onbekende gegevens) in plaats van één gebeurtenis per zoekopdracht. Dit blijft 400 dagen bewaard.
- **Parallelle live controles.** Zoeken en datums zoeken controleren tot 12 boekingssystemen tegelijk (`mapLimit`).
- **Snellere data.** `find_available_dates` controleert de beschikbaarheid één keer per kamer voor de hele periode en rekent daarna per aankomstdag.
- **HTTP.** JSON-antwoorden hebben een `ETag`. Een agent die `If-None-Match` meestuurt, krijgt bij ongewijzigde gegevens een lege `304` terug, bijvoorbeeld voor het paspoort. Let op: `fetch()` in Node en browsers stuurt bij `If-None-Match` zelf `Cache-Control: no-cache` mee. Daardoor kan de server toch alles opnieuw sturen.

## Hotels (0.7)

Een hotel met 300 kamers in vijf kamertypes en 10.000 boekingen over een jaar, gemeten in dezelfde run:

| Wat | Tijd |
|---|---:|
| `check_availability`, 3 kamers | 1,15 ms |
| `get_quote`, 3 kamers met tariefplan | 0,91 ms |
| Kamerkalender, 120 dagen | 2,45 ms |

De bezetting per nacht wordt alleen geteld voor de nachten waar het om gaat. In de eerste versie werd elke boeking van het kamertype doorgelopen; beschikbaarheid kostte toen ~30 ms.

## Zelf meten

```bash
npm run bench
```

Uitkomsten hangen af van de machine. Een Raspberry Pi 4 is grofweg 3–5× langzamer dan een laptop, maar nog steeds ruim binnen de tijd die een agent wacht.
