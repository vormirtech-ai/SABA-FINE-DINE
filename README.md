# Saba — Fine Dine

Billing and kitchen order tickets for a fine-dining restaurant.

**The website is here:** https://vormirtech-ai.github.io/SABA-FINE-DINE/

- **/** — what Saba is and what it does
- **/demo/** — the whole application, working, in your browser
- **/docs/** — installing it, running it, and how it is built

## Signing in to the demonstration

| | PIN | Sees |
|---|---|---|
| Owner / Admin | `1379` | everything, including the takings |
| Devesh Kamat | `3582` | restaurant manager — the service, never the takings |
| Alina Rahman | `2471` | captain |
| Priya Nair | `5814` | waiter |
| Kitchen Pass | `4693` | the kitchen display, and nothing else |

Sign in as the waiter and then as the owner to see how much of the building
each role is allowed to reach.

It works on a phone. The sections move to a bar across the bottom and the
order screen becomes two tabs — the carte, and this table.

## This is a demonstration, not a till

It is the real application — the same screens, the same prices, the same
arithmetic to the paise — running against a stand-in that lives inside the
browser tab. An automated test runs one whole service through both the real
server and this stand-in and insists the totals match.

But everything it holds is in that tab. Close it, or press **Start again**,
and it is gone. Two people opening the site do not see each other's tables.
Nothing is written down anywhere.

That is right for a demonstration and wrong for a restaurant. A real install
is one small computer in the back office that every screen in the building
talks to: a captain's phone, the tablet at the pass, the till, the manager's
laptop. It needs no internet — unplug the line and nothing changes.

**/docs/DEPLOYMENT.html** covers installing it properly.

## What is in this repository

The built website only. The product itself — the server, the database, the
printer driver, the install scripts — is not here.

---

© Saba Fine Dine. See LICENSE.txt.
