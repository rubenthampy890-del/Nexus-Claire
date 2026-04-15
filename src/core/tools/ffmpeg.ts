/**
 * FFmpeg Tool: Video/Audio processing via the FFmpeg CLI.
 * Nexus can convert, trim, extract, and manipulate multimedia files.
 */

import { toolRegistry } from "../tool-registry";
import { exec } from "node:child_process";

export function registerFFmpegTools() {
    toolRegistry.register({
        name: "ffmpeg.run",
        description: "Run an FFmpeg command for video/audio processing. Provide the full FFmpeg argument string (e.g., '-i input.mp4 -vf scale=1280:-1 output.mp4'). Do NOT include the 'ffmpeg' binary name itself.",
        category: "general",
        provenance: "core",
        riskLevel: "moderate",
        timeout: 120000,
        parameters: {
            args: { type: "string", description: "FFmpeg arguments (everything after 'ffmpeg')", required: true }
        },
        execute: async (params) => {
            const args = params.args?.trim();
            if (!args) return "[ERROR] No FFmpeg arguments provided.";

            return new Promise<string>((resolve) => {
                const cmd = `ffmpeg ${args}`;
                exec(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 120000 }, (error, stdout, stderr) => {
                    if (error) {
                        resolve(`[FFMPEG ERROR] ${error.message}\n${stderr}`);
                    } else {
                        resolve(`[FFMPEG OK]\n${stdout || stderr || 'Command completed successfully.'}`);
                    }
                });
            });
        }
    });

    toolRegistry.register({
        name: "ffmpeg.info",
        description: "Get detailed information about a media file using ffprobe. Returns codec, duration, resolution, bitrate, etc.",
        category: "general",
        provenance: "core",
        riskLevel: "safe",
        timeout: 30000,
        parameters: {
            path: { type: "string", description: "Absolute path to the media file", required: true }
        },
        execute: async (params) => {
            const filePath = params.path?.trim();
            if (!filePath) return "[ERROR] No file path provided.";

            return new Promise<string>((resolve) => {
                const cmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`;
                exec(cmd, { maxBuffer: 5 * 1024 * 1024, timeout: 30000 }, (error, stdout, stderr) => {
                    if (error) {
                        resolve(`[FFPROBE ERROR] ${error.message}\n${stderr}`);
                    } else {
                        try {
                            const info = JSON.parse(stdout);
                            const format = info.format || {};
                            const videoStream = info.streams?.find((s: any) => s.codec_type === 'video');
                            const audioStream = info.streams?.find((s: any) => s.codec_type === 'audio');

                            let summary = `File: ${format.filename || filePath}\n`;
                            summary += `Duration: ${format.duration ? `${parseFloat(format.duration).toFixed(1)}s` : 'unknown'}\n`;
                            summary += `Size: ${format.size ? `${(parseInt(format.size) / 1024 / 1024).toFixed(2)} MB` : 'unknown'}\n`;
                            summary += `Bitrate: ${format.bit_rate ? `${(parseInt(format.bit_rate) / 1000).toFixed(0)} kbps` : 'unknown'}\n`;

                            if (videoStream) {
                                summary += `Video: ${videoStream.codec_name} ${videoStream.width}x${videoStream.height} @ ${videoStream.r_frame_rate} fps\n`;
                            }
                            if (audioStream) {
                                summary += `Audio: ${audioStream.codec_name} ${audioStream.channels}ch ${audioStream.sample_rate}Hz\n`;
                            }

                            resolve(summary);
                        } catch {
                            resolve(stdout);
                        }
                    }
                });
            });
        }
    });

    toolRegistry.register({
        name: "ffmpeg.extract_audio",
        description: "Extract the audio track from a video file.",
        category: "general",
        provenance: "core",
        riskLevel: "safe",
        timeout: 120000,
        parameters: {
            input: { type: "string", description: "Absolute path to the input video file", required: true },
            output: { type: "string", description: "Absolute path for the output audio file (e.g., output.mp3)", required: true }
        },
        execute: async (params) => {
            const { input, output } = params;
            if (!input || !output) return "[ERROR] Both input and output paths are required.";

            return new Promise<string>((resolve) => {
                const cmd = `ffmpeg -i "${input}" -vn -acodec libmp3lame -q:a 2 "${output}" -y`;
                exec(cmd, { maxBuffer: 5 * 1024 * 1024, timeout: 120000 }, (error, _stdout, stderr) => {
                    if (error) {
                        resolve(`[FFMPEG ERROR] ${error.message}\n${stderr}`);
                    } else {
                        resolve(`[FFMPEG OK] Audio extracted to: ${output}`);
                    }
                });
            });
        }
    });
}
