# Architecture Decision Records

A short, numbered, append-only record of decisions that were hard to make and
would be expensive to reverse.

## Why these exist

The codebase already documents its decisions unusually well — in comments,
beside the code they govern, including the ones that were reversed and why.
That is the right place for "why is this function shaped like this", and
nothing here replaces it.

What comments cannot hold is a decision that spans files, or one whose most
important part is the option that was *not* taken. `0001` below is about
observability, and its substance is as much "we did not adopt Sentry, and here
is the condition under which we should" as it is about the logger that was
written. A future engineer who only sees the logger will reasonably assume
nobody considered the alternative.

## Rules

- **Numbered and append-only.** A record is never edited to reflect a change of
  mind. Superseding it means writing the next one and marking this one
  `Superseded by 000N`. The wrong turnings are the useful part.
- **Short.** Context, decision, consequences. If it needs more than two pages
  it is probably two decisions.
- **Only when it is load-bearing.** A record for every library choice makes the
  directory unreadable and hides the three that matter.

## Format

```
# NNNN. Title

**Status:** Proposed | Accepted | Superseded by NNNN
**Date:** YYYY-MM-DD

## Context      what was true that forced a choice
## Options      what was actually considered, with the trade-offs
## Decision     what was chosen
## Consequences what this costs, and what it makes harder later
```

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-production-observability.md) | Production observability: logging, tracing, error handling and health | Accepted |
