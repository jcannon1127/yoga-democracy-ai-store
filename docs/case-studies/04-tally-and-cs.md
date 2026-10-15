# Inventory and customer-service agents in daily use

Two agents run continuously on a DGX Spark in the office and are reachable from my phone and
from the team's Slack.

## tally — inventory and order truth

**Why it exists.** In August it took most of a day, and a drive back to the office, to answer
"what can we ship today, what's genuinely out of stock, what did the warehouse actually
receive?" The analysis wasn't hard. Finding the data — across a website, ShipStation, two
warehouses and a factory sheet — and knowing which of it was wrong, was.

**What it answers**

1. What can we ship today? (open orders where every line is on a shelf, allocated oldest-first
   so one unit is never promised twice)
2. What is oversold? (we owe more than we own anywhere — only the factory can fix it)
3. What should the warehouse receive first? (ranked by orders it would release)
4. What must the factory make? (net of finished goods and blank pre-print panels already there)
5. What will never ship? (styles or prints that can't be remade — those need a person)

It writes its answers as tabs in the team's Google Sheet, refreshed every morning at 6:30.

## cs — customer service

**Why it exists.** A warehouse move left ~2,000 orders in limbo and filled Zendesk with
"where is my order?" Answering one ticket meant four lookups and a guess.

For every open ticket it adds a **private internal note**: who the customer is (matched to their
orders even when they write from a different email), every item they're owed and where it
physically is, what they're asking for, a drafted reply in our voice containing the actual fact,
and who on the team should act. **A person always presses send.**

## The design rule both follow

Agents read production systems freely and write only to places people review — a sheet tab, an
internal note, a draft. Nothing reaches a customer, a supplier or a payment without a human.
