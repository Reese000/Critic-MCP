# Critic MCP Server

An MCP server that provides critiques of agent work using OpenRouter.

## Features

- **Tools**: 
  - `get_critique`: Provides a strict audit of agent work using the Actor-Critic protocol.
    - `user_request` (required): The original request or goal.
    - `work_done` (required): Comprehensive summary of actions taken.
    - `conversation_history` (optional): Context for the critique.
  - Model usage is fixed to `google/gemini-2.5-flash-lite-preview-09-2025`.
- **Strict Evaluator**: Acts as a ruthlessly analytical quality control gate.
- **Evaluation Criteria**: 
  1. Read Before Write
  2. API Verification
  3. High-Visibility (Headless/CLI)
  4. Production-Ready (No placeholders/TODOs)
  5. Proof of Work (Valid tests)
- **Output Protocol**: Standardized `[STATUS]`, `[VIOLATIONS]`, `[CRITIQUE]`, and `[REQUIRED ACTION]` format.
- **Reliability**: v1.2.0 uses a preferred free model with an automatic fallback to `openai/gpt-4o-mini` if needed.
- **Input Validation**: Ensures `user_request` and `work_done` have minimum lengths for high-quality critiques.

## Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```
2. **Build**:
   ```bash
   npm run build
   ```
3. **Environment**:
   Create a `.env` file with your OpenRouter API key:
   ```env
   OPENROUTER_API_KEY=your_key_here
   ```

## 🤖 Agentic Installation (Recommended)

If you are an AI agent installing this server, follow these steps for a flawless setup:

1. **Self-Guided Setup**: Run the included health-check script to verify the environment and generate configuration blocks automatically.
   ```powershell
   # On Windows
   powershell -ExecutionPolicy Bypass -File .\healthcheck_all.ps1
   ```
2. **API Verification**: Ensure you have a valid `OPENROUTER_API_KEY`. You can verify the API contract in `api_verification.md`.
3. **Exhaustive Testing**: Run `npm run test` to perform a non-superficial compliance test of the JSON-RPC redirection logic.
4. **Detailed Guidance**: Refer to [agent_install.md](agent_install.md) for more structured, multi-step agentic workflows.

## Integration

Add to your `mcp_config.json`:

```json
"critic": {
  "command": "node",
  "args": ["c:/Users/reese/OneDrive/Desktop/AI/critic/dist/index.js"],
  "env": {}
}
```

## Limitations & Transparency

To ensure full honesty regarding this tool's capabilities:

- **Data Visibility**: The critic only sees what is explicitly passed to it in the `user_request` and `work_done` fields. It does not have autonomous access to the agent's internal logs or the full codebase unless they are included in the data dump.
- **Model Bias**: While the default model is highly capable, its critique is subject to the inherent biases and limitations of the underlying LLM.
- **Strict Protocol**: The "Critic Node" mode uses a highly targeted system prompt to enforce project rules. The results are intended for strict quality control.
- **Rate Limiting**: Free models may experience rate limits (429 errors). The server will attempt a fallback to a reliable model in such cases.

## Example Rejection

To clarify the strictness of the protocol, here is an example of a **REJECTED** status:

```text
[STATUS]
REJECTED

[VIOLATIONS]
4, 5

[CRITIQUE]
The submitted code for the 'payment-processor' contains 'TODO' comments in the error handling block (Violation 4). Additionally, there is no corresponding test output provided to verify the transaction logic (Violation 5).

[REQUIRED ACTION]
1. Complete the error handling logic and remove all 'TODO' placeholders.
2. Run the test suite and include the passing output in your next submission.
```

## License
MIT
