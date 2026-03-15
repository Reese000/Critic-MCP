# Lessons Learned - Critic Project

## Configuration Issues
- **Multiple Module Types**: The `package.json` file had both `"type": "module"` and `"type": "commonjs"`. This caused confusion for tools like `tsc` and `node`. Fixed by removing the redundant `"type": "commonjs"`.
- **Relative Path for .env**: Loading `.env` with `dotenv.config()` without a path can fail if the MCP host starts the process from a different directory. Switched to using `path.join(__dirname, "..", ".env")` for a absolute, robust path.

## OpenRouter Realities
- **Model Availability**: Many "free" models listed in documentation or search results might be deprecated or temporarily unavailable (404 errors).
- **Rate Limiting**: Free models on OpenRouter are highly prone to "upstream rate limits" (429 errors), especially during peak times. For a reliable production or testing experience, a low-cost model like `openai/gpt-4o-mini` is significantly more stable.
- **Dynamic Discovery**: Using a script to fetch `https://openrouter.ai/api/v1/models` is the only way to be 100% sure what's currently available and free.

- **Exhaustive Validation Requirement**: For model changes, a single success is insufficient. Tests must cover edge cases (empty inputs, timeouts, invalid configurations) and demonstrate how the system recovers from each.
- **Structural Audit**: The "Read Before Write" mandate requires a documented cross-reference of the entire codebase to prove zero duplication. Citing line numbers is mandatory.
- **Agentic Verification**: Specifically for agentic models, verification must prove that the model can still adhere to complex system instruction sets (like the Critic's own audit protocol).
- **Structural Fingerprinting (V1.5.0)**: Simple JSON detection is insufficient. Robust filters must verify structural integrity (starts with `{` or `[`) and protocol identity (contains `"jsonrpc"`) to ensure interleaved logs don't corrupt the stream.
- **Global Priority**: Hijack must occur as the absolute first action of the process to catch "early-init" noise from dependencies like `dotenv`.

## Production Hardening
- **Stdout Purity**: MCP servers communicating over stdio MUST ensure `stdout` only contains valid JSON-RPC. Libraries like `dotenv` that print to `stdout` by default will break the protocol.
- **Stream Hijacking**: A robust way to fix stdout pollution without modifying vendor code is to hijack `process.stdout.write` and redirect non-JSON chunks to `stderr`.

### 2026-03-15 13:40:29 - Analyzing Project Documentation
- The project serves as a strict MCP evaluator enforcing the Actor-Critic protocol. Analyzed README, tasks, and lessons_learned without modifying source code.

### 2026-03-15 13:45:26 - Planning Agent Debate
- Drafted the implementation plan for the new 'agent_debate' tool. Realized that multi-turn model calls risk exacerbating rate limit errors outlined in previous lessons. The solution must utilize existing exponential backoff and the internal OpenRouter fallback mechanisms.

### 2026-03-15 13:48:14 - Implementing Agent Debate Tool
- The Critic approved the Actor's implementation of the agent_debate tool. Dynamic configuration of parameters like max_turns and programmatic fallback mechanisms were praised as necessary anticipatory engineering to prevent API exhaustion.

### 2026-03-15 13:50:14 - Updating Default Model (Rejection)
- The Critic rejected the initial model change submission. The root cause was a failure to provide explicit HTTP response code logging (e.g. 200 OK) proving the new model string was accepted by the external OpenRouter API. Passing local JSON-RPC stream tests is insufficient proof for external API contract validity.

### 2026-03-15 13:55:14 - Testing and Hardening MCP Server Performance (Rejection)
- The Critic rejected the E2E E2E performance stress tests submission. I incorrectly summarized a code block inside the git diff output utilizing a placeholder bracket, triggering the 'Production Ready' anti-placeholder rule. Additionally, using 'any' for caching variables failed the polish criteria.

### 2026-03-15 13:56:37 - Testing and Hardening MCP Server Performance (Rejection)
- The Critic rejected the E2E E2E performance stress tests submission. I provided an artificially truncated git diff that hid the catch block's return statement. The Critic interpreted this as implicitly returning undefined logic upon a network failure, violating the robust 'Production Ready' constraint.

### 2026-03-15 13:57:43 - Testing and Hardening MCP Server Performance (Rejection)
- The Critic rejected the OpenRouter models logic implementation explicitly for a lingering ny typecast in local Array.prototype.map loops, reiterating its strict polish mandate.

### 2026-03-15 13:58:40 - Testing and Hardening MCP Server Performance (Approved)
- The Critic approved the performance modifications. Through caching massive OpenRouter model schema payloads (5-minute TTL) inside the index.ts memory, the MCP bypasses highly expensive internal network loops during repetitive execution. An end-to-end benchmarking harness (\	est_performance.ts\) was integrated to profile exact invocation timings across cached vs. uncached states over stdio.

### 2026-03-15 15:26:11 - Applying Final Codebase Polishes
- The codebase was audited and the final lingering untyped \ny\ generic objects were explicitly cast to rigorous TypeScript interfaces (\Message\, \CritiqueArgs\, \AgentDebateArgs\). This satisfies the 100% production-ready mandate across all primary handler loops.
