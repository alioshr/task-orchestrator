import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { resolveOrchestratorRuntimeStatusPath } from './storage-paths';

export interface RuntimeStatus {
  transport: 'http';
  mcpUrl: string;
  statusUrl: string;
  host: string;
  port: number;
  pid: number;
  version: string;
  homePath: string;
  updatedAt: string;
}

function getRuntimeStatusPath(): string {
  return resolveOrchestratorRuntimeStatusPath();
}

export function writeRuntimeStatus(status: RuntimeStatus): void {
  const statusPath = getRuntimeStatusPath();
  mkdirSync(dirname(statusPath), { recursive: true });

  const tempPath = `${statusPath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  renameSync(tempPath, statusPath);
}

export function readRuntimeStatus(): RuntimeStatus | null {
  const statusPath = getRuntimeStatusPath();
  if (!existsSync(statusPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(statusPath, 'utf8')) as RuntimeStatus;
  } catch {
    return null;
  }
}

export function clearRuntimeStatus(): void {
  const statusPath = getRuntimeStatusPath();
  try {
    rmSync(statusPath);
  } catch {}
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

