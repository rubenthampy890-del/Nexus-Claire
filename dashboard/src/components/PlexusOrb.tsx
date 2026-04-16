import { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';

interface PlexusOrbProps {
    audioContext: AudioContext | null;
    sourceNode: MediaElementAudioSourceNode | null;
    isPlaying: boolean;
}

interface Particle {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    basePosition: THREE.Vector3;
    radius: number;
    connections: Set<number>;
}

export const PlexusOrb = ({ audioContext, sourceNode, isPlaying }: PlexusOrbProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    
    const sceneRef = useRef<THREE.Scene | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const particlesRef = useRef<THREE.Points | null>(null);
    const linesRef = useRef<THREE.LineSegments | null>(null);
    const coreRef = useRef<THREE.Group | null>(null);
    const particleDataRef = useRef<Particle[]>([]);
    const requestRef = useRef<number>(undefined);
    
    const audioRef = useRef<{ analyser: AnalyserNode | null; dataArray: Uint8Array | null; average: number }>({
        analyser: null,
        dataArray: null,
        average: 0
    });

    const initThree = useCallback(() => {
        if (!containerRef.current) return;

        const width = 600;
        const height = 600;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(60, 1, 1, 3000);
        camera.position.z = 600;

        const renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            powerPreference: 'high-performance'
        });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        
        if (containerRef.current) {
            containerRef.current.innerHTML = '';
            containerRef.current.appendChild(renderer.domElement);
        }

        const PARTICLE_COUNT = 800;
        const ORB_RADIUS = 180;
        
        // Initialize particles with data
        const particles: Particle[] = [];
        const positions = new Float32Array(PARTICLE_COUNT * 3);
        const colors = new Float32Array(PARTICLE_COUNT * 3);
        const sizes = new Float32Array(PARTICLE_COUNT);

        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = ORB_RADIUS * (0.5 + Math.random() * 0.5);
            
            const x = r * Math.sin(phi) * Math.cos(theta);
            const y = r * Math.sin(phi) * Math.sin(theta);
            const z = r * Math.cos(phi);
            
            const position = new THREE.Vector3(x, y, z);
            const basePosition = position.clone();
            
            particles.push({
                position,
                velocity: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.5,
                    (Math.random() - 0.5) * 0.5,
                    (Math.random() - 0.5) * 0.5
                ),
                basePosition,
                radius: 2 + Math.random() * 3,
                connections: new Set()
            });

            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;

            // Cyan to purple gradient based on position
            const t = (r / ORB_RADIUS);
            colors[i * 3] = 0.1 + t * 0.5;     // R
            colors[i * 3 + 1] = 0.8 - t * 0.5; // G
            colors[i * 3 + 2] = 0.9;           // B

            sizes[i] = 2 + Math.random() * 4;
        }

        particleDataRef.current = particles;

        // Particle geometry with custom shader
        const particleGeometry = new THREE.BufferGeometry();
        particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        particleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const particleMaterial = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                intensity: { value: 0 },
                pixelRatio: { value: renderer.getPixelRatio() }
            },
            vertexShader: `
                attribute float size;
                attribute vec3 color;
                varying vec3 vColor;
                varying float vSize;
                uniform float time;
                uniform float intensity;
                uniform float pixelRatio;
                
                void main() {
                    vColor = color;
                    vSize = size;
                    
                    vec3 pos = position;
                    
                    // Subtle breathing motion
                    float breathe = sin(time * 0.5) * 0.02;
                    pos *= (1.0 + breathe);
                    
                    // Audio reactivity - expand outward
                    pos *= (1.0 + intensity * 0.3);
                    
                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_PointSize = size * pixelRatio * (300.0 / -mvPosition.z) * (1.0 + intensity * 2.0);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vSize;
                uniform float intensity;
                
                void main() {
                    float dist = distance(gl_PointCoord, vec2(0.5));
                    if (dist > 0.5) discard;
                    
                    // Soft glow
                    float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
                    alpha = pow(alpha, 2.0);
                    
                    // Brighten with audio
                    float brightness = 1.0 + intensity * 1.5;
                    
                    gl_FragColor = vec4(vColor * brightness, alpha * 0.9);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            vertexColors: true
        });

        const points = new THREE.Points(particleGeometry, particleMaterial);
        scene.add(points);

        // Plexus lines - dynamic connections
        const maxConnections = PARTICLE_COUNT * 8;
        const linePositions = new Float32Array(maxConnections * 6); // 2 points * 3 coords
        const lineColors = new Float32Array(maxConnections * 6);
        
        const lineGeometry = new THREE.BufferGeometry();
        lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
        lineGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

        const lineMaterial = new THREE.ShaderMaterial({
            uniforms: {
                intensity: { value: 0 },
                time: { value: 0 }
            },
            vertexShader: `
                attribute vec3 color;
                varying vec3 vColor;
                void main() {
                    vColor = color;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                uniform float intensity;
                void main() {
                    float alpha = 0.15 + intensity * 0.4;
                    gl_FragColor = vec4(vColor * (1.0 + intensity), alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            vertexColors: true
        });

        const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
        scene.add(lines);

        // Inner core glow
        const coreGroup = new THREE.Group();
        
        // Inner core
        const innerCore = new THREE.Mesh(
            new THREE.SphereGeometry(60, 32, 32),
            new THREE.ShaderMaterial({
                uniforms: {
                    intensity: { value: 0 },
                    time: { value: 0 }
                },
                vertexShader: `
                    varying vec3 vNormal;
                    void main() {
                        vNormal = normal;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    varying vec3 vNormal;
                    uniform float intensity;
                    uniform float time;
                    
                    void main() {
                        float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);
                        float pulse = sin(time * 2.0) * 0.2 + 0.8;
                        float alpha = (0.3 + fresnel * 0.4) * (1.0 + intensity * 0.5) * pulse;
                        gl_FragColor = vec4(0.1, 0.8, 0.95, alpha);
                    }
                `,
                transparent: true,
                blending: THREE.AdditiveBlending,
                side: THREE.BackSide,
                depthWrite: false
            })
        );
        
        // Outer glow shell
        const outerShell = new THREE.Mesh(
            new THREE.SphereGeometry(140, 32, 32),
            new THREE.ShaderMaterial({
                uniforms: {
                    intensity: { value: 0 }
                },
                vertexShader: `
                    varying vec3 vNormal;
                    void main() {
                        vNormal = normal;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    varying vec3 vNormal;
                    uniform float intensity;
                    
                    void main() {
                        float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 3.0);
                        float alpha = fresnel * 0.15 * (1.0 + intensity * 0.3);
                        gl_FragColor = vec4(0.2, 0.5, 0.9, alpha);
                    }
                `,
                transparent: true,
                blending: THREE.AdditiveBlending,
                side: THREE.BackSide,
                depthWrite: false
            })
        );

        coreGroup.add(innerCore, outerShell);
        scene.add(coreGroup);

        // Ambient particles floating around
        const ambientCount = 200;
        const ambientPositions = new Float32Array(ambientCount * 3);
        for (let i = 0; i < ambientCount; i++) {
            const r = 250 + Math.random() * 150;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            ambientPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            ambientPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            ambientPositions[i * 3 + 2] = r * Math.cos(phi);
        }
        
        const ambientGeometry = new THREE.BufferGeometry();
        ambientGeometry.setAttribute('position', new THREE.BufferAttribute(ambientPositions, 3));
        const ambientMaterial = new THREE.PointsMaterial({
            size: 1,
            color: 0x22d3ee,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const ambientPoints = new THREE.Points(ambientGeometry, ambientMaterial);
        scene.add(ambientPoints);

        sceneRef.current = scene;
        rendererRef.current = renderer;
        cameraRef.current = camera;
        particlesRef.current = points;
        linesRef.current = lines;
        coreRef.current = coreGroup;

        return { PARTICLE_COUNT, ORB_RADIUS, maxConnections };
    }, []);

    useEffect(() => {
        const config = initThree();
        if (!config) return;

        const { PARTICLE_COUNT, ORB_RADIUS, maxConnections } = config;
        let time = 0;

        const animate = () => {
            requestRef.current = requestAnimationFrame(animate);
            
            if (!sceneRef.current || !cameraRef.current || !rendererRef.current) return;
            
            time += 0.008;
            
            // Get audio data
            let intensity = 0;
            if (audioRef.current.analyser && audioRef.current.dataArray) {
                audioRef.current.analyser.getByteFrequencyData(audioRef.current.dataArray);
                const data = audioRef.current.dataArray;
                let sum = 0;
                for (let i = 0; i < data.length; i++) {
                    sum += data[i];
                }
                audioRef.current.average = sum / data.length;
                intensity = Math.min(audioRef.current.average / 180, 1);
            } else {
                // Idle breathing
                intensity = (Math.sin(time * 3) + 1) * 0.1;
            }

            const particles = particleDataRef.current;
            const positions = particlesRef.current?.geometry.attributes.position.array as Float32Array;
            const linePosArray = linesRef.current?.geometry.attributes.position.array as Float32Array;
            const lineColorArray = linesRef.current?.geometry.attributes.color.array as Float32Array;

            // Update particles
            for (let i = 0; i < PARTICLE_COUNT; i++) {
                const p = particles[i];
                
                // Orbital motion
                const angle = time * 0.2 + i * 0.01;
                const orbitRadius = p.basePosition.length();
                const targetX = Math.cos(angle) * orbitRadius * (1 + intensity * 0.1);
                const targetY = Math.sin(angle * 1.3) * orbitRadius * (1 + intensity * 0.1);
                const targetZ = Math.sin(angle * 0.7) * orbitRadius * (1 + intensity * 0.1);
                
                // Smooth interpolation
                p.position.x += (targetX - p.position.x) * 0.02;
                p.position.y += (targetY - p.position.y) * 0.02;
                p.position.z += (targetZ - p.position.z) * 0.02;
                
                // Add subtle noise
                p.position.x += Math.sin(time + i) * 0.3;
                p.position.y += Math.cos(time * 1.1 + i) * 0.3;
                p.position.z += Math.sin(time * 0.8 + i * 0.5) * 0.3;

                if (positions) {
                    positions[i * 3] = p.position.x;
                    positions[i * 3 + 1] = p.position.y;
                    positions[i * 3 + 2] = p.position.z;
                }
            }

            if (particlesRef.current) {
                particlesRef.current.geometry.attributes.position.needsUpdate = true;
                (particlesRef.current.material as THREE.ShaderMaterial).uniforms.time.value = time;
                (particlesRef.current.material as THREE.ShaderMaterial).uniforms.intensity.value = intensity;
            }

            // Plexus connections - dynamic line drawing
            const connectionDistance = ORB_RADIUS * (0.4 + intensity * 0.3);
            let lineIndex = 0;
            
            for (let i = 0; i < PARTICLE_COUNT; i++) {
                for (let j = i + 1; j < PARTICLE_COUNT; j++) {
                    if (lineIndex >= maxConnections) break;
                    
                    const p1 = particles[i];
                    const p2 = particles[j];
                    const dx = p1.position.x - p2.position.x;
                    const dy = p1.position.y - p2.position.y;
                    const dz = p1.position.z - p2.position.z;
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    
                    if (dist < connectionDistance) {
                        const alpha = 1 - (dist / connectionDistance);
                        
                        if (linePosArray && lineColorArray) {
                            // Start point
                            linePosArray[lineIndex * 6] = p1.position.x;
                            linePosArray[lineIndex * 6 + 1] = p1.position.y;
                            linePosArray[lineIndex * 6 + 2] = p1.position.z;
                            
                            // End point
                            linePosArray[lineIndex * 6 + 3] = p2.position.x;
                            linePosArray[lineIndex * 6 + 4] = p2.position.y;
                            linePosArray[lineIndex * 6 + 5] = p2.position.z;
                            
                            // Colors with distance-based opacity
                            const colorIntensity = alpha * (0.3 + intensity * 0.7);
                            lineColorArray[lineIndex * 6] = 0.13 * colorIntensity;
                            lineColorArray[lineIndex * 6 + 1] = 0.83 * colorIntensity;
                            lineColorArray[lineIndex * 6 + 2] = 0.93 * colorIntensity;
                            
                            lineColorArray[lineIndex * 6 + 3] = 0.13 * colorIntensity;
                            lineColorArray[lineIndex * 6 + 4] = 0.83 * colorIntensity;
                            lineColorArray[lineIndex * 6 + 5] = 0.93 * colorIntensity;
                            
                            lineIndex++;
                        }
                    }
                }
            }

            if (linesRef.current) {
                linesRef.current.geometry.setDrawRange(0, lineIndex * 2);
                linesRef.current.geometry.attributes.position.needsUpdate = true;
                linesRef.current.geometry.attributes.color.needsUpdate = true;
                (linesRef.current.material as THREE.ShaderMaterial).uniforms.intensity.value = intensity;
                (linesRef.current.material as THREE.ShaderMaterial).uniforms.time.value = time;
            }

            // Update core
            if (coreRef.current) {
                const innerCore = coreRef.current.children[0] as THREE.Mesh;
                const outerShell = coreRef.current.children[1] as THREE.Mesh;
                
                if (innerCore.material instanceof THREE.ShaderMaterial) {
                    innerCore.material.uniforms.intensity.value = intensity;
                    innerCore.material.uniforms.time.value = time;
                }
                if (outerShell.material instanceof THREE.ShaderMaterial) {
                    outerShell.material.uniforms.intensity.value = intensity;
                }
                
                // Pulse scale with audio
                const scale = 1 + intensity * 0.15;
                coreRef.current.scale.setScalar(scale);
            }

            // Rotate entire scene
            if (sceneRef.current) {
                sceneRef.current.rotation.y += 0.003 + intensity * 0.02;
                sceneRef.current.rotation.x += 0.001;
            }

            rendererRef.current.render(sceneRef.current, cameraRef.current);
        };

        animate();

        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, [initThree]);

    // Audio connection
    useEffect(() => {
        if (!audioContext || !sourceNode) {
            audioRef.current = { analyser: null, dataArray: null, average: 0 };
            return;
        }

        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        sourceNode.connect(analyser);

        audioRef.current = {
            analyser,
            dataArray: new Uint8Array(analyser.frequencyBinCount),
            average: 0
        };

        return () => {
            try {
                sourceNode.disconnect(analyser);
            } catch (e) {}
        };
    }, [audioContext, sourceNode]);

    // Cleanup
    useEffect(() => {
        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
            if (rendererRef.current) {
                rendererRef.current.dispose();
            }
            if (containerRef.current) {
                containerRef.current.innerHTML = '';
            }
        };
    }, []);

    return (
        <div
            ref={containerRef}
            className="relative flex items-center justify-center w-full h-full bg-transparent overflow-hidden mix-blend-screen pointer-events-none"
            style={{ width: '600px', height: '600px' }}
        />
    );
};

export default PlexusOrb;