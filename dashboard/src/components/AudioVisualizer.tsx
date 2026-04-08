import React, { useRef, useEffect } from 'react';

export const AudioVisualizer = ({ audioContext, sourceNode, isPlaying }: { audioContext: AudioContext | null, sourceNode: MediaElementAudioSourceNode | null, isPlaying: boolean }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const requestRef = useRef<number>();

    useEffect(() => {
        if (!audioContext || !sourceNode || !canvasRef.current) return;
        if (!analyserRef.current) {
            analyserRef.current = audioContext.createAnalyser();
            analyserRef.current.fftSize = 256;
            sourceNode.connect(analyserRef.current);
            analyserRef.current.connect(audioContext.destination);
        }

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d')!;
        const analyser = analyserRef.current;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            requestRef.current = requestAnimationFrame(draw);
            analyser.getByteFrequencyData(dataArray);

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const { width, height } = canvas;
            const originX = width / 2;
            const originY = height / 2;
            const radius = 70;

            // Draw Outer Rings
            ctx.beginPath();
            ctx.arc(originX, originY, radius + 20, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(6, 182, 212, 0.1)';
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.beginPath();
            for (let i = 0; i < bufferLength; i++) {
                const barHeight = isPlaying ? (dataArray[i] / 255) * 100 : 2;
                const angle = (i * Math.PI * 2) / bufferLength;
                const startX = originX + Math.cos(angle) * radius;
                const startY = originY + Math.sin(angle) * radius;
                const endX = originX + Math.cos(angle) * (radius + barHeight);
                const endY = originY + Math.sin(angle) * (radius + barHeight);

                ctx.moveTo(startX, startY);
                ctx.lineTo(endX, endY);
            }

            ctx.strokeStyle = '#06b6d4';
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.stroke();

            // Inner glowing core
            const coreVolume = isPlaying ? (dataArray.reduce((acc, v) => acc + v, 0) / bufferLength) : 0;
            ctx.beginPath();
            ctx.arc(originX, originY, radius - 15 + (coreVolume / 255) * 20, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(6, 182, 212, ${isPlaying ? 0.4 + (coreVolume / 255) * 0.4 : 0.05})`;
            ctx.fill();

            if (isPlaying) {
                ctx.shadowBlur = 40;
                ctx.shadowColor = '#06b6d4';
            } else {
                ctx.shadowBlur = 0;
            }
        };

        draw();
        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, [audioContext, sourceNode, isPlaying]);

    return <canvas ref={canvasRef} width={500} height={500} className="w-full h-full" />;
};
