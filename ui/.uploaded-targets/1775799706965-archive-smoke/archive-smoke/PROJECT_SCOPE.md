# Vigilance-OS Project Scope

Status: Source of truth for product intent and delivery scope

This document captures the real intent for Vigilance-OS after product clarification. It should be treated as the primary scope document for the project and can supersede the older, more aspirational requirements in `VIGILANCE_REQUIREMENTS.md` when tradeoffs need to be made.

## 1. Product Intent

Vigilance-OS is meant to be the beginning of a real security product, not a hackathon-only demo.

The project should still be strong enough to compete for the Nosana x ElizaOS hackathon, but the deeper goal is to build a credible foundation for a product that could continue after the hackathon as a real platform or startup.

The product should make judges and technical users think:

"This already works as a serious security workflow, and it can clearly grow into a real product."

## 2. Core Product Goals

These goals are all important, in this order of truthfulness:

1. Build something that can credibly find real security issues, not just polished hypotheses.
2. Make the workflow strong enough to win or place well in the hackathon.
3. Keep the architecture clean enough to extend into a startup-grade product later.

## 3. Failure Modes To Avoid

The worst outcomes, in order:

1. A flashy system that looks impressive but does not really audit code.
2. A system that fails deployment or submission reliability even if the concept is good.
3. A system that is technically capable but presented weakly enough that judges miss the value.

The product should never devolve into fake agent theater.

## 4. Non-Negotiable Product Feel

Vigilance-OS should feel like:

- A real security workflow
- Evidence-driven
- Review-aware
- Structured and extensible
- Honest about confidence and limitations

It should not feel like:

- A generic "AI security copilot"
- A UI wrapped around ungrounded LLM guesses
- Multi-agent theater with no meaningful separation of responsibilities

## 5. Golden Path

The single most important end-to-end flow for submission is:

1. A user submits a target through the UI.
2. The system requests explicit approval before starting a deeper audit.
3. The audit runs.
4. A reviewer step attempts to reduce false positives.
5. The system returns a report with evidence, reasoning, and a reproducible PoC when feasible.

This is the path that must feel real and dependable.

## 6. Delivery Channels

Both of these are required in the MVP:

- Web UI
- Telegram

The UI is the main operating surface.

Telegram must be a real control and notification surface, not just a stub.

## 7. Scout Scope

The Scout should discover targets across all major Immunefi categories:

- Blockchain / DLT
- Smart Contract
- Websites and Applications

However, discovery breadth is not the same as audit-depth parity.

For submission, Scout behavior should be:

- Scheduled polling
- Manual refresh support
- Dedupe of discovered targets
- Extraction of scope and reward context
- Alerting to UI and Telegram

True continuous monitoring is a post-submission improvement unless it becomes easy and reliable.

## 8. Audit Depth Strategy

### Submission-Day Truth

The product should be honest enough to defend this statement:

"We deeply audit one category very well, and discover the others."

In practice, the intended submission wedge is:

1. Solana / Rust depth first
2. Solidity / EVM depth second
3. Websites / apps repository analysis as static analysis only in this version

### Important Scope Principle

All categories should be discoverable by the Scout.

Not all categories need the same audit depth by submission day.

## 9. Hard Coverage For Submission

### Solana / Rust priority classes

The engine should be genuinely strong on these:

- Oracle, price, and accounting logic flaws
- Account ownership validation bugs
- Signer and authority mistakes
- PDA derivation and seed misuse
- CPI privilege escalation

### Solidity / EVM priority classes

The engine should be genuinely strong on these:

- Oracle and price manipulation
- Access control and authorization flaws
- Accounting and invariant violations
- Upgradeability and initializer mistakes
- Unsafe external calls, approvals, token handling, and transfer-flow bugs

### Additional classes

The system can attempt broader coverage, but these are the core classes to optimize around for submission and early product credibility.

## 10. Websites And Apps Scope

For this version:

- Static repository analysis should work
- Lightweight reasoning about exposed secrets, auth flaws, tenant isolation, insecure flows, and unsafe business logic is desirable
- Live website testing is explicitly cut first if time pressure appears

Dynamic web testing is not required for submission.

## 11. Evidence Standard

The engine must favor grounded findings over polished speculation.

### Critical / High findings

Critical and high severity findings should require runnable or replayable evidence whenever feasible, such as:

- Foundry test
- Hardhat script
- Anchor test or Solana exploit harness
- Reproducible request sequence
- Concrete replay steps

