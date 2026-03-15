import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runPerformanceTest() {
    console.log("=== BEGIN PERFORMANCE EVALUATION ===");

    const serverPath = path.join(__dirname, '..', 'dist', 'index.js');
    console.log(`Target Server: ${serverPath}`);

    const server = spawn('node', [serverPath], {
        env: { ...process.env, OPENROUTER_API_KEY: 'test-key' }
    });

    let pendingResolvers: { [id: number]: (data: any) => void } = {};
    let isReady = false;

    server.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
            try {
                const json = JSON.parse(line);
                if (json.id && pendingResolvers[json.id]) {
                    pendingResolvers[json.id](json);
                    delete pendingResolvers[json.id];
                }
            } catch (e) {
                // Ignore stdout noise if any (shouldn't be any due to filter)
            }
        }
    });

    server.stderr.on('data', (data) => {
        // Echo stderr to see the cache hit/miss logs
        process.stderr.write(data);
    });

    // Initialize MCP Session
    const initReq = new Promise(resolve => { pendingResolvers[1] = resolve; });
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "perf-test", version: "1" } } }) + "\n");
    await initReq;
    server.stdin.write("   " + JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
    console.log("[TEST] Server initialized.");

    // Execution 1: Uncached
    console.log("\n[TEST] Executing Call 1: Uncached (list_available_models)...");
    const start1 = Date.now();
    const req1 = new Promise(resolve => { pendingResolvers[2] = resolve; });
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_available_models", arguments: {} } }) + "\n");
    await req1;
    const end1 = Date.now();
    const duration1 = end1 - start1;
    console.log(`[RESULT] Uncached Call Latency: ${duration1}ms`);

    // Execution 2: Cached
    console.log("\n[TEST] Executing Call 2: Cached (list_available_models)...");
    const start2 = Date.now();
    const req2 = new Promise(resolve => { pendingResolvers[3] = resolve; });
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_available_models", arguments: {} } }) + "\n");
    await req2;
    const end2 = Date.now();
    const duration2 = end2 - start2;
    console.log(`[RESULT] Cached Call Latency: ${duration2}ms`);

    server.kill();

    // Evaluation Criteria: Cached call must be lightning fast (under 100ms)
    console.log("\n=== PERFORMANCE AUDIT ===");
    console.log(`Speedup multiplier: ${(duration1 / duration2).toFixed(2)}x`);
    
    // We allow a very brief buffer, but it should realistically be <10ms for an in-memory fetch.
    if (duration2 < 100) {
        console.log(`[PASS] Cache evaluation successful. Latency dropped to ${duration2}ms.`);
        process.exit(0);
    } else {
        console.error(`[FAIL] Cached call took ${duration2}ms. Expected < 100ms. Caching failed or logic is sub-optimal.`);
        process.exit(1);
    }
}

runPerformanceTest().catch(err => {
    console.error("FATAL PERFORMANCE TEST ERROR:", err);
    process.exit(1);
});
