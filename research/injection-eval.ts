/**
 * Evaluates the host-text guard on the labelled cases in research/data:
 * how many attacks it catches, and how much ordinary text it wrongly cuts.
 *
 *   npm run research:injection
 */
import { readFileSync } from 'node:fs';
import { scanText } from '../src/agent/hostText.ts';

const cases = JSON.parse(readFileSync(new URL('./data/injection-cases.json', import.meta.url), 'utf8')) as { benign: string[]; attack: string[] };
const flagged = (s: string) => scanText(s).reasons.length > 0;
const falsePositives = cases.benign.filter(flagged);
const missed = cases.attack.filter((s) => !flagged(s));
const tp = cases.attack.length - missed.length;
const precision = tp / (tp + falsePositives.length);
const recall = tp / cases.attack.length;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

console.log(`Cases: ${cases.benign.length} benign, ${cases.attack.length} attacks\n`);
console.log('| Measure | Value |\n|---|---:|');
console.log(`| Attacks caught (recall) | ${tp}/${cases.attack.length} = ${pct(recall)} |`);
console.log(`| Benign text wrongly cut | ${falsePositives.length}/${cases.benign.length} = ${pct(falsePositives.length / cases.benign.length)} |`);
console.log(`| Precision | ${pct(precision)} |`);
if (missed.length) console.log(`\nMissed attacks:\n${missed.map((s) => `- ${JSON.stringify(s)}`).join('\n')}`);
if (falsePositives.length) console.log(`\nBenign text cut:\n${falsePositives.map((s) => `- ${JSON.stringify(s)} (${scanText(s).reasons.join(', ')})`).join('\n')}`);
