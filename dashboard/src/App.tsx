import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';
import { Sidebar, type ViewType } from './components/Sidebar';
import { OrbView } from './components/OrbView';
import { TerminalView } from './components/views/TerminalView';
import { VaultView } from './components/views/VaultView';
import { DirectivesView } from './components/views/DirectivesView';
import { AnalyticsView } from './components/views/AnalyticsView';
import { SwarmView } from './components/views/SwarmView';
import { SandboxView } from './components/views/SandboxView';

// Interfaces
interface ChatMessage { role: string; text: string; id: string; }
interface Goal { id: string; title: string; description: string; status: string; progress: number; steps: { description: string; completed: boolean }[]; }
interface SystemTelemetry { cpu: number; memUsed: number; memTotal: number; memPct: number; activeApp: string; uptime: string; timestamp: string; }
interface VaultFact { id: number; entity: string; fact: string; timestamp: string; }

function App() {
  const [systemInitialized, setSystemInitialized] = useState(false);
  const [currentView, setCurrentView] = useState<ViewType>('TERMINAL');

  const [logs, setLogs] = useState<string[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [states, setStates] = useState({ architect: 'IDLE', coder: 'IDLE', bridge: 'IDLE' });
  const [goals, setGoals] = useState<Goal[]>([]);
  const [vaultFacts, setVaultFacts] = useState<VaultFact[]>([]);
  const [telemetry, setTelemetry] = useState<SystemTelemetry | null>(null);
  const [swarmData, setSwarmData] = useState<any>(null);

  const [micActive, setMicActive] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioInputRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

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

    // Auto-enable microphone immediately
    setTimeout(() => {
      if (!micActive) {
        toggleMic();
      }
    }, 500);
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
          } else if (data.type === 'CHAT') {
            const msg = { ...data.payload, id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
            setChatMessages(prev => [...prev, msg]);
          } else if (data.type === 'AUDIO_RESPONSE') {
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

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const message = inputValue.trim();
    if (!message) return;

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error("Neural Link Offline. Cannot send directive.");
      setLogs(prev => [...prev, "❌ ERROR: Neural Link Offline. Refresh the page."]);
      return;
    }

    setChatMessages(prev => [...prev, { role: 'USER', text: message, id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }]);
    wsRef.current.send(JSON.stringify({ type: 'CHAT_INPUT', payload: message }));
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

  const toggleMic = async () => {
    if (micActive) {
      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current = null;
      }
      if (audioInputRef.current) {
        audioInputRef.current.disconnect();
        audioInputRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      setMicActive(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 48000 }
      });
      streamRef.current = stream;

      const actx = audioContextRef.current;
      if (!actx) return;
      if (actx.state === 'suspended') await actx.resume();

      const audioInput = actx.createMediaStreamSource(stream);
      audioInputRef.current = audioInput;

      // 8192 frames @ 48kHz = ~170ms chunks
      const bufferSize = 8192;
      const processor = actx.createScriptProcessor(bufferSize, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const buffer = new ArrayBuffer(inputData.length * 4);
        const view = new DataView(buffer);
        for (let i = 0; i < inputData.length; i++) {
          view.setFloat32(i * 4, inputData[i], true); // little endian
        }

        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, Array.from(bytes.slice(i, i + chunkSize)));
        }
        const base64 = btoa(binary);

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'VOICE_STREAM', payload: base64 }));
        }
      };

      audioInput.connect(processor);
      processor.connect(actx.destination);

      setMicActive(true);
      setMicError(null);
      setChatMessages(prev => [...prev, { role: 'USER', text: '🎤 [Listening Continuous]', id: `msg-mic-${Date.now()}` }]);
    } catch (err: any) {
      console.error(err);
      if (err.name === 'NotAllowedError') {
        setMicError('Permission Blocked');
      } else {
        setMicError('Mic Error');
      }
      setMicActive(false);
    }
  };

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
    <div className="flex h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)] overflow-hidden font-inter selection:bg-[var(--color-brand-primary)] selection:text-white">
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

      {currentView === 'VAULT' && <VaultView vaultFacts={vaultFacts} />}

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
      {currentView === 'SANDBOX' && <SandboxView ws={wsRef.current} />}
    </div>
  );
}

export default App;
