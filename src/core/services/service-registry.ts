/**
 * Service Registry
 * 
 * Manages the lifecycle of all Nexus Claire services (Chat, Awareness, Goals, etc.)
 */

export interface Service {
    name: string;
    start(): Promise<void>;
    stop(): Promise<void>;
    status(): "stopped" | "running" | "error";
}

export class ServiceRegistry {
    private services: Map<string, Service> = new Map();

    register(service: Service) {
        this.services.set(service.name, service);
        console.log(`[REGISTRY] Registered service: ${service.name}`);
    }

    async startAll() {
        console.log("[REGISTRY] Starting all services...");
        for (const service of this.services.values()) {
            await service.start();
        }
    }

    async stopAll() {
        console.log("[REGISTRY] Stopping all services...");
        for (const service of this.services.values()) {
            await service.stop();
        }
    }

    getService<T extends Service>(name: string): T | undefined {
        return this.services.get(name) as T;
    }
}
