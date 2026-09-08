# The de-clutter protocol — finder of truth

Written 2026-09-06, extracted from the multi-app architecture audit
(`architecture/`) after the fact, because the same shape of work is worth
running again on purpose rather than reinventing it next time it's needed.
Companion to `declarations-clarification-correction.md` — that document defines
what a declaration *is*; this one is the procedure for finding out which of a
system's existing descriptions of itself are still declarations, and which have
quietly become documentation wearing a schema.

## The problem this exists for

A system that has been worked on for a while accumulates more than one
description of itself: a README, an architecture doc, code comments, a memory
file, a planning document, a config file's own defaults. Each was true when
written. None of them is checked against the others, and usually none is
checked against the running system either. They drift **independently**, at
different rates, and nobody notices because nothing forces them to reconcile —
until someone goes looking for why two of them disagree, or why the thing that's
supposed to be solved keeps not feeling solved.

This protocol is that going-looking, formalized. It has two facets, named in
its own title, run together rather than as separate phases:

- **De-clutter** — collapse redundant/conflicting descriptions down to the
  fewest that can stay independently true, and stop hand-copying a fact that
  has one real source.
- **Find the truth** — for every claim that survives, settle whether it's still
  true by checking it against the system itself, not against how confidently
  it's stated.

## The procedure

**1. Enumerate every existing description before trusting any of them.**
Docs, code comments, memory files, planning documents, config defaults — list
where a claim about the system's behavior is written down, and treat the list
itself as suspect. In this audit that list was: `README.md`, `AGENTS.md`,
`HARNESS.md`, `DESIGN.md`, a session memory file, and a separate Claude-plans
document (`CONSOLIDATED-PATH.md`) — six independent places a fact about "what's
built" could live, and could go stale.

**2. Apply the three-question test to every claim that matters**
(`declarations-clarification-correction.md`'s test, reused rather than
reinvented): what must be true, what reads it, and what happens if it's false.
A claim that fails this is either a preference (fine, say so) or documentation
wearing a schema (not fine — relabel it a gap).

**3. Generate, don't transcribe, wherever a claim is mechanically derivable.**
If a fact lives in code as structured data (a model catalog, a route table, a
file tree), write the ten-line script that reads it, not a second hand-typed
copy of it. Wire a `--verify` mode that fails loudly the moment the generated
output and the source disagree. This is the single highest-leverage move in the
whole protocol: it converts "keep this updated" from a discipline someone will
eventually forget into a property that's checked, not hoped for.

**4. Never accept a narrative as proof of a mechanism — find or produce
real data.** A code comment saying a safeguard exists is a claim, not a
mechanism. Before recording a verdict on whether something actually works,
look for the real evidence: logs, real runs, real stored records. If none
exist, that absence is itself the finding (see step 6) — do not fill the gap
with the comment's own confidence.

**5. Classify every finding by actual epistemic state, not by how the claim
was worded.** At minimum: *confirmed* (checked against real data or read
code and it holds), *plausible-suspect* (sound reasoning, not yet checked
against a real failure), *needs-measurement* (an admitted open question, not
yet resolved), *ruled out* (checked, and it isn't the cause). Collapsing these
into one undifferentiated pile of "issues" is where the next drift starts.

**6. Keep mechanics and judgment in separate objects.** "What this does" and
"whether that's the actual problem" are different claims with different
mechanisms for checking them, and a single card silently carrying both is how
a description turns into an opinion without anyone deciding it should.

**7. When you find drift, fix it at the source in the same pass — and watch
for the SAME drift recurring across independently-owned layers.** Correcting
one stale line is a typo fix. Finding that a product doc, a memory file, and a
planning document all independently went stale the same way is a finding about
the system's own discipline, worth stating on its own, separate from any one
of the three corrections.

**8. Leave the output somewhere the next pass can consume without re-deriving
it.** A protocol that produces insight nobody can find again next session has
saved nothing. The generated files, the verify scripts, and this document
itself are the artifact — not a one-off report.

## How to tell you're running this protocol vs. just writing documentation

Three questions, asked of the *work*, not any single claim in it:

1. **Did I generate what could be generated, or did I retype it?** Retyping a
   fact that already exists as structured data is the exact failure this
   protocol exists to stop.
2. **Did a comment or a doc's own confidence ever stand in for a check I could
   have run?** If yes, go run it before writing the verdict down.
3. **Would this output still be honest if the system changes tomorrow?** If a
   claim would then silently read as still-true when it isn't, it needed a
   `--verify` step or an explicit "needs-measurement" label, not confident
   prose.

## Worked examples from the session that produced this

- **Product doc vs. code**: `README.md`'s Gemini model table was missing two
  models `providers/catalog.js` actually had. Fixed by generating the table
  from `catalog.js` directly (`architecture/generate/models.mjs`), not by
  re-typing a corrected table that would drift again.
- **Memory file vs. git log**: a session memory note said "Next: A3" three
  commits after A3 shipped. Fixed at the source, and the fix records *why* it
  went stale so the next drift of the same shape is recognizable.
- **Planning doc vs. shipped state, independently of the memory file**:
  `~/.claude/plans/CONSOLIDATED-PATH.md` separately claimed only Stage 1 was
  done when Stages 2–4 had shipped — the same class of drift, in a document
  nobody would have thought to cross-check against the memory file, which is
  exactly why it survived unnoticed until this pass looked at both.
- **A comment vs. real data**: `server.js`'s repair loop carries the comment
  "a build that was going to fail should fail as the model wrote it, not as a
  failed repair left it." The real build with full telemetry showed a repair
  pass taking 47 errors to 61 and shipping that. The comment described the
  *intent* correctly; only checking a real run showed the mechanism doesn't
  yet deliver it in every case.
- **A tool's own confident answer vs. the real store**: the `multi-memory` MCP
  tools reported zero events/episodes/lessons — a confident, well-formed,
  wrong answer, because they read a store nothing writes to while six real
  episodes existed in a different one. Caught only by refusing to treat a
  clean-looking API response as proof of an empty system.
