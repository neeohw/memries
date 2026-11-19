# ADR 0001 — Agent guidance lives in the repository

- Status: accepted
- Date: 2026-08-26 (revised 2026-11-18)

## Context

Agents working on this repository arrive with no memory of it, and this
checkout sits beside unrelated projects. Without a contract in the repository
itself, each one re-derives the architecture from the source, or wanders into
a sibling directory looking for context that is not there.

## Decision

Two files, both checked in, both short enough to stay read:

- **[AGENTS.md](../../AGENTS.md)** is the contract: where the workspace stops,
  what is in and out of scope, the stack, the non-negotiables, and the seams
  where new behaviour belongs.
- **[CONTEXT-MAP.md](../../CONTEXT-MAP.md)** is the map: the decisions table,
  the module layout, the routes, the storage layout, and the constraints that
  are easy to break without knowing them.

Decisions themselves live in `docs/adr/`, one file each, written when the
decision is made rather than reconstructed later.

The README stays the human quick start. It is not the architecture source of
truth, and an agent that reads only the README will miss every constraint that
matters.

## Consequences

- A decision that contradicts an ADR is a decision to revise that ADR, in the
  same change.
- An ADR that no longer describes the product is deleted or rewritten rather
  than annotated with its own history. This file, and several others, have
  been rewritten that way.
- Pointers that lead outside this repository are ignored, whatever they claim.
