import os
import asyncio
import logging
import httpx
from dotenv import load_dotenv
from livekit.agents import JobContext, WorkerOptions, cli, stt, tts, Agent

from livekit.plugins import silero, google

# Zero-Cost Adapters
from faster_whisper import WhisperModel
import edge_tts

load_dotenv()

# --- Custom Faster-Whisper STT ---
class FasterWhisperSTT(stt.STT):
    def __init__(self, model_size="base.en"):
        self._model = WhisperModel(model_size, device="cpu", compute_type="int8")

    async def _transcribe(self, audio: stt.AudioBuffer, *args, **kwargs) -> stt.SpeechEvent:
        # LiveKit sends audio in chunks; for simple implementation we wait for silence
        # In a real pipeline, we'd use a streaming whisper, but for MVP:
        samplerate = audio.sample_rate
        data = audio.data
        segments, _ = self._model.transcribe(data, beam_size=5)
        text = " ".join([s.text for s in list(segments)])
        return stt.SpeechEvent(type=stt.SpeechEventType.FINAL_TRANSCRIPT, alternatives=[stt.SpeechData(text=text, language="en")])

# --- Custom EdgeTTS TTS ---
class EdgeTTS(tts.TTS):
    def __init__(self, voice="en-GB-ThomasNeural"):
        super().__init__(streaming_supported=True)
        self._voice = voice

    def synthesize(self, text: str) -> tts.ChunkedStream:
        return tts.ChunkedStream(self._synthesize_stream(text))

    async def _synthesize_stream(self, text: str):
        communicate = edge_tts.Communicate(text, self._voice)
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                yield tts.SynthesizedAudio(
                    request_id="",
                    frame=tts.AudioFrame(
                        data=chunk["data"],
                        sample_rate=24000,
                        num_channels=1,
                        samples_per_channel=len(chunk["data"]) // 2
                    )
                )

# --- Nexus Neural Bridge Client ---
class NexusBrainBridge:
    def __init__(self, url="http://localhost:18791"):
        self.url = url

    async def chat(self, text: str):
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{self.url}/chat", json={"message": text}, timeout=60)
            return resp.json()["response"]

    async def execute_tool(self, name: str, args: dict):
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{self.url}/tool", json={"tool": name, "args": args}, timeout=60)
            return resp.json()["result"]

# --- The Agent Logic ---
async def entrypoint(ctx: JobContext):
    logging.info("Nexus Stark Voice Agent entering room: %s", ctx.room.name)
    
    bridge = NexusBrainBridge()
    
    # We use Google Gemini for the Voice LLM (Fast & Free tier)
    llm = google.LLM(model="gemini-2.0-flash")
    
    # Define our custom Zero-Cost pipeline
    stt_engine = FasterWhisperSTT()
    tts_engine = EdgeTTS()
    
    agent = Agent(
        vad=silero.VAD.load(),
        stt=stt_engine,
        llm=llm,
        tts=tts_engine,
        ctx=llm.create_context(),
    )

    agent.start(ctx.room)
    await agent.say("Greetings boss. I'm back online with the Stark upgrade. How can I help you today?")

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
