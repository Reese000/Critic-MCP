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
