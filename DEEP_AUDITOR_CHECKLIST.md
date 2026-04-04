## Deep Auditor Checklist

Status: Ranked implementation checklist for the audit-engine pivot

This checklist is the execution companion to `DEEP_AUDITOR_PIVOT.md`.

Legend:

- `[ ]` not started
- `[~]` in progress
- `[x]` completed

## 1. Repo Ingestion Reliability

- [ ] Make GitHub cloning reliable enough for repeated live tests
- [ ] Add retry / shallow clone / clearer failure surfaces
- [ ] Preserve target materialization metadata so failed runs are diagnosable
- [ ] Keep local-folder ingestion as a first-class path

Done when:

- remote GitHub targets no longer fail unpredictably during normal smoke tests

## 2. Repo Indexer

- [ ] Build a repo index structure separate from the current flat `sourceFiles` list
- [ ] Capture important files, modules, imports, contracts, programs, instructions, and configs
- [ ] Extract security-relevant symbols:
  - contracts
  - libraries
  - interfaces
  - Solana `Accounts` structs
  - PDA helpers
  - auth-like modifiers / constraints
  - external call sites
- [ ] Store the index on the job so UI and later passes can inspect it

Done when:

- the auditor can reason from a whole-repo index instead of a single capped file blob

## 3. Security Neighborhood Retrieval

- [ ] Create retrieval rules for Solidity / EVM neighborhoods
- [ ] Create retrieval rules for Solana / Rust neighborhoods
- [ ] Expand around hotspots by related imports, helpers, auth code, storage/state, and tests
- [ ] Replace the current flat "top files only" context with neighborhood bundles

Done when:

- the model receives focused code neighborhoods derived from repo-wide awareness

## 4. Multi-Finding Audit Output

- [ ] Remove the "ONE concrete vulnerability finding" constraint from the audit flow
- [ ] Change the audit engine to return multiple candidate findings
- [ ] Add dedupe and ranking across candidate findings
- [ ] Preserve weaker but grounded findings for review instead of dropping them silently

Done when:

- one repo scan can produce a ranked list of candidate findings instead of a single report

## 5. Exploratory Discovery Beyond Analyzer Hits

- [ ] Add a model-led exploratory pass over the repo index
- [ ] Ask the model to nominate suspicious neighborhoods even when analyzers are silent
- [ ] Merge exploratory candidates with analyzer-seeded candidates
- [ ] Track which findings came from analyzers, exploration, or both

Done when:

- the audit engine is no longer structurally blind to anything analyzers did not flag first

## 6. Evidence Honesty

- [ ] Replace optimistic proof labeling with honest states
- [ ] Introduce explicit proof states such as:
  - `template_only`
  - `guided_replay`
  - `validated_replay`
  - `executed_poc`
- [ ] Stop treating long template text as runnable proof
- [ ] Update UI labels to reflect the new evidence states

Done when:

- the system never overstates how verified a finding really is

## 7. Target-Specific PoC Generation

- [ ] Upgrade generic PoC templates into target-specific harnesses where feasible
- [ ] Fill in real imports, real functions, real paths, and real contract/program names
- [ ] Separate "draft exploit harness" from "validated replay"
- [ ] Prefer concrete replay steps when executable harnesses are not feasible

Done when:

- PoC output feels tied to the target repo rather than to a vulnerability-class template

## 8. Reviewer Independence

- [ ] Make the reviewer search for disconfirming evidence first
- [ ] Reduce framing leakage from the auditor into the reviewer
- [ ] Add checks for standard library/framework protections before verdict
- [ ] Preserve grounded-but-uncertain findings in review without auto-publishing them

Done when:

- the reviewer materially lowers false positives instead of mostly reflecting auditor assumptions

## 9. UI And Report Evolution

- [ ] Update findings UI to show multiple candidate findings per job
- [ ] Surface neighborhood source, evidence source, and proof state
- [ ] Show why a finding was downgraded, queued, or discarded
- [ ] Keep the operator flow understandable even as multi-finding jobs appear

Done when:

- the UI still feels clear after the engine moves from one finding to many

## 10. Demo Hardening

- [ ] Rerun the controlled Solana demo target with the new multi-finding path
- [ ] Rerun the controlled EVM demo target with the new multi-finding path
- [ ] Capture one or two findings that clearly show grounded reasoning and honest evidence labels
- [ ] Update the demo script so the judges see the real engine behavior, not a misleading story

Done when:

- the submission can be defended honestly in code and in the demo video

## 11. Ranked Next Build Order

This is the recommended implementation order:

1. Repo ingestion reliability
2. Repo indexer
3. Security neighborhood retrieval
4. Multi-finding audit output
5. Evidence honesty
6. Exploratory discovery beyond analyzer hits
7. Reviewer independence
8. Target-specific PoC generation
9. UI/report evolution
10. Demo hardening

## 12. Immediate Next Task

Start with:

- repo ingestion reliability
- repo index design
- replacing the single-finding audit contract with candidate-finding output

Those three changes unlock almost everything else.

