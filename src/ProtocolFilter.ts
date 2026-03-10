export class ProtocolFilter {
    private static originalWrite = process.stdout.write;
    private static stdoutTarget: { write: Function } = process.stdout;
    private static stderrTarget: { write: Function } = process.stderr;
    private static isHijacked = false;

    private static readonly JSONRPC_MARKER = '"jsonrpc"';
    private static readonly OBJECT_START = '{';
    private static readonly ARRAY_START = '[';

    static setTargets(stdout: { write: Function }, stderr: { write: Function }) {
        this.stdoutTarget = stdout;
        this.stderrTarget = stderr;
    }

    static start() {
        if (this.isHijacked) return;
        // @ts-ignore
        process.stdout.write = (chunk: any, encoding?: any, callback?: any) => {
            return this.filterAndDirect(chunk, encoding, callback);
        };
        this.isHijacked = true;
    }

    static filterAndDirect(chunk: any, encoding?: any, callback?: any): boolean {
        try {
            if (chunk === null || chunk === undefined) {
                return true;
            }

            let content: string;
            if (Buffer.isBuffer(chunk)) {
                content = chunk.toString();
            } else if (typeof chunk === 'string') {
                content = chunk;
            } else {
                const errorMsg = `[ProtocolFilter] ERR: Non-string/buffer type: ${typeof chunk}\n`;
                this.stderrTarget.write(errorMsg);
                return this.stderrTarget.write(chunk, encoding, callback);
            }

            const trimmed = content.trim();
            if (trimmed.length === 0) {
                return this.stderrTarget.write(chunk, encoding, callback);
            }

            const isJsonRpc = (trimmed.startsWith(this.OBJECT_START) || trimmed.startsWith(this.ARRAY_START)) &&
                content.includes(this.JSONRPC_MARKER);

            if (isJsonRpc) {
                const target = (this.stdoutTarget === process.stdout && this.isHijacked)
                    ? this.originalWrite
                    : this.stdoutTarget.write.bind(this.stdoutTarget);

                return target.call(this.stdoutTarget, chunk, encoding, callback);
            } else {
                const log = `[ProtocolFilter] Diverted noise (len: ${content.length}): ${trimmed.substring(0, 50).replace(/\n/g, ' ')}\n`;
                this.stderrTarget.write(log);
                return this.stderrTarget.write(chunk, encoding, callback);
            }
        } catch (err) {
            const fatal = `[ProtocolFilter] FATAL: ${err instanceof Error ? err.message : String(err)}\n`;
            this.stderrTarget.write(fatal);
            return this.stderrTarget.write(chunk, encoding, callback);
        }
    }

    static stop() {
        if (!this.isHijacked) return;
        process.stdout.write = this.originalWrite;
        this.isHijacked = false;
    }
}
