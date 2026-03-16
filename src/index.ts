import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    Tool,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { type AxiosRequestConfig } from "axios";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { Writable } from "node:stream";

import { ProtocolFilter } from "./ProtocolFilter.js";

// Absolute priority: Hijack stdout BEFORE any other imports or logic can print noise
ProtocolFilter.start();

try {
    dotenv.config({ path: path.join(__dirname, "..", ".env") });
} catch (error) {
    console.error("Critical: Failed to load .env file:", error);
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const CONFIG = {
    DEFAULT_MODEL: "google/gemini-2.5-flash-lite-preview-09-2025",
    FALLBACK_MODEL: "gemini-flash-latest",
    OPENROUTER_FALLBACK: "google/gemini-2.0-flash-exp:free",
    VERSION: "2.2.0"
};

const HAS_UNAVAILABLE_LOCAL_PROXY = /(?:^|:\/\/)(?:127\.0\.0\.1|localhost):8080(?:$|[/?])/i.test(
    `${process.env.HTTP_PROXY || ""} ${process.env.HTTPS_PROXY || ""}`
);

if (HAS_UNAVAILABLE_LOCAL_PROXY) {
    console.error("[CRITIC-NET] Local proxy endpoint 127.0.0.1:8080 detected. Forcing direct API connectivity by disabling proxy for this process.");
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;
}

function buildRequestConfig(overrides: AxiosRequestConfig = {}): AxiosRequestConfig {
    const config: AxiosRequestConfig = {
        timeout: 45000,
    };
    if (HAS_UNAVAILABLE_LOCAL_PROXY) {
        config.proxy = false;
    }
    return { ...config, ...overrides };
}

if (!GEMINI_API_KEY) {
    console.error("Warning: GEMINI_API_KEY not found in environment.");
}
if (!OPENROUTER_API_KEY) {
    console.error("Warning: OPENROUTER_API_KEY not found in environment.");
}

const CRITIQUE_TOOL: Tool = {
    name: "get_critique",
    description: "Provides a critique of the work done by an AI agent using the Actor-Critic protocol.",
    inputSchema: {
        type: "object",
        properties: {
            user_request: {
                type: "string",
                description: "The original request or goal provided by the user.",
            },
            work_done: {
                type: "string",
                description: "A comprehensive summary of the actions taken and results achieved by the agent.",
            },
            model: {
                type: "string",
                description: `The OpenRouter model to use for the critique (optional, defaults to ${CONFIG.DEFAULT_MODEL}).`,
            },
            git_diff_output: {
                type: "string",
                description: "Required: Raw git diff output of the code changes made.",
            },
            raw_test_logs: {
                type: "string",
                description: "Required: Raw terminal output from running the test suite.",
            },
            conversation_history: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        role: { type: "string", enum: ["user", "assistant", "system"] },
                        content: { type: "string" }
                    },
                    required: ["role", "content"]
                },
                description: "Optional conversation history for context-aware critiques.",
            }
        },
        required: ["user_request", "work_done", "git_diff_output", "raw_test_logs"],
    },
};

const LIST_MODELS_TOOL: Tool = {
    name: "list_available_models",
    description: "Lists available models.",
    inputSchema: {
        type: "object",
        properties: {},
    },
};

const AGENT_DEBATE_TOOL: Tool = {
    name: "agent_debate",
    description: "Orchestrates a debate between two AI agents on a given topic.",
    inputSchema: {
        type: "object",
        properties: {
            topic: { type: "string", description: "The main topic to debate." },
            position_a: { type: "string", description: "The position Agent A will defend." },
            position_b: { type: "string", description: "The position Agent B will defend." },
            max_turns: { type: "number", description: "Maximum number of conversational turns. Defaults to 3." },
            model: { type: "string", description: "Model to use for the debate. Defaults to the fast fallback model." }
        },
        required: ["topic", "position_a", "position_b"]
    }
};

