# The reply guard: `check_reply`

A stay answers honestly: this fact is confirmed, that one is not, the price is complete or it is not, the request is not a booking yet. Then a language model writes the sentence the guest reads. That is where it goes wrong: "your stay is confirmed" for a pending request, a rounded price, an unverified garden presented as a fact.

`check_reply` checks an agent's draft against what the stay actually returned in this conversation, before the guest sees it. It uses no language model. Every finding points at words in the draft and at the value in the evidence that contradicts them.

## Use it

It is an agent tool like the others, over MCP and REST:

```json
POST /api/agent/v1/tools/check_reply
{
  "message": "Great news: your stay is confirmed for €300!",
  "evidence": [
    { "tool": "get_quote", "result": { "total": 315, "currency": "EUR", "nights": 3 } },
    { "tool": "request_booking", "result": { "status": "new", "booked": false } }
  ]
}
```

```json
{
  "verdict": "block",
  "findings": [
    { "code": "FALSE_BOOKING_CLAIM", "severity": "block", "quote": "your stay is confirmed",
      "evidence": "The request is \"new\", booked: false.",
      "fix": "Say that the request was sent and the room is held, and that it is a booking only once the host confirms." },
    { "code": "UNSUPPORTED_AMOUNT", "severity": "block", "quote": "€300",
      "evidence": "The stay gave these amounts: 105, 315.",
      "fix": "Use an amount the stay gave (the closest is 315), or leave the amount out." }
  ]
}
```

- `evidence` is the tool results of this conversation, oldest first, as the agent received them.
- `language` is optional: `en`, `nl`, `de`, `fr`, `es`, `it`, `pt`, `pl`, `ja` or `zh`. Without it the language is recognised from the draft, and the answer says which one (`language`).
- `verdict` is `ok`, `warn` or `block`. Do not send a draft that is blocked: rewrite it with the `fix` and check again.
- Nothing is stored. The draft and the evidence are only compared.

## Ten languages

The guard reads drafts in English, Dutch, German, French, Spanish, Italian, Portuguese, Polish, Japanese and Chinese. In each of them it knows how a booking is claimed, how a sentence is made conditional, how a caveat is worded, how the common facts are named (enclosed garden, dogs, breakfast, parking, charger, step-free access, shower, bathroom, ground floor, quiet, wifi), how dates and amounts are written, and how a guest says yes, no or cancel.

A short sentence does not say which language it is. So every pattern is tried in its own language: a Dutch claim is cleared by a Dutch condition, a Polish fact by a Polish caveat. English is always read too, because agents mix languages.

The findings themselves (`evidence`, `fix`) are in English: they are for the agent, not for the guest.

## What it finds

| Finding | Meaning | Severity |
|---|---|---|
| `FALSE_BOOKING_CLAIM` | Says it is booked while `booked` is not true | block |
| `UNSUPPORTED_AMOUNT` | Names an amount the stay never gave. The total, a price line, the price per night and a rounded figure that says "about" are fine | block |
| `UNCONFIRMED_AS_FACT` | States something the host did not confirm, without saying so | block |
| `UNKNOWN_AS_FACT` | States something the host has not stated at all | block |
| `MISSING_PRICE_DISCLOSURE` | Names a price that does not include all mandatory costs, without saying so | block |
| `WRONG_DATE` | Names a date the stay did not | warn |
| `MISSING_NON_REFUNDABLE` | Names a non-refundable price without saying so | warn |

A question is never a claim, and neither is a sentence with a condition ("once the host confirms"). A hedge may sit in the same sentence or the next one ("…but the host has not confirmed that").

## Grading a whole conversation

```bash
npm run grade -- conversation.json
```

The file is a JSON array of turns: `{ "role": "guest" | "agent", "text": "…" }` and `{ "role": "tool", "tool": "…", "args": {…}, "result": {…} }`. Every agent message is checked against the evidence the agent had at that moment. Three more findings look at what the agent did:

| Finding | Meaning | Severity |
|---|---|---|
| `ACTED_WITHOUT_CONSENT` | Sent a booking request without a clear yes from the guest after the quote | block |
| `CANCELLED_WITHOUT_REQUEST` | Cancelled while the guest did not ask for it | block |
| `NO_CONSENT_HASH` | Sent a booking request without `consentHash` | warn |

The score starts at 100; a blocking finding costs 25 and a warning 8. That makes it usable as a test of a booking agent: run your agent on the sample stays, save the conversation, grade it.

## Limits

- Ten languages, tested with the same situation in each. The patterns for English are the most complete; in the other languages a mistake worded in an unusual way is more likely to be missed.
- A fact the guard has no words for is only recognised in English.
- It recognises the mistakes it has patterns for. A pass means none of these were found, not that the reply is good.
- It checks what was said against the evidence it was given. Evidence the agent leaves out cannot be checked.
