# bro + Matt Pack, next-generation payload

This directory is the common payload for the single `bro-matt` Tool in BRO-89. It is used by both Codex and Claude Code. Installation and project placement belong to the Tool lifecycle, outside this payload.

## Matt Pack

The 27 skills and 80 upstream artifacts (79 skill files plus LICENSE) in this source directory are byte-identical to `https://github.com/mattpocock/skills` at release `v1.3.2`, commit `d1478fcb140db0b93c0c8df17bcfd311844749d0`. Selection follows that revision's `.claude-plugin/plugin.json`: stable engineering and productivity skills. The manifests record every file, original path, hash and mode; paths in `releasePath` are relative to this payload. The `pr` skill's upstream `CREDITS.md` is included.

During release preparation, `setup/adapt-skills.mjs` adds a project-settings pointer to each installed skill and adapts the tracker prerequisite in code-review and first-use setup condition in ask-matt. The v2 adaptation keeps BRO's `CONTEXT.md` / `CONTEXT-MAP.md` domain convention throughout skill Markdown and references, and replaces setup's glossary migration offer with preservation of configured names. `teach` retains its separate learning glossary. Format-file names such as `domain-modeling/GLOSSARY-FORMAT.md` remain unchanged so their links and upstream paths stay intact. Expected upstream phrases are checked before replacement; changed wording fails preparation instead of silently losing the adaptation.

This permits direct Matt invocation after BRO project setup while keeping Codex and Claude settings independent. Packaged manifests/notices explicitly mark these modifications and record both upstream and packaged hashes; original metadata is retained under `upstream/`. Ordinary builds use the committed source without network access or changes to selection, revision or license.

`source.commit` is the immutable source identity; `source.tag` records the release label. `THIRD_PARTY_NOTICES.md` lists the actual hashes and license. Host differences in workflow invocation are explained by the first-party bro reference rather than rewriting upstream skill bytes. `agents/openai.yaml` remains intact; it is Codex metadata, not an additional Claude dependency.

## First-party bro

The orchestration workflow is adapted from the project's `src/skills/bro/SKILL.md` for the approved BRO-89 design. It retains project context reading, task selection, scenario/design approval, route reuse, bounded delegation, complete interview records, evidence-based progress, and completion criteria.

The former supply/profile diagnostics (`scripts/check.mjs`, `runtime.mjs`, `commands.mjs`, and `references/diagnostics.md`) are intentionally not included. They require previous-generation deployment and mandatory external services. The new entry reads project agreements and checks only capabilities needed for the requested action. Task records are provider-neutral in `references/work-records.md`; project agreements decide external or local tracker and its format. No other BRO Tool is required.

The first-party references are rewritten for this workflow and both hosts. `agents/openai.yaml` retains the explicit-invocation policy. The frontmatter additionally declares explicit invocation for Claude. Real project configuration/discovery, permissions, and installation remain host/lifecycle responsibilities; prompt instructions do not claim to enforce them.

Project fallback settings are written by lifecycle in each host's project area,
outside the skill source. The bro entry reads that configured file relative to
its installed location. Shared repository agreements retain priority and are
never owned/deleted by either agent's installer. This keeps coexisting Codex and
Claude installations independent when one is removed.

## Legal evidence

`LICENSE` and the immutable public-offer snapshot/evidence are copied from the existing project's `src/legal`. `legal/source-manifest.json` preserves the source legal metadata for build integration; its source paths are not installed runtime dependencies. No legal terms or snapshot were edited. The final release builder must carry the applicable license/evidence and Matt notice with the included payload.

## Verification limits

The content tests verify pinned artifact bytes, skill completeness, license presence, and local pointers in the bro workflow. They do not establish native host discovery, model compliance with prompts, external authorization, or lifecycle cleanup. Those require integration checks through the final release and agent hosts.
