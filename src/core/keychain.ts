/**
 * ╔══════════════════════════════════════════════════════╗
 * ║       NEXUS CLAIRE — KEYCHAIN v1.0                   ║
 * ║       Encrypted Credential Storage                   ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * Secure local storage for social media and API credentials.
 * Data is encrypted AES-256-GCM. 
 * Requires a Master PIN provided securely from the dashboard/CLI to unlock.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

export class NexusKeychain {
    private storagePath: string;
    private masterKey: Buffer | null = null;
    private keys: Record<string, string> = {}; // Decrypted state (only in memory)

    constructor() {
        const dataDir = join(process.cwd(), "data");
        if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
        this.storagePath = join(dataDir, "nexus-keychain.enc");
    }

    /**
     * Unlock the keychain using a user-provided PIN/Password.
     * The PIN is passed through a basic KDF to generate an AES key.
     */
    public unlock(pin: string): boolean {
        // Derive a 32-byte key from the PIN (simple sha256 for demo, bcrypt/scrypt is better for prod)
        const hash = new Bun.CryptoHasher("sha256").update(pin).digest();
        this.masterKey = Buffer.from(hash);

        if (!existsSync(this.storagePath)) {
            // New keychain
            this.keys = {};
            this.save();
            console.log("[KEYCHAIN] New encrypted keychain created.");
            return true;
        }

        try {
            const encryptedData = readFileSync(this.storagePath, "utf8");
            const parsed = JSON.parse(encryptedData);

            const iv = Buffer.from(parsed.iv, "hex");
            const authTag = Buffer.from(parsed.authTag, "hex");
            const ciphertext = Buffer.from(parsed.data, "hex");

            const decipher = createDecipheriv("aes-256-gcm", this.masterKey, iv);
            decipher.setAuthTag(authTag);

            let decrypted = decipher.update(ciphertext);
            decrypted = Buffer.concat([decrypted, decipher.final()]);

            this.keys = JSON.parse(decrypted.toString("utf8"));
            console.log(`[KEYCHAIN] Unlocked. Loaded ${Object.keys(this.keys).length} credentials.`);
            return true;
        } catch (e) {
            console.error("[KEYCHAIN] Failed to unlock. Incorrect PIN or corrupted data.");
            this.masterKey = null;
            return false;
        }
    }

    public isUnlocked(): boolean {
        return this.masterKey !== null;
    }

    public get(id: string): string | null {
        if (!this.isUnlocked()) throw new Error("Keychain is locked.");
        return this.keys[id] || null;
    }

    public set(id: string, value: string): void {
        if (!this.isUnlocked()) throw new Error("Keychain is locked.");
        this.keys[id] = value;
        this.save();
    }

    public listKeys(): string[] {
        if (!this.isUnlocked()) throw new Error("Keychain is locked.");
        return Object.keys(this.keys);
    }

    private save(): void {
        if (!this.masterKey) return;

        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", this.masterKey, iv);

        let encrypted = cipher.update(JSON.stringify(this.keys), "utf8");
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        const authTag = cipher.getAuthTag();

        const payload = {
            iv: iv.toString("hex"),
            authTag: authTag.toString("hex"),
            data: encrypted.toString("hex")
        };

        writeFileSync(this.storagePath, JSON.stringify(payload, null, 2), "utf8");
    }
}

export const keychain = new NexusKeychain();
