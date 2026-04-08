import React, { useState, useRef, useEffect } from 'react';
import { Shield, Play, Trash2, Terminal, Lock, Unlock, Loader2, CheckCircle2, XCircle, Container, Cpu } from 'lucide-react';

interface SandboxResult {
    success: boolean;
    stdout: string;
    stderr: string;
    code: number;
    engine: 'DOCKER' | 'BUN_SUBPROCESS';
}

interface SandboxViewProps {
    ws: WebSocket | null;
}

const DEFAULT_CODE = `// Nexus Sandbox — Write TypeScript/JavaScript code here
// This runs in an isolated environment (Docker or Bun subprocess)

console.log("Hello from the Nexus Sandbox! 🚀");

// Example: Compute something
const fibonacci = (n: number): number => n <= 1 ? n : fibonacci(n - 1) + fibonacci(n - 2);
console.log("Fibonacci(10) =", fibonacci(10));
`;

export const SandboxView: React.FC<SandboxViewProps> = ({ ws }) => {
    const [code, setCode] = useState(DEFAULT_CODE);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<SandboxResult | null>(null);
    const [sandboxEnabled, setSandboxEnabled] = useState(false);
    const [history, setHistory] = useState<{ code: string; result: SandboxResult; timestamp: number }[]>([]);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const outputRef = useRef<HTMLDivElement>(null);

    // Listen for sandbox results from WebSocket
    useEffect(() => {
        if (!ws) return;

        const handler = (event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'SANDBOX_RESULT') {
                    const res = data.payload as SandboxResult;
                    setResult(res);
                    setRunning(false);
                    setHistory(prev => [...prev.slice(-19), { code, result: res, timestamp: Date.now() }]);
                }
            } catch (e) { }
        };

        ws.addEventListener('message', handler);
        return () => ws.removeEventListener('message', handler);
    }, [ws, code]);

    // Auto-scroll output
    useEffect(() => {
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, [result]);

    const runCode = () => {
        if (!ws || !sandboxEnabled || running) return;
        setRunning(true);
        setResult(null);
        ws.send(JSON.stringify({ type: 'SANDBOX_EXEC', payload: code }));
    };

    const clearOutput = () => {
        setResult(null);
    };

    // Handle Tab key for indentation
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const textarea = e.currentTarget;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const newCode = code.substring(0, start) + '  ' + code.substring(end);
            setCode(newCode);
            setTimeout(() => {
                textarea.selectionStart = textarea.selectionEnd = start + 2;
            }, 0);
        }
        // Ctrl+Enter to run
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            runCode();
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-subtle)]">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center">
                        <Shield className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                        <h1 className="text-lg font-semibold text-white">Sandbox</h1>
                        <p className="text-xs text-[var(--color-text-tertiary)]">Secure Isolated Execution Environment</p>
                    </div>
                </div>

                {/* Sandbox Toggle */}
                <button
                    onClick={() => setSandboxEnabled(!sandboxEnabled)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${sandboxEnabled
                            ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.1)]'
                            : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] text-[var(--color-text-tertiary)] hover:border-[var(--color-border-default)]'
                        }`}
                >
                    {sandboxEnabled ? (
                        <>
                            <Unlock className="w-4 h-4" />
                            <span className="text-sm font-medium">SANDBOX ACTIVE</span>
                            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        </>
                    ) : (
                        <>
                            <Lock className="w-4 h-4" />
                            <span className="text-sm font-medium">SANDBOX OFF</span>
                        </>
                    )}
                </button>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden">
                {/* Code Editor Panel */}
                <div className="flex-1 flex flex-col border-r border-[var(--color-border-subtle)]">
                    {/* Editor Toolbar */}
                    <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
                        <div className="flex items-center gap-2">
                            <Terminal className="w-4 h-4 text-[var(--color-text-tertiary)]" />
                            <span className="text-xs text-[var(--color-text-secondary)] font-mono">script.ts</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={clearOutput}
                                className="p-1.5 rounded-md text-[var(--color-text-tertiary)] hover:text-white hover:bg-[var(--color-bg-card)] transition-all"
                                title="Clear Output"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                            <button
                                onClick={runCode}
                                disabled={!sandboxEnabled || running}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${!sandboxEnabled
                                        ? 'bg-[var(--color-bg-card)] text-[var(--color-text-tertiary)] cursor-not-allowed opacity-50'
                                        : running
                                            ? 'bg-amber-500/20 text-amber-400 cursor-wait'
                                            : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30'
                                    }`}
                            >
                                {running ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Running...
                                    </>
                                ) : (
                                    <>
                                        <Play className="w-4 h-4" />
                                        Run (⌘↵)
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Code Textarea */}
                    <textarea
                        ref={textareaRef}
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={!sandboxEnabled}
                        className={`flex-1 w-full p-4 bg-[#0a0a0a] text-[#e2e8f0] font-mono text-sm leading-6 resize-none outline-none border-0 ${!sandboxEnabled ? 'opacity-40 cursor-not-allowed' : ''
                            }`}
                        placeholder={sandboxEnabled ? "Write your code here..." : "Enable sandbox to start coding..."}
                        spellCheck={false}
                    />
                </div>

                {/* Output Panel */}
                <div className="w-[45%] flex flex-col bg-[#050505]">
                    <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
                        <span className="text-xs text-[var(--color-text-secondary)] font-mono">OUTPUT</span>
                        {result && (
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1.5">
                                    {result.engine === 'DOCKER' ? (
                                        <Container className="w-3.5 h-3.5 text-blue-400" />
                                    ) : (
                                        <Cpu className="w-3.5 h-3.5 text-purple-400" />
                                    )}
                                    <span className="text-xs text-[var(--color-text-tertiary)] font-mono">{result.engine}</span>
                                </div>
                                {result.success ? (
                                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                ) : (
                                    <XCircle className="w-4 h-4 text-red-400" />
                                )}
                            </div>
                        )}
                    </div>

                    <div ref={outputRef} className="flex-1 p-4 overflow-y-auto font-mono text-sm">
                        {!sandboxEnabled && (
                            <div className="flex flex-col items-center justify-center h-full text-center gap-4">
                                <div className="w-16 h-16 rounded-2xl bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] flex items-center justify-center">
                                    <Shield className="w-8 h-8 text-[var(--color-text-tertiary)]" />
                                </div>
                                <div>
                                    <p className="text-[var(--color-text-secondary)] text-sm">Sandbox is offline</p>
                                    <p className="text-[var(--color-text-tertiary)] text-xs mt-1">Toggle the switch above to activate the secure execution environment</p>
                                </div>
                            </div>
                        )}

                        {sandboxEnabled && !result && !running && (
                            <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                                <Play className="w-8 h-8 text-emerald-500/30" />
                                <p className="text-[var(--color-text-tertiary)] text-xs">Write code and press <kbd className="px-1.5 py-0.5 bg-[var(--color-bg-card)] rounded text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]">⌘↵</kbd> to execute</p>
                            </div>
                        )}

                        {running && (
                            <div className="flex items-center gap-2 text-amber-400">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>Executing in sandbox...</span>
                            </div>
                        )}

                        {result && (
                            <div className="space-y-3">
                                {result.stdout && (
                                    <div>
                                        <div className="text-xs text-emerald-500/70 mb-1 uppercase tracking-wider">stdout</div>
                                        <pre className="text-[#a3e635] whitespace-pre-wrap break-words leading-relaxed">{result.stdout}</pre>
                                    </div>
                                )}
                                {result.stderr && (
                                    <div>
                                        <div className="text-xs text-red-500/70 mb-1 uppercase tracking-wider">stderr</div>
                                        <pre className="text-red-400 whitespace-pre-wrap break-words leading-relaxed">{result.stderr}</pre>
                                    </div>
                                )}
                                <div className="pt-2 border-t border-[var(--color-border-subtle)]">
                                    <span className={`text-xs font-mono ${result.success ? 'text-emerald-500' : 'text-red-500'}`}>
                                        Exit Code: {result.code} · Engine: {result.engine}
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* History Footer */}
                    {history.length > 0 && (
                        <div className="px-4 py-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
                            <span className="text-xs text-[var(--color-text-tertiary)]">
                                {history.length} execution{history.length > 1 ? 's' : ''} · {history.filter(h => h.result.success).length} passed
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
