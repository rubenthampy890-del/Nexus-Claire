import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Zap, Shield } from 'lucide-react';
import { Sidebar, type ViewType } from './components/Sidebar';
import { OrbView } from './components/OrbView';
import { TerminalView } from './components/views/TerminalView';
import { VaultView } from './components/views/VaultView';
import { DirectivesView } from './components/views/DirectivesView';
import { AnalyticsView } from './components/views/AnalyticsView';
import { SwarmView } from './components/views/SwarmView';
import { SandboxView } from './components/views/SandboxView';
import { BrowserView } from './components/views/BrowserView';
import { SkillsView } from './components/views/SkillsView';

// Interfaces
interface ChatMessage { role: string; text: string; id: string; isStreaming?: boolean; }
interface Goal { id: string; title: string; description: string; status: string; progress: number; steps: { description: string; completed: boolean }[]; }
interface SystemTelemetry { cpu: number; memUsed: number; memTotal: number; memPct: number; activeApp: string; uptime: string; timestamp: string; }
interface VaultFact { id: number; entity: string; fact: string; timestamp: string; }

function App() {
  const [systemInitialized, setSystemInitialized] = useState(false);
  const [currentView, setCurrentView] = useState<ViewType>('TERMINAL');

  const [logs, setLogs] = useState<string[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [healingMode, setHealingMode] = useState(false);
  const [tools, setTools] = useState<any[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [states, setStates] = useState({ architect: 'IDLE', coder: 'IDLE', bridge: 'IDLE' });
  const [goals, setGoals] = useState<Goal[]>([]);
  const [vaultFacts, setVaultFacts] = useState<VaultFact[]>([]);
  const [telemetry, setTelemetry] = useState<SystemTelemetry | null>(null);
  const [swarmData, setSwarmData] = useState<any>(null);
  const [browserSnapshot, setBrowserSnapshot] = useState<string | null>(null);
  const [browserUrl, setBrowserUrl] = useState('');
  const [browserLogs, setBrowserLogs] = useState<string[]>([]);

  const [micActive, setMicActive] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const [pendingApprovals, setPendingApprovals] = useState<any[]>([]);
  const [authChallenges, setAuthChallenges] = useState<any[]>([]);
  const [authInputValue, setAuthInputValue] = useState('');

  const resolveApproval = (id: string, approved: boolean) => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'RESOLVE_APPROVAL', payload: { id, approved } }));
    }
    setPendingApprovals(prev => prev.filter(a => a.id !== id));
  };

  const resolveAuth = (id: string, value: string) => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'RESOLVE_AUTH', payload: { id, value } }));
    }
    setAuthChallenges(prev => prev.filter(a => a.id !== id));
    setAuthInputValue('');
  };

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  // Audio state
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);

  const initializeSystem = () => {
    const actx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const ael = new Audio();
    ael.crossOrigin = "anonymous";

    // Unlock HTMLAudioElement by playing silence during the valid user gesture window
    ael.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";
    ael.play().catch(() => { });

    const sourceNode = actx.createMediaElementSource(ael);

    const silence = actx.createBuffer(1, 1, actx.sampleRate);
    const silenceNode = actx.createBufferSource();
    silenceNode.buffer = silence;
    silenceNode.connect(actx.destination);
    silenceNode.start();

    audioContextRef.current = actx;
    audioElementRef.current = ael;
    sourceNodeRef.current = sourceNode;

    setSystemInitialized(true);

    // Hand over control to user. Mic is explicitly click-to-activate.
  };

  const playNextAudio = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0 || !audioElementRef.current) return;
    isPlayingRef.current = true;
    setIsSpeaking(true);

    while (audioQueueRef.current.length > 0) {
      const base64 = audioQueueRef.current.shift()!;
      try {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'audio/mp3' });
        const url = URL.createObjectURL(blob);

        audioElementRef.current.src = url;
        await new Promise<void>((resolve) => {
          if (!audioElementRef.current) return resolve();
          audioElementRef.current.onended = () => { URL.revokeObjectURL(url); resolve(); };
          audioElementRef.current.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          if (audioContextRef.current?.state === 'suspended') audioContextRef.current.resume();
          audioElementRef.current.play().catch(() => resolve());
        });
      } catch (e) { console.error('Audio playback error:', e); }
    }

    isPlayingRef.current = false;
    setIsSpeaking(false);
  }, []);

  useEffect(() => {
    if (!systemInitialized) return;
    let isMounted = true;
    let reconnectTimer: any;

    const connectWS = () => {
      if (!isMounted) return;
      const ws = new WebSocket(import.meta.env.VITE_WS_URL || 'ws://127.0.0.1:18790');
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'LOG') {
            setLogs(prev => [...prev.slice(-100), data.payload]);
          } else if (data.type === 'STATE') {
            setStates(prev => ({ ...prev, ...data.payload }));
            setIsExecuting(data.payload.coder === 'ACTIVE');
          } else if (data.type === 'APPROVAL_REQUEST') {
            setPendingApprovals(prev => [...prev, data.payload]);
          } else if (data.type === 'AUTH_CHALLENGE') {
            setAuthChallenges(prev => [...prev, data.payload]);
          } else if (data.type === 'CHAT') {
            const { replaceStream, text, role } = data.payload;
            // Clean up EXEC: tags from user view
            const cleanedText = text.replace(/\[EXEC:.*?\]/gis, '').trim();
            if (!cleanedText && text.includes('[EXEC:')) return; // Ignore if it's ONLY an exec tag

            const newMsg = {
              role,
              text: cleanedText || text,
              id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
            };

            setChatMessages(prev => {
              if (replaceStream) {
                return [...prev.filter(m => (m as any).id !== 'streaming-msg'), newMsg];
              }
              return [...prev, newMsg];
            });
          } else if (data.type === 'CHAT_STREAM') {
            const cleanedText = data.payload.text.replace(/\[EXEC:.*?\]/gis, '').trim();
            setChatMessages(prev => {
              const last = prev[prev.length - 1];
              if (last && (last as any).id === 'streaming-msg') {
                return [...prev.slice(0, -1), { ...last, text: cleanedText || data.payload.text }];
              } else {
                return [...prev, {
                  role: data.payload.role,
                  text: cleanedText || data.payload.text,
                  id: 'streaming-msg',
                  isStreaming: true
                } as any];
              }
            });
          } else if (data.type === 'AUDIO_RESPONSE') {
            console.log(`[AUDIO] Received response chunk (${data.payload.length} chars)`);
            audioQueueRef.current.push(data.payload);
            playNextAudio();
          } else if (data.type === 'GOALS') {
            setGoals(data.payload);
          } else if (data.type === 'VAULT_UPDATE') {
            setVaultFacts(Array.isArray(data.payload) ? data.payload : (data.payload?.facts || []));
          } else if (data.type === 'SYSTEM_TELEMETRY') {
            setTelemetry(data.payload);
          } else if (data.type === 'INTERRUPT') {
            if (audioElementRef.current) {
              audioElementRef.current.pause();
              audioElementRef.current.src = "";
            }
            audioQueueRef.current = [];
            isPlayingRef.current = false;
            setIsSpeaking(false);
          } else if (data.type === 'VAD_STATE') {
            setUserSpeaking(data.payload?.userSpeaking || false);
          } else if (data.type === 'SWARM_UPDATE') {
            setSwarmData(data.payload);
          } else if (data.type === 'BROWSER_SNAPSHOT') {
            setBrowserSnapshot(data.payload);
          } else if (data.type === 'BROWSER_URL') {
            setBrowserUrl(data.payload);
          } else if (data.type === 'BROWSER_LOG') {
            setBrowserLogs(prev => [...prev.slice(-20), data.payload]);
          } else if (data.type === 'CRITICAL_PULSE') {
            if (data.payload?.type === 'healing') {
              setHealingMode(true);
              setLogs(prev => [...prev.slice(-100), `🧬 ${data.payload.title}: ${data.payload.body}`]);
              // Auto-dismiss healing shield after 30s
              setTimeout(() => setHealingMode(false), 30000);
            }
          } else if (data.type === 'TOOLS_UPDATE') {
            setTools(data.payload);
          }
        } catch (e) {
          console.error("Neural Link Processing Error:", e);
        }
      };

      ws.onopen = () => {
        console.log("Neural Link Established.");
        setStates(prev => ({ ...prev, bridge: 'ACTIVE' }));
      };
      ws.onclose = () => {
        setStates(prev => ({ ...prev, bridge: 'OFFLINE' }));
        if (isMounted) reconnectTimer = setTimeout(connectWS, 3000);
      };
      ws.onerror = () => ws.close();
    };

    connectWS();
    return () => { isMounted = false; clearTimeout(reconnectTimer); if (wsRef.current) wsRef.current.close(); };
  }, [playNextAudio, systemInitialized]);

  const handleSendMessage = (e: React.FormEvent, imageData?: { base64: string; mimeType: string }) => {
    e.preventDefault();
    const message = inputValue.trim();
    if (!message && !imageData) return;

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error("Neural Link Offline. Cannot send directive.");
      setLogs(prev => [...prev, "❌ ERROR: Neural Link Offline. Refresh the page."]);
      return;
    }

    const msgObj: any = { role: 'USER', text: message || '(image attached)', id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
    if (imageData) msgObj.imageBase64 = imageData.base64;
    setChatMessages(prev => [...prev, msgObj]);

    if (imageData) {
      wsRef.current.send(JSON.stringify({ type: 'CHAT_INPUT_WITH_IMAGE', payload: { text: message || 'Analyze this image.', image: imageData } }));
    } else {
      wsRef.current.send(JSON.stringify({ type: 'CHAT_INPUT', payload: message }));
    }
    setInputValue('');
  };

  const handleCreateGoal = (e: React.FormEvent) => {
    e.preventDefault();
    const title = goalTitle.trim();
    if (!title || !wsRef.current) return;

    wsRef.current.send(JSON.stringify({ type: 'CREATE_GOAL', payload: { title, description: "Direct Action", steps: [] } }));
    setGoalTitle('');
    setShowGoalForm(false);
  };

  const vADRef = useRef<{ isTalking: boolean; silenceStart: number | null }>({ isTalking: false, silenceStart: null });
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micActiveRef = useRef(false);

  // Keep ref in sync with state
  useEffect(() => { micActiveRef.current = micActive; }, [micActive]);

  const toggleMic = async () => {
    if (micActive) {
      micActiveRef.current = false;
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      analyserRef.current = null;
      setMicActive(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const actx = audioContextRef.current || new (window.AudioContext || (window as any).webkitAudioContext)();
      if (!audioContextRef.current) audioContextRef.current = actx;

      const source = actx.createMediaStreamSource(stream);
      const analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      micActiveRef.current = true;
      setMicActive(true);
      setMicError(null);

      // Kick off the first recording cycle AFTER state is set
      setTimeout(() => startRecordingCycle(), 100);
    } catch (err: any) {
      console.error(err);
      setMicError(err.name === 'NotAllowedError' ? 'Permission Blocked' : 'Mic Error');
      setMicActive(false);
      micActiveRef.current = false;
    }
  };

  const startRecordingCycle = () => {
    if (!streamRef.current || !micActiveRef.current) return;

    const recorder = new MediaRecorder(streamRef.current, { mimeType: 'audio/webm' });
    recorderRef.current = recorder;
    let chunks: Blob[] = [];

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = async () => {
      if (chunks.length === 0) {
        // Empty recording - just restart if still active
        if (micActiveRef.current) setTimeout(startRecordingCycle, 300);
        return;
      }
      const blob = new Blob(chunks, { type: 'audio/webm' });
      chunks = [];
      const buffer = await blob.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = window.btoa(binary);
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'VOICE_STREAM', payload: base64 }));
      }
      // Restart cycle using REF (not stale state)
      if (micActiveRef.current) setTimeout(startRecordingCycle, 300);
    };

    recorder.start();
  };

  // VAD Loop - detects silence and auto-stops the recorder
  useEffect(() => {
    if (!micActive || !analyserRef.current) return;
    let animationFrame: number;
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);

    const checkVAD = () => {
      if (!analyserRef.current || !recorderRef.current) return;
      analyserRef.current.getByteFrequencyData(dataArray);

      const volume = dataArray.reduce((p, c) => p + c, 0) / dataArray.length;
      const now = Date.now();

      // Skip VAD if Nexus is talking to avoid echo loops
      if (isSpeaking) {
        if (recorderRef.current.state === 'recording') {
          recorderRef.current.pause();
        }
        animationFrame = requestAnimationFrame(checkVAD);
        return;
      } else if (recorderRef.current.state === 'paused') {
        recorderRef.current.resume();
      }

      if (volume > 40) { // Threshold strictly for distinct human speech (ignore fans/typing)
        vADRef.current.isTalking = true;
        vADRef.current.silenceStart = null;
      } else if (vADRef.current.isTalking) {
        if (!vADRef.current.silenceStart) vADRef.current.silenceStart = now;

        if (now - vADRef.current.silenceStart > 1200) {
          if (recorderRef.current.state === 'recording') {
            recorderRef.current.stop();
          }
          vADRef.current.isTalking = false;
          vADRef.current.silenceStart = null;
        }
      }

      animationFrame = requestAnimationFrame(checkVAD);
    };

    animationFrame = requestAnimationFrame(checkVAD);
    return () => cancelAnimationFrame(animationFrame);
  }, [micActive, isSpeaking]);

  if (!systemInitialized) {
    return (
      <div className="h-screen w-screen bg-[var(--color-bg-base)] flex flex-col items-center justify-center font-sans">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={initializeSystem}
          className="px-16 py-8 bg-[#111111] border border-[#333333] flex flex-col items-center gap-4 cursor-pointer group shadow-2xl rounded-2xl hover:border-white transition-colors"
        >
          <Zap className="w-10 h-10 text-white" />
          <span className="tracking-[0.1em] font-semibold text-xl text-white">INITIATE UPLINK</span>
          <span className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wider mt-1">NEXUS v5.0 SECURE</span>
        </motion.button>
      </div>
    );
  }


  return (
    <div className={`flex h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)] overflow-hidden font-inter selection:bg-[var(--color-brand-primary)] selection:text-white transition-all duration-1000 ${healingMode ? 'border-4 border-red-500/80 shadow-[inset_0_0_100px_rgba(239,68,68,0.2)]' : ''}`}>
      {healingMode && (
        <div className="absolute top-4 right-4 z-50 bg-red-950/80 border border-red-500 text-red-400 px-4 py-2 rounded-lg font-mono text-xs flex items-center gap-3 animate-pulse shadow-[0_0_20px_rgba(239,68,68,0.4)] backdrop-blur-md">
          <Shield className="w-4 h-4" />
          <span>AUTONOMOUS HEALING SEQUENCE ACTIVE</span>
        </div>
      )}
      <Sidebar
        currentView={currentView}
        onViewChange={setCurrentView}
        bridgeStatus={states.bridge}
        micActive={micActive}
        micError={micError}
        onToggleMic={toggleMic}
        isExecuting={isExecuting}
      />

      {currentView === 'ORB' && (
        <OrbView
          audioContext={audioContextRef.current}
          sourceNode={sourceNodeRef.current}
          isSpeaking={isSpeaking}
          userSpeaking={userSpeaking}
          micActive={micActive}
          onToggleMic={toggleMic}
        />
      )}

      {currentView === 'TERMINAL' && (
        <TerminalView
          logs={logs}
          chatMessages={chatMessages}
          inputValue={inputValue}
          setInputValue={setInputValue}
          onSendMessage={handleSendMessage}
        />
      )}

      {currentView === 'VAULT' && (
        <VaultView
          vaultFacts={vaultFacts}
          onDelete={(id) => wsRef.current?.send(JSON.stringify({ type: 'DELETE_FACT', payload: id }))}
          onUpdate={(id, fact) => wsRef.current?.send(JSON.stringify({ type: 'UPDATE_FACT', payload: { id, fact } }))}
        />
      )}

      {currentView === 'DIRECTIVES' && (
        <DirectivesView
          goals={goals}
          goalTitle={goalTitle}
          setGoalTitle={setGoalTitle}
          showGoalForm={showGoalForm}
          setShowGoalForm={setShowGoalForm}
          handleCreateGoal={handleCreateGoal}
        />
      )}

      {currentView === 'ANALYTICS' && <AnalyticsView telemetry={telemetry} />}
      {currentView === 'SWARM' && <SwarmView data={swarmData} />}
      {currentView === 'BROWSER' && (
        <BrowserView
          snapshot={browserSnapshot}
          currentUrl={browserUrl}
          browserLogs={browserLogs}
        />
      )}
      {currentView === 'SKILLS' && <SkillsView tools={tools} />}
      {currentView === 'SANDBOX' && <SandboxView ws={wsRef.current} />}

      {/* Persistent Approval Overlay */}
      {pendingApprovals.length > 0 && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-6">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="hifi-card max-w-lg w-full p-8 border-[#6366f1]/50 shadow-[0_0_50px_rgba(99,102,241,0.2)]"
          >
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-red-500/20 rounded-xl border border-red-500/30">
                <Shield className="w-6 h-6 text-red-500" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Security Approval Required</h2>
                <p className="text-[var(--color-text-secondary)] text-sm mt-1">
                  Nexus is requesting permission for an elevated action.
                </p>
              </div>
            </div>

            <div className="bg-black/40 border border-white/5 rounded-xl p-5 mb-8">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[var(--color-text-tertiary)] uppercase tracking-widest text-[10px] font-bold">Action</span>
                <span className="text-[#6366f1] text-[10px] font-mono font-bold bg-[#6366f1]/10 px-2 py-0.5 rounded leading-none">{pendingApprovals[0].toolName}</span>
              </div>
              <div className="text-sm text-white font-medium leading-relaxed">
                {pendingApprovals[0].reason}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => resolveApproval(pendingApprovals[0].id, false)}
                className="py-4 rounded-xl border border-white/10 text-[var(--color-text-secondary)] font-semibold hover:bg-white/5 hover:text-white transition-all cursor-pointer"
              >
                DENY
              </button>
              <button
                onClick={() => resolveApproval(pendingApprovals[0].id, true)}
                className="py-4 rounded-xl bg-[#6366f1] text-white font-bold hover:bg-[#4f46e5] shadow-lg shadow-[#6366f1]/20 transition-all cursor-pointer"
              >
                AUTHORIZE
              </button>
            </div>
          </motion.div>
        </div>
      )}
      {/* Auth Challenge Modal */}
      {authChallenges.length > 0 && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-md p-6">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="hifi-card max-w-lg w-full p-8 border-[#f59e0b]/50 shadow-[0_0_50px_rgba(245,158,11,0.2)]"
          >
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-[#f59e0b]/20 rounded-xl border border-[#f59e0b]/30">
                <Shield className="w-6 h-6 text-[#f59e0b]" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">{authChallenges[0].title}</h2>
                <p className="text-[var(--color-text-secondary)] text-sm mt-1">Nexus needs your input to proceed</p>
              </div>
            </div>

            <div className="bg-black/40 border border-white/5 rounded-xl p-5 mb-6">
              <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{authChallenges[0].description}</p>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); resolveAuth(authChallenges[0].id, authInputValue); }} className="space-y-4">
              <input
                type="text"
                value={authInputValue}
                onChange={(e) => setAuthInputValue(e.target.value)}
                placeholder="Enter verification code, CAPTCHA answer, etc."
                autoFocus
                className="w-full glass-input rounded-xl px-5 py-4 text-sm text-white placeholder-[var(--color-text-tertiary)] border border-[#f59e0b]/30 focus:border-[#f59e0b] outline-none"
              />
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => { setAuthChallenges(prev => prev.slice(1)); setAuthInputValue(''); }}
                  className="py-4 rounded-xl border border-white/10 text-[var(--color-text-secondary)] font-semibold hover:bg-white/5 hover:text-white transition-all cursor-pointer"
                >
                  SKIP
                </button>
                <button
                  type="submit"
                  className="py-4 rounded-xl bg-[#f59e0b] text-black font-bold hover:bg-[#d97706] shadow-lg shadow-[#f59e0b]/20 transition-all cursor-pointer"
                >
                  SUBMIT
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}

export default App;