### Medium / Low findings

Medium and low severity findings may be published with:

- Strong code-path proof
- Reviewer confidence
- Exact affected code references
- Suggested reproduction path or validating test

### Findings must include

- What is affected
- Why it was flagged
- Confidence level
- Reproducible steps when feasible
- Suggested remediation
- Scope or blast-radius estimation for critical/high if data is available

## 12. Reviewer Policy

The Reviewer is not decorative.

Reviewer behavior should follow this rule:

- Be strict for critical and high severity reports
- Be more tolerant for medium and low severity reports if uncertainty is clearly labeled

The system should reduce false positives aggressively for high-impact findings without suppressing all useful medium-confidence findings.

## 13. Confidence And Publishing Policy

The platform should not silently discard uncertain results that may still be useful.

Preferred behavior:

- Review-passed findings should appear in the main findings view
- Lower-confidence or not-yet-cleared findings may appear in a separate review queue or clearly labeled secondary state

Confidence should be visible to users.

## 14. Target Input Priority

The intended target priority is:

1. Public GitHub repositories
2. Private GitHub repositories
3. Immunefi-discovered programs
4. Local folders

### Practical ingestion priority for implementation

To ship truthfully and fast, implementation should likely start with:

1. Public GitHub URL
2. Local folder path
3. Zip upload
4. Private GitHub authentication via token or app

This is an implementation sequencing choice, not a product preference statement.

## 15. Telegram MVP Requirements

Telegram must support the following at minimum:

- Alert on newly discovered Scout targets
- Alert when an audit finishes
- `/approve`
- `/report <audit>`
- `/findings`

Nice to have:

- `/status <audit>`

Telegram should be useful enough that the user can monitor and approve work without being in the UI at all times.

## 16. Blast Radius And Context

For critical and high findings, if supporting data is available, the system should attempt to estimate:

- Funds at risk
- Scope of affected users or wallets
- Severity rationale
- Why the issue matters in protocol context

Deep scraping and richer hidden-data estimation is a post-hackathon extension unless it comes together cheaply.

## 17. Architecture Principles

The system should remain clean enough to grow into a public platform later.

Architecture should prioritize:

- Real separation of stages where it improves clarity or debugging
- Clear audit job lifecycle and state transitions
- Artifact persistence
- Deterministic review gates where possible
- Honest interfaces between Scout, approval, audit, review, and publishing

Multi-agent structure is allowed, but only where it serves product clarity and reliability.

## 18. Things To Cut First Under Time Pressure

If time pressure forces major cuts, cut in roughly this order:

1. Live website testing
2. Full real-time continuous monitoring
3. Rich private repo authentication flows
4. Deep cross-category parity
5. Advanced blast-radius estimation beyond readily available data

Do not cut:

- Evidence quality for important findings
- The golden path
- Review logic
- UI and Telegram being real surfaces

## 19. Demo Positioning

Judges should remember:

"It watches Immunefi, finds targets, asks approval, audits real repos, and returns reviewed findings with reproducible proof."

The demo should also show that a custom GitHub target can be submitted through the UI and processed through the same workflow.

## 20. Demo Target Guidance

The product should ideally be demonstrated on:

- One strong Solana / Rust target
- One strong Solidity / EVM target
- One controlled or intentionally vulnerable example for reliable proof generation

`theredguild/damn-vulnerable-defi` is a strong EVM-friendly controlled example.

## 21. Success Criteria For Submission

The build is successful for submission if:

1. The golden path works reliably from target submission to report delivery.
2. The findings feel grounded and not obviously LLM-invented.
3. Telegram and UI both participate meaningfully in the workflow.
4. The architecture looks extendable rather than hacky.
5. The project is honest about where it is deep and where it is still growing.

## 22. Post-Hackathon Expansion Areas

These are valid future directions, but not required to claim MVP success:

- True continuous monitoring
- Rich private repo onboarding via GitHub App or PAT
- Zip ingestion and broader enterprise target onboarding
- Dynamic website testing
- Deeper on-chain blast-radius estimation
- Broader cross-category audit parity
- Multi-tenant public platform support

## 23. Final Product Principle

If a tradeoff must be made, prefer:

- Credible audit depth over flashy breadth
- Honest confidence over false certainty
- Evidence over style
- Clean foundations over hackathon-only shortcuts

Vigilance-OS should be impressive because it is believable, not because it is loud.
