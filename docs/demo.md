# Demo: an AI agent books a stay

Two ways to see INNLI work from start to finish, on the sample stays that come with it. No account and no real property are needed.

## Watch it

[marketing/video/innli-booking-demo-1080p.mp4](../marketing/video/innli-booking-demo-1080p.mp4) (87 seconds, silent).

What you see is real: the tool calls and the answers were made against a running INNLI installation with the sample stays, by an AI agent connected with an agent key named "Claude". The guest and the guest's words are an example.

1. The guest asks for a B&B in Dingle with a dog and an enclosed garden.
2. The agent searches, and asks the stay about the garden. Dogs are confirmed by the host; the enclosed garden is not, and the agent says so.
3. The agent gets a price, the room is held, and the guest sees exactly what they agree to.
4. The request goes to the host. It is not a booking yet.
5. The host accepts in the dashboard.
6. The agent checks the status: booked, with a signed record.

## Do it yourself with Claude

You need Node.js 22.18 or newer and [Claude Code](https://claude.com/claude-code).

```bash
npm install
npm run demo:intl                                              # sample stays at http://localhost:3000
claude mcp add --transport http innli http://localhost:3000/mcp
claude
```

Then ask, in your own words. For example:

> Find us a quiet B&B in Dingle for three nights, 45 days from now. Two adults and our dog. A fully enclosed garden would be great. Tell me what the host confirmed and what not.

When Claude shows the price and the terms, say yes and give a name and an example e-mail address (for instance `emma.clarke@example.com`). Claude sends the request.

Now be the host:

1. Open `http://localhost:3000/dashboard/`.
2. Log in with the owner key of *Seaview House Dingle* from `data/demo-credentials.json`.
3. Open **Requests** and press **Accept**.

Back in Claude, ask: *is it confirmed?* Claude checks the status and reports the booking.

Things to try next: ask for something the host has not stated (the answer is "unknown", never a guess), ask Claude to cancel, or search with a budget.

## Other agents

Any MCP client works the same way with `http://localhost:3000/mcp`. Platforms without MCP use the REST endpoint: see [agent-integration.md](agent-integration.md) and the script in [agent-kit/examples/book-a-stay.mjs](../agent-kit/examples/book-a-stay.mjs).
