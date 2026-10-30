# Evidence procedure

Use this procedure together with the selected row of matrix.json. The row's
concrete method and original requirement determine the checks; this protocol
defines how they become defensible conclusions.

## Apply one obligation

1. **Bind.** Name its exact normative text, level/condition, asset, surface, actor
   and revision. Enumerate required conjunctions and permitted alternatives.
   Treat minimum-level filtering as insufficient where the text strengthens a
   condition at higher levels. Documentation and enforcement are separate
   requirements: a design does not prove implementation.
2. **Determine applicability.** Locate the mechanism in the architecture, source,
   route/config inventory or operator evidence. N/A needs a reason and evidence
   that the condition is absent throughout the represented surface. Missing
   source, credentials, access, time or instruments leaves applicability unknown
   or verification incomplete. For an explicit normative alternative, identify
   the branch actually used and prove its eligibility.
3. **Obtain inputs.** Read the row's concrete method, the controlling code/config,
   its call sites, inherited defaults and documented policy. Inspect changed and
   unchanged shared mechanisms. Identify sufficient direct evidence for each
   required condition and whether it requires execution or operator records.
4. **Challenge.** Follow the method's negative case: bypass, wrong identity,
   malformed value, boundary, lifecycle transition or dependency failure as
   applicable. Read the relevant versioned WSTG or Cheat Sheet method through the
   helper. Adapt examples to a bounded synthetic target. Preserve the actual
   requirement where an older method is weaker, broader or inapplicable.
5. **Decide.** Record observations per obligation and surface. Pass only if all
   required conditions and selected-level enhancements have current supporting
   evidence; fail on a demonstrated required-condition violation. A missing
   part cannot be averaged away. A documented exception allowed by the original
   norm needs its specified justification; ordinary risk acceptance is not an
   exception to the norm.
6. **Leave a trail.** Keep evidence references, method/tool version, actual
   execution outcome, counterexample, limitations, recommendation and a concrete
   verification of the proposed fix. For missing evidence, give the operator
   instruction and expected result; preserve the unresolved status.

## Isolated execution

Before running a check record:

- target revision and scratch/test environment; who authorized this scope;
- expected effects and explicit stop conditions;
- synthetic identities and data; no production credentials or copied PII;
- destinations and egress controls; disable real mail, payment, webhook, cloud,
  telemetry and queued integrations, including startup/shutdown hooks;
- finite timeout, resource/concurrency/request limits, initial state, rollback or
  cleanup of only your own artifacts;
- available tool permissions and any operator-only steps.

Make synthetic checks reproducible: control clocks, randomness, ordering and
external dependencies unless one is the explicit bounded subject of the check.
Exercise observable contracts and invariants; do not treat incidental internal
structure or a word appearing in a file as verification.

If these cannot be established, do analysis and supply a manual check. Do not
install into the product, mutate its source/dependencies, or use a permission
denial as a reason to switch to a less-controlled tool. Stop execution at an
unexpected external effect or loss of isolation and preserve the safe evidence.

## Method selection

WSTG 4.2 supplies concrete testing methods; Cheat Sheets supply implementation
mechanisms to inspect. They do not replace the full ASVS 5.0.0 requirement. Use
the helper to search the bundled document titles and contents, then retrieve
the exact relevant document. Source IDs/digests are recorded in sources.json.
Do not follow every cross-link in an upstream document; required skill workflow
resources are local. An unavailable optional external reference leaves its
evidence gap explicit and does not suspend other available analysis.

For unfamiliar technology use the documented platform behavior or operator
evidence; do not invent library guarantees. A method's suggested exploit is an
example to inspect, not an instruction to attack an external target.
