import { useRef, useEffect } from 'react';
import * as THREE from 'three';

export const AudioVisualizer = ({ audioContext, sourceNode, isPlaying }: { audioContext: AudioContext | null, sourceNode: MediaElementAudioSourceNode | null, isPlaying: boolean }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const audioDataRef = useRef<{ analyser: AnalyserNode | null; dataArray: Uint8Array | null }>({
        analyser: null,
        dataArray: null
    });

    // Engine refs to persist across renders
    const sceneRef = useRef<THREE.Scene | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const pointsRef = useRef<THREE.Points | null>(null);
    const linesRef = useRef<THREE.LineSegments | null>(null);
    const coreRef = useRef<THREE.Group | null>(null);
    const materialsRef = useRef<THREE.ShaderMaterial[]>([]);
    const requestRef = useRef<number>(undefined);
    const isPlayingRef = useRef(isPlaying);

    // Update isPlayingRef when prop changes
    useEffect(() => {
        isPlayingRef.current = isPlaying;
    }, [isPlaying]);

    // 1. Initialize Engine (Once on Mount)
    useEffect(() => {
        if (!containerRef.current) return;

        const width = 600;
        const height = 600;
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
        camera.position.z = 800;

        const renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            powerPreference: "high-performance"
        });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        if (containerRef.current) {
            containerRef.current.innerHTML = '';
            containerRef.current.appendChild(renderer.domElement);
        }

        // Particle System
        const particleCount = 1000;
        const positions = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            const r = 200 + Math.random() * 120;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = r * Math.cos(phi);
            sizes[i] = 1.0 + Math.random() * 6.0;
        }

        const particleGeometry = new THREE.BufferGeometry();
        particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        particleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const particleMaterial = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                intensity: { value: 0 },
                color: { value: new THREE.Color('#22d3ee') }
            },
            vertexShader: `
                attribute float size;
                uniform float time;
                uniform float intensity;
                varying float vAlpha;
                void main() {
                    vec3 pos = position;
                    float t = time * 0.6;
                    // Turbulence
                    pos.x += sin(t + position.z * 0.005) * 40.0 * (1.1 + intensity * 2.0);
                    pos.y += cos(t * 0.8 + position.x * 0.006) * 40.0 * (1.1 + intensity * 2.0);
                    pos.z += sin(t * 1.0 + position.y * 0.007) * 40.0 * (1.1 + intensity * 2.0);
                    
                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_PointSize = size * (500.0 / -mvPosition.z) * (1.0 + intensity * 4.0);
                    gl_Position = projectionMatrix * mvPosition;
                    // Visibility falloff
                    float dist = length(pos);
                    vAlpha = smoothstep(1000.0, 100.0, dist) * (0.8 + intensity * 1.2);
                }
            `,
            fragmentShader: `
                uniform vec3 color;
                varying float vAlpha;
                void main() {
                    float r = distance(gl_PointCoord, vec2(0.5));
                    if (r > 0.5) discard;
                    float glow = pow(1.5 - r * 3.0, 3.5);
                    gl_FragColor = vec4(color, vAlpha * glow);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const points = new THREE.Points(particleGeometry, particleMaterial);
        scene.add(points);

        // Lines
        const lineGeometry = new THREE.BufferGeometry();
        const lineMaterial = new THREE.ShaderMaterial({
            uniforms: { intensity: { value: 0 }, color: { value: new THREE.Color('#0891b2') } },
            vertexShader: `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `uniform float intensity; uniform vec3 color; void main() { gl_FragColor = vec4(color, 0.4 + intensity * 0.6); }`,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
        scene.add(lines);

        // Core layers
        const coreGroup = new THREE.Group();
        const coreInner = new THREE.Mesh(
            new THREE.SphereGeometry(100, 32, 32),
            new THREE.MeshBasicMaterial({ color: '#06b6d4', transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, side: THREE.BackSide })
        );
        const coreOuter = new THREE.Mesh(
            new THREE.SphereGeometry(180, 32, 32),
            new THREE.MeshBasicMaterial({ color: '#0ea5e9', transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, side: THREE.BackSide })
        );
        coreGroup.add(coreInner, coreOuter);
        scene.add(coreGroup);

        sceneRef.current = scene;
        rendererRef.current = renderer;
        pointsRef.current = points;
        linesRef.current = lines;
        coreRef.current = coreGroup;
        materialsRef.current = [particleMaterial, lineMaterial];

        let frame = 0;
        const animate = () => {
            try {
                requestRef.current = requestAnimationFrame(animate);
                frame += 0.01;

                // Standby pulse (subtle brilliance pulse only)
                const pulse = (Math.sin(frame * 2) + 1) * 0.5;
                let intensity = pulse * 0.05;

                if (audioDataRef.current.analyser && audioDataRef.current.dataArray) {
                    audioDataRef.current.analyser.getByteFrequencyData(audioDataRef.current.dataArray);
                    const arr = Array.from(audioDataRef.current.dataArray);
                    const volume = arr.reduce((p, c) => p + c, 0) / arr.length;
                    intensity = Math.max(intensity, volume / 255);
                }

                // Update Visuals
                particleMaterial.uniforms.time.value = frame;
                particleMaterial.uniforms.intensity.value = intensity;
                lineMaterial.uniforms.intensity.value = intensity;

                scene.rotation.y += 0.002 + intensity * 0.04;
                scene.rotation.x += 0.001 + intensity * 0.02;

                // Static scale - only opacity reacts
                coreInner.material.opacity = (0.2 + intensity * 0.8);
                coreOuter.material.opacity = (0.1 + intensity * 0.5);

                if (Date.now() % 3 === 0) { // Throttled plexus update
                    const linePositions: number[] = [];
                    const maxDist = 180 * (1 + intensity * 0.5);
                    const pos = particleGeometry.attributes.position.array;
                    for (let i = 0; i < particleCount; i += 3) { // Skip more for performance
                        for (let j = i + 3; j < Math.min(i + 45, particleCount); j += 3) {
                            const dx = pos[i * 3] - pos[j * 3];
                            const dy = pos[i * 3 + 1] - pos[j * 3 + 1];
                            const dz = pos[i * 3 + 2] - pos[j * 3 + 2];
                            if (dx * dx + dy * dy + dz * dz < maxDist * maxDist) {
                                linePositions.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
                                linePositions.push(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
                            }
                        }
                    }
                    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
                }

                renderer.render(scene, camera);
            } catch (err) {
                console.error("Three.js Animation Error:", err);
            }
        };

        animate();

        // 3. Resize Handling
        const resizeObserver = new ResizeObserver((entries) => {
            if (!entries[0] || !rendererRef.current) return;
            const { width, height } = entries[0].contentRect;
            renderer.setSize(width, height);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
        });
        resizeObserver.observe(containerRef.current);

        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
            resizeObserver.disconnect();
            renderer.dispose();
            scene.traverse((obj) => {
                if (obj instanceof THREE.Mesh || obj instanceof THREE.Points || obj instanceof THREE.LineSegments) {
                    obj.geometry.dispose();
                    if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                    else obj.material.dispose();
                }
            });
            if (containerRef.current) containerRef.current.innerHTML = '';
        };
    }, []);

    // 2. Audio Node Binding
    useEffect(() => {
        if (!audioContext || !sourceNode) {
            audioDataRef.current = { analyser: null, dataArray: null };
            return;
        }

        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        sourceNode.connect(analyser);
        // Note: we don't connect to destination here as it's usually handled by the main audio logic

        audioDataRef.current = {
            analyser,
            dataArray: new Uint8Array(analyser.frequencyBinCount)
        };

        return () => {
            sourceNode.disconnect(analyser);
        };
    }, [audioContext, sourceNode]);

    return (
        <div
            ref={containerRef}
            className="relative flex items-center justify-center w-full h-full bg-transparent overflow-hidden mix-blend-screen pointer-events-none"
        />
    );
};