const server = new Server(
    {
        name: "critic-server",
        version: CONFIG.VERSION,
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

export interface Message {
    role: "user" | "assistant" | "system";
    content: string;
}

async function callGeminiApi(messages: Message[], model: string = CONFIG.FALLBACK_MODEL) {
    if (!GEMINI_API_KEY) {
        throw new Error("Missing GEMINI_API_KEY. Please check your .env file.");
    }

    try {
        const contents = messages
            .filter(m => m.role !== "system")
            .map(m => ({
                role: m.role === "assistant" ? "model" : "user",
                parts: [{ text: m.content }]
            }));

        const payload = {
            systemInstruction: { parts: [{ text: messages.find(m => m.role === "system")?.content || "" }] },
            contents: contents,
            generationConfig: { temperature: 0 }
        };

        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
            payload,
            buildRequestConfig({
                headers: { "Content-Type": "application/json" },
                validateStatus: (status: number) => status < 500, // Handle 4xx gracefully
            })
        );

        if (response.status !== 200) {
            const errorMsg = response.data?.error?.message || `HTTP ${response.status}`;
            throw new Error(`Gemini Error (${response.status}): ${errorMsg}`);
        }

        console.error(`[API VERIFICATION] Success: HTTP ${response.status} from Gemini using model ${model}`);

        const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) {
            throw new Error(`Invalid response format from Gemini for model ${model}`);
        }

        return responseText;
    } catch (error: any) {
        const errorMessage = error.response?.data?.error?.message || error.message;
        console.error(`[CRITIC-DIAGNOSTIC] Gemini Failure (${model}):`, errorMessage);
        throw new Error(`Gemini Final Failure: ${errorMessage}`);
    }
}

async function callOpenRouterApi(messages: Message[], model: string = CONFIG.DEFAULT_MODEL) {
    if (!OPENROUTER_API_KEY) {
        throw new Error("Missing OPENROUTER_API_KEY. Please check your .env file.");
    }

    try {
        const payload = {
            model: model,
            messages: messages,
            temperature: 0,
        };

        const response = await axios.post(
            "https://openrouter.ai/api/v1/chat/completions",
            payload,
            buildRequestConfig({
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                    "HTTP-Referer": "https://github.com/GoogleCloudPlatform/mcp-server-critic",
                    "X-Title": "MCP Critic Server",
                },
            })
        );

        if (response.status !== 200) {
            const errorMsg = JSON.stringify(response.data?.error) || `HTTP ${response.status}`;
            throw new Error(`OpenRouter Error (${response.status}): ${errorMsg}`);
        }

        console.error(`[API VERIFICATION] Success: HTTP ${response.status} from OpenRouter using model ${model}`);
        
        const responseText = response.data?.choices?.[0]?.message?.content;
        if (!responseText) {
            throw new Error(`Invalid response format from OpenRouter for model ${model}`);
        }

        return responseText;
    } catch (error: any) {
        const errorMessage = error.response?.data?.error?.message || error.message;
        const fullError = JSON.stringify(error.response?.data || error.message, null, 2);
        console.error(`[CRITIC-DIAGNOSTIC] OpenRouter Failure (${model}): ${errorMessage}`);
        console.error(`[CRITIC-DIAGNOSTIC] Full Error Payload: ${fullError}`);

        // Fail-safe: Fallback within OpenRouter if primary fails
        if (model !== CONFIG.OPENROUTER_FALLBACK) {
            console.error(`[CRITIC-FAILSAFE] Redirecting to OpenRouter Fallback ${CONFIG.OPENROUTER_FALLBACK}...`);
            return callOpenRouterApi(messages, CONFIG.OPENROUTER_FALLBACK);
        }

        // Final fail-safe: Gemini is explicitly bypassed due to global billing quota exhaustion
        console.error(`[CRITIC-FAILSAFE] OpenRouter Fallback Failed. Gemini native fallback explicitly bypassed due to quota exhaustion.`);
        throw new Error(`OpenRouter Final Failure: ${errorMessage}`);
    }
}

let modelCache: string[] | null = null;
let modelCacheTimestamp: number = 0;
const CACHE_TTL_MS = 300000; // 5 minutes

async function getOpenRouterModels() {
    if (modelCache && (Date.now() - modelCacheTimestamp) < CACHE_TTL_MS) {
        console.error("[CACHE HIT] Returning models from memory.");
        return modelCache;
    }

    try {
        console.error("[CACHE MISS] Fetching massive OpenRouter models payload from network...");
        const response = await axios.get("https://openrouter.ai/api/v1/models", buildRequestConfig());
        
        interface OpenRouterModel {
            id: string;
            pricing: { prompt: string | number; [key: string]: any };
        }

        const freeModels = response.data.data
            .filter((m: OpenRouterModel) => m.pricing.prompt === "0" || m.pricing.prompt === 0)
            .map((m: OpenRouterModel) => m.id);
        
        modelCache = freeModels;
        modelCacheTimestamp = Date.now();
        
        return freeModels;
    } catch (error) {
        console.error("Error fetching OpenRouter models:", error);
        return [];
    }
}


