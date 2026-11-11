# Performance (0.6)

Nederlands: [nl/prestaties.md](nl/prestaties.md).

Measured with `npm run bench` (`scripts/bench.ts`) on the same machine, before and after the 0.6 optimisations. The benchmark creates 300 accommodations with 3 rooms each (spread over five regions), plus 12 accommodations with a live booking system that needs 40 ms per response, 20,000 requests and 200,000 events. It then measures the average of repeated calls. The numbers can be changed with `BENCH_PROPERTIES`, `BENCH_REQUESTS` and `BENCH_EVENTS`.

| Measurement | 0.5 | 0.6 | Factor |
|---|---:|---:|---:|
| `search_stays` region, with dates | 6.30 ms | 4.21 ms | 1.5× |
| `search_stays` all of the Netherlands, with dates | 9.81 ms | 5.92 ms | 1.7× |
| `search_stays` with 12 live booking systems (40 ms each) | 417 ms | 46 ms | 9× |
| `find_available_dates`, live booking system | 1,152 ms | 123 ms | 9× |
| `get_quote` | 0.76 ms | 0.19 ms | 4× |
| `find_available_dates`, 30 days | 18.8 ms | 1.3 ms | 14× |
| Dashboard: funnel | 11.0 ms | 0.18 ms | 61× |
| Dashboard: what agents search for | 3.05 ms | 0.22 ms | 14× |
| Looking up a status link (token) | 2.95 ms | < 0.01 ms | > 100× |
| Storing 1 event, including disk | 1,280 ms | 0.02 ms | > 10,000× |

The measurements with live booking systems in the 0.5 column were done with the new storage but with the old, sequential checks. So the difference comes only from the parallel checks.

## What changed

- **Storage.** Events, quotes, links, requests, questions, demand data and the waiting list are now in append-only files (`innli.<naam>.jsonl`). A write adds one line instead of rewriting the whole file. Settings, accommodations and agents stay in `innli.json`. Files are compacted automatically. A half-written last line (power failure) is skipped. Old installations are converted automatically at the first start.
- **Indexes.** Requests, questions, events and the waiting list are indexed in memory per accommodation and per token. As a result, the dashboard and the status links no longer depend on the total number of events.
- **Demand per day.** *What agents search for* counts per accommodation per day (requirements, outcome, unknown details) instead of one event per search. This is kept for 400 days.
- **Parallel live checks.** Search and date search check up to 12 booking systems at once (`mapLimit`).
- **Faster dates.** `find_available_dates` checks the availability once per room for the whole period and then calculates per arrival day.
- **HTTP.** JSON responses have an `ETag`. An agent that sends `If-None-Match` gets an empty `304` back when the data is unchanged, for example for the passport. Note: `fetch()` in Node and browsers adds `Cache-Control: no-cache` itself when `If-None-Match` is sent. Because of that, the server may still send everything again.

## Hotels (0.7)

A hotel with 300 rooms in five room types and 10,000 bookings over a year, measured in the same run:

| What | Time |
|---|---:|
| `check_availability`, 3 rooms | 1.15 ms |
| `get_quote`, 3 rooms with rate plan | 0.91 ms |
| Room calendar, 120 days | 2.45 ms |

The occupancy per night is only counted for the nights that matter. The first version went through every booking of the room type; availability then took ~30 ms.

## Measure it yourself

```bash
npm run bench
```

Results depend on the machine. A Raspberry Pi 4 is roughly 3–5× slower than a laptop, but still well within the time an agent waits.
