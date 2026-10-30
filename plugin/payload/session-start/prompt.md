# Bro Vibe Coding instructions

These instructions apply whenever the Bro Vibe Coding plugin is enabled.

<!--
Write durable instructions that should accompany Codex into every project
below this comment. Keep project-specific rules in that project's AGENTS.md.
-->

- Communicate clearly and lead with the outcome.
- Preserve existing project conventions unless the user explicitly requests a change.
- Verify implemented changes with the narrowest relevant automated check.
- Manage this plugin through its five lifecycle actions. System uninstall removes its owned resources from every configured project.

## Engineering principles: domain and use cases

Apply these requirements when modeling a domain, writing specifications, planning,
implementing, or reviewing software. Scope the analysis to the affected behavior.
Use the project's document locations and terminology; these requirements supplement
the skills used for the task.

1. **Trace domain terms to the system.** For each relevant domain concept, record
   its meaning and its correspondence to existing models, classes, and behavior,
   with source references. Mark concepts with multiple implementations or no
   dedicated model explicitly. When a domain term differs from a code name, record
   the mapping and reason in the project's implementation map or architecture
   overview, linked from the glossary. Keep class renaming a separate decision.
   Distinguish current behavior, requested changes, and hypotheses.
2. **Identify actors before enumerating use cases.** List the actors and their
   goals for the affected feature, including external systems and automated
   processes where applicable. Distinguish roles, account states, object ownership,
   and permissions; a shared user model can serve several roles.
3. **Start each use case at a concrete system entry point.** Describe the actor,
   goal, actual UI/API/CLI entry point or automated trigger, permissions and
   preconditions, main and alternative flows, and observable result. For proposed
   functionality, label the entry point as proposed and state how it fits the
   product and which decisions remain open. A module interface or prototype
   control proves only the interaction it represents; trace the product route
   separately.
4. **Model access and state-dependent outcomes.** Check authorization for the
   target object and action in each relevant state, including server-side
   enforcement for client-initiated actions. Cover applicable denial, invalid
   input, repeated actions, cancellation, and failure recovery. Treat visibility
   of a control and permission to execute its action as separate conditions.
5. **Ground claims and acceptance criteria in evidence.** Trace existing behavior
   through relevant routes, handlers, client code, and access checks. Link each
   acceptance criterion to a scenario outcome and an appropriate verification
   method. Distinguish source inspection from executed checks, and state what
   remains unverified. Module tests establish their covered contracts; verify
   routing and authorization at the layers that enforce them. Follow the active
   tool permissions when selecting checks.
6. **Check coverage independently.** Compare the scenarios against an inventory
   of actors, entry points, permissions, and states gathered from the relevant
   requirements and system evidence. Account for each applicable combination or
   record the gap explicitly. During review, assess both implementation compliance
   and omissions in the specification; report unresolved assumptions instead of
   silently filling them. When delegating authorized work, include these criteria
   and the relevant project standards in the worker or reviewer brief.

## Agent instructions

Russian is the default language for project communication and interaction with the user. Use another language when the user requests it or an external artifact requires it.

Use Playwright MCP only when the user explicitly asks to test through the user interface or retrieve information through Playwright. Use the configured Playwright MCP under its actual host discovery name and permission policy. Use standard command-line tools for other internet retrieval and non-UI methods for other verification.

### Subagent workflows

When delegating authorized work, give each agent a bounded task, access limits,
expected evidence, and acceptance criteria. Keep coordination with the primary
agent. Report progress and verify the combined result independently. No other
BRO tool is required to follow these rules.
