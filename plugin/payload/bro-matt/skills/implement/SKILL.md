---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

## BRO project context

Before this workflow, read `../../bro-vibe-coding/project.md` relative to this SKILL.md. It supplies this installation's tracker, triage mapping and domain layout. Existing repository instructions and docs/agents agreements take precedence. These supplied settings fulfill the workflow's setup prerequisite; ask for setup only when neither source supplies the required information.


Implement the work described by the user in the spec or tickets.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask.

Call the Skill tool with "tdd" where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, call the Skill tool with "code-review" to review the work.

Commit your work to the current branch.
