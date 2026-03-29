# 🛡️ PROJECT: Vigilance-OS (Nosana x ElizaOS Hackathon Build)
**Target Infrastructure:** Nosana Decentralized GPU Network
**Hackathon Deadline:** April 14, 2026, 11:01 AM UTC

---

## 1. HACKATHON STRICT COMPLIANCE
- Fork the official starter repository: `https://github.com/nosana-ci/agent-challenge`.
- Framework: ElizaOS v2 (TypeScript).
- Runtime: Node.js 23+ (Strict requirement).
- AI Model: Hardcoded to use `Qwen3.5-27B-AWQ-4bit` via the provided Nosana hosted endpoint.
- Custom Frontend/UI: React/Next.js dashboard (Mandatory requirement).
- Containerization: `Dockerfile` covering agent, UI, and testing.
- Deployment Config: `nosana.yaml` targeting Nosana GPU grid.

---

## 2. SYSTEM ARCHITECTURE: THE TRINITY PIPELINE
### Stage 1: The Scout (Discovery & Context Librarian)
- Integration: `infosec-us-team/immunefi-mcp` + fallback web scraper.
- Target Categories: `Blockchain/DLT`, `Smart Contract`, `Websites and Applications`.
- Librarian Function: Extract "Impacts in Scope" and "Rewards" into agent's short-term memory (RAG).

### Stage 2: Human-in-the-Loop (HITL) Gate
- Client: Discord or Telegram ElizaOS client.
- Action: Alert user before executing compute-heavy audits.
- Blocker: Pause context until `/approve` command is received.

### Stage 3: The Auditor (Hunter) & Reviewer (Skeptic)
- Auditor: Clones target repo, analyzes code using Qwen3.5, generates vulnerability report & PoC (Foundry/Hardhat).
- Reviewer: Adversarial persona reviewing findings to find defensive code missed by the Auditor.
- Consensus: Report/PoC only sent to UI/Telegram if Reviewer fails to debunk the finding.

---

## 3. FRONTEND UI
- Category selection toggles.
- Live "Scout Feed" showing Immunefi monitoring.
- "Findings Gallery" for reports and PoCs.

---

## 4. STOP & ASK TRIGGERS
- Chat Bot Token (Telegram/Discord) and RPC URLs.
- Stake/Star confirmation reminder.
- Builder credits check.
- `DEMO_MODE=true` for video demonstration.
