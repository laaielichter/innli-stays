/**
 * Grades a booking conversation with the reply guard.
 *
 *   npm run grade -- conversation.json
 *
 * The file is a JSON array of turns, oldest first:
 *   { "role": "guest", "text": "…" }
 *   { "role": "agent", "text": "…" }
 *   { "role": "tool", "tool": "get_quote", "args": { … }, "result": { … } }
 *
 * Prints the score (0–100) and every finding. Exit code 1 when a finding blocks.
 */
import { readFileSync } from 'node:fs';
import { gradeTranscript, type Turn } from '../src/agent/guard.ts';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run grade -- conversation.json');
  process.exit(2);
}
const grade = gradeTranscript(JSON.parse(readFileSync(file, 'utf8')) as Turn[]);
console.log(`Score ${grade.score}/100 (${grade.verdict})`);
for (const t of grade.turns) {
  for (const f of t.findings) console.log(`  turn ${t.turn + 1}  ${f.severity.toUpperCase().padEnd(5)} ${f.code}${f.quote ? `\n            "${f.quote}"` : ''}\n            ${f.evidence}\n            → ${f.fix}`);
}
process.exit(grade.verdict === 'block' ? 1 : 0);
