import { execSync } from 'child_process';
import { PlatformUtils } from "./platform";

/**
 * Returns a report containing the current CPU usage.
 * @returns A string containing the CPU usage data.
 */
export function getReport(): string {
  try {
    const output = PlatformUtils.getCPUUsageSync().toString();
    return output;
  } catch (error) {
    return `Error retrieving CPU usage: ${error instanceof Error ? error.message : String(error)}`;
  }
}
