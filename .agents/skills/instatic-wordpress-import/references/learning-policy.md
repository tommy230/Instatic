# Learning Policy

Keep evidence strength and applicability separate. A confident observation can still be site-specific.

## Evidence strength

- `canonical`: guaranteed by current Instatic docs, code, or regression tests.
- `verified`: supported by repeatable before-and-after evidence or an automated check.
- `observed`: seen in one run without enough evidence to generalize.
- `hypothesis`: plausible explanation or proposed technique that has not been verified.

## Applicability

- `universal-invariant`: independent of WordPress theme, builder, plugin, hosting, and capture method.
- `conditional-pattern`: valid only when a stated predicate is true.
- `site-specific`: tied to one site's content, configuration, or repair.
- `unknown`: applicability has not been established.

Use `MUST` and `NEVER` only for canonical constraints or safety. Use `DEFAULT` only for a promoted conditional pattern whose predicate is stated. Use `CONSIDER` for heuristics and `OBSERVED` for run facts.

## Required lesson fields

Every candidate records:

- ID and concise claim
- Evidence strength and applicability
- Predicate describing when it applies
- What it does not imply
- Source task, run, artifact, commit, or test
- Sites and source stacks observed
- Instatic version and commit when known
- Symptom, root cause, action, and verification
- Counterexamples and open questions
- Repetitions and last validated date
- Promotion state: `candidate`, `validated`, `needs-revalidation`, `superseded`, or `rejected`

## Promotion rules

1. Enter every new run lesson as `observed` and `site-specific` or `unknown`.
2. Promote to `conditional-pattern` only after identifying a causal mechanism and verifying it on at least two independent sites that share the predicate, with no known counterexample.
3. Change a workflow default only from canonical product guidance or evidence across at least three materially different representative sites plus a repeatable check or regression test.
4. Mark a claim `universal-invariant` only when current docs, code, or tests establish it and it does not depend on the WordPress stack or capture method. Repetition alone cannot make a claim universal.
5. Narrow or demote immediately when a valid counterexample appears. Quarantine a claim that conflicts with current canonical documentation until reconciled.
6. Mark affected claims `needs-revalidation` when importer, publisher, runtime, or relevant source technology changes.
7. Keep run logs immutable. Record supersession and link the contradicting evidence instead of rewriting history.

## Acceptance and learning are separate

A migration may pass its agreed scope while producing no reusable lessons. A reusable importer lesson does not make a failed migration acceptable. Report product defects, documentation gaps, conditional patterns, and site quirks separately.