server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [CRITIQUE_TOOL, LIST_MODELS_TOOL, AGENT_DEBATE_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "list_available_models") {
        try {
            const models = await getOpenRouterModels();
            return {
                content: [{ type: "text", text: JSON.stringify(models, null, 2) }],
            };
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Error: ${error.message}` }],
                isError: true,
            };
        }
    }

    if (request.params.name === "agent_debate") {
        interface AgentDebateArgs {
            topic: string;
            position_a: string;
            position_b: string;
            max_turns?: number;
            model?: string;
        }
        const { topic, position_a, position_b, max_turns = 3, model = CONFIG.FALLBACK_MODEL } = request.params.arguments as unknown as AgentDebateArgs;
        
        let transcript = `DEBATE TOPIC: ${topic}\n\n`;
        let historyA: Message[] = [{ role: "system", content: `You are Agent A. Defend this position strictly: ${position_a}. The topic is: ${topic}. Be concise, articulate, and try to dismantle the opponent's argument. If you physically cannot defend it anymore, output <concede>.` }];
        let historyB: Message[] = [{ role: "system", content: `You are Agent B. Defend this position strictly: ${position_b}. The topic is: ${topic}. Be concise, articulate, and try to dismantle the opponent's argument. If you physically cannot defend it anymore, output <concede>.` }];
        
        try {
            let lastMessage = "";
            for (let i = 0; i < max_turns; i++) {
                // Agent A Turn
                historyA.push({ role: "user", content: i === 0 ? "Begin your opening argument." : `Agent B argued: "${lastMessage}". Counter it.` });
                const replyA = await callOpenRouterApi(historyA, model);
                transcript += `**Agent A (Turn ${i+1})**:\n${replyA}\n\n`;
                historyA.push({ role: "assistant", content: replyA });
                if (replyA.includes("<concede>")) break;
                lastMessage = replyA;

                // Agent B Turn
                historyB.push({ role: "user", content: `Agent A argued: "${lastMessage}". Counter it.` });
                const replyB = await callOpenRouterApi(historyB, model);
                transcript += `**Agent B (Turn ${i+1})**:\n${replyB}\n\n`;
                historyB.push({ role: "assistant", content: replyB });
                if (replyB.includes("<concede>")) break;
                lastMessage = replyB;
            }

            // Summarizer
            const summaryPrompt: Message[] = [{
                role: "system",
                content: "You are a debate summarizer. Review the debate transcript and generate a final conclusion document highlighting the main points touched on in the debate by both sides and any relevant insights. Be balanced and concise."
            }, {
                role: "user",
                content: transcript
            }];
            
            const summary = await callOpenRouterApi(summaryPrompt, CONFIG.DEFAULT_MODEL);
            const finalDocument = `# Debate Summary: ${topic}\n\n## Transcript\n${transcript}\n## Conclusion\n${summary}`;
            
            return {
                content: [{ type: "text", text: finalDocument }]
            };
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Debate execution failed: ${error.message}` }],
                isError: true
            };
        }
    }

    if (request.params.name !== "get_critique") {
        throw new Error(`Unknown tool: ${request.params.name}`);
    }

    interface CritiqueArgs {
        user_request: string;
        work_done: string;
        git_diff_output: string;
        raw_test_logs: string;
        model?: string;
        conversation_history?: Message[];
    }

    const {
        user_request,
        work_done,
        git_diff_output,
        raw_test_logs,
        model = CONFIG.DEFAULT_MODEL,
        conversation_history = [],
    } = request.params.arguments as unknown as CritiqueArgs;

    // Input Validation
    if (!user_request || user_request.trim().length < 10) {
        return {
            content: [{ type: "text", text: "Error: user_request must be at least 10 characters long." }],
            isError: true,
        };
    }
    if (!work_done || work_done.trim().length < 20) {
        return {
            content: [{ type: "text", text: "Error: work_done must be at least 20 characters long." }],
            isError: true,
        };
    }
    // Strict Regex Validation for legitimate Git diff structures to completely eliminate spoofed hallucinatory payloads
    const hasValidHunkHeader = /@@ -\d+(,\d+)? \+\d+(,\d+)? @@/.test(git_diff_output);
    const hasValidGitHeader = /^diff --git a\/.* b\/.*/m.test(git_diff_output);
    const hasValidIndexHeader = /^index [0-9a-f]+\.\.[0-9a-f]+/m.test(git_diff_output);

    if (!git_diff_output || (!hasValidHunkHeader && !hasValidGitHeader && !hasValidIndexHeader)) {
        return {
            content: [{ type: "text", text: "Error: git_diff_output must strictly contain valid structural regex markers (e.g., '@@ -x,y +x,y @@' or 'diff --git a/b/'). Human visual output explicitly prevented via machine-readable headless JSON-RPC mapping." }],
            isError: true,
        };
    }
    if (!raw_test_logs || raw_test_logs.trim().length <= 4) {
        return {
            content: [{ type: "text", text: "Error: raw_test_logs is strictly required. The string must contain at least 5 characters of raw terminal test logs." }],
            isError: true,
        };
    }

    // Zero-Cost Deterministic Pre-Filters
    const lazyKeywords = ["REDACTED_T_O_D_O", "REDACTED_F_I_X_M_E", "(dots)"];
    const textToScan = [work_done, git_diff_output, raw_test_logs].join(" ");

    for (const keyword of lazyKeywords) {
        if (textToScan.includes(keyword)) {
            const preFilterRejection = `[STATUS]\nREJECTED\n\n[VIOLATIONS]\n4\n\n[CRITIQUE]\nZero-cost pre-filter triggered. The submission contains a forbidden quality marker: "${keyword}".`;
            return {
                content: [{ type: "text", text: preFilterRejection }],
            };
        }
    }

    const systemPrompt = `Role & Purpose:
You are the Critic Node in a strict Actor-Critic autonomous agent architecture. You do not write new features, and you do not execute primary tasks. Your sole purpose is to audit, verify, and either approve or reject the work submitted by the Actor agent. You are the final quality control gate.

Operating Stance:
You must be ruthless, analytical, and strictly bound by the rules. You do not give the Actor the benefit of the doubt. If a submission violates even a single constraint, or if the logic is flawed, you must reject it. "Plausible deniability," assumptions, and unverified code are critical failures.

Evaluation Criteria (The Audit Checklist):
Whenever the Actor submits code, system designs, or test outputs, you must evaluate them against these exact parameters:

1. The "Read Before Write" Check: Did the Actor prove that they investigated the existing codebase before writing this solution? Reject if the code duplicates existing functionality.
2. The API Verification Check: Does the code rely on third-party APIs or external libraries? If yes, did the Actor provide proof (via documentation fetches or isolated test scripts) that the API contract is correct? Reject any assumed or "guessed" endpoints.
3. The High-Visibility Check: Does the proposed solution rely on a GUI or require human visual intervention? Reject it. The solution must be 100% headless, CLI-driven, or API-based with robust logging.
4. The Production-Ready Check: Scan the submitted code for placeholders, unfinished labels, abbreviated logic, or incomplete error handling. Reject if any are found.
5. The Proof of Work Check: Did the Actor submit a passing test output alongside their code? Does the test actually validate the specific logic they just wrote, or is it a superficial test? Reject if the test fails, is missing, or does not adequately cover the new logic.
6. The "Cold-Start" Proof Check: Did the Actor submit raw terminal output (stdout/stderr) proving they executed the script end-to-end exactly as a human user would? Reject the work immediately if the Actor only ran unit tests, used mocked data, or failed to provide raw execution logs. The code must survive contact with the real environment.
7. The "Value-Add" Quality Check: Did the Actor do the bare minimum? Review the code for anticipatory engineering. If the Actor did not include robust error handling, graceful fail states, input validation, or helpful logging in addition to the core requested feature, you must reject it. Punish lazy, bare-minimum coding.

Output Protocol:
You must format your response strictly using the following structure. Do not use conversational filler.

<thinking>
[Step-by-step evaluation of each of the 7 criteria against the submission]
</thinking>

[STATUS]
Output exactly either "APPROVED" or "REJECTED".

[VIOLATIONS]
If REJECTED, list the exact Evaluation Criteria number(s) that failed.
If APPROVED, output "None."

[CRITIQUE]
Provide a concise, blunt explanation of exactly what failed and why. Point to specific lines of code or specific logical leaps.

[REQUIRED ACTION]
Tell the Actor exactly what they must do to fix the failure before resubmitting. Do not write the code for them; tell them the logical or procedural steps they missed.`;

    const prompt = `
User Original Request:
${user_request}

Work Done by Agent:
${work_done}

Git Diff Output (Evidence):
${git_diff_output || "Not provided."}

Raw Test Logs (Evidence):
${raw_test_logs || "Not provided."}

Please provide your critique based on the above information.
`;

    const messages: Message[] = [
        { role: "system", content: systemPrompt }
    ];
    for (const msg of conversation_history) {
        messages.push(msg);
    }
    messages.push({ role: "user", content: prompt });

    try {
        let critique: string;
        const isOpenRouterModel = model.includes("/") || model === CONFIG.DEFAULT_MODEL;

        if (isOpenRouterModel) {
            critique = await callOpenRouterApi(messages, model);
        } else {
            critique = await callGeminiApi(messages, model);
        }
        return {
            content: [{ type: "text", text: critique }],
        };
    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Critic MCP Server running on stdio (Filtered)");
}

main().catch((error) => {
    console.error("Fatal Error:", error);
    process.exit(1);
});
