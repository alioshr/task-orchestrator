import { homedir } from 'os';
import { isAbsolute, join, resolve } from 'path';

export interface StoragePathEnv {
  TASK_ORCHESTRATOR_HOME?: string;
  HOME?: string;
}

function normalize(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resolveSystemHomeDirectory(env: StoragePathEnv, osHome?: string): string {
  const envHome = normalize(env.HOME);
  if (envHome && envHome !== '~') {
    return envHome;
  }

  const detectedHome = normalize(osHome ?? homedir());
  if (detectedHome) {
    return detectedHome;
  }

  throw new Error(
    'Unable to resolve user home directory. Set TASK_ORCHESTRATOR_HOME to an absolute path.'
  );
}

function expandTilde(pathValue: string, env: StoragePathEnv, osHome?: string): string {
  if (!pathValue.startsWith('~')) {
    return pathValue;
  }

  const home = resolveSystemHomeDirectory(env, osHome);
  if (pathValue === '~') {
    return home;
  }

  if (pathValue.startsWith('~/')) {
    return join(home, pathValue.slice(2));
  }

  throw new Error(
    `Invalid TASK_ORCHESTRATOR_HOME value "${pathValue}". Use an absolute path or "~/" prefix.`
  );
}

function toAbsolutePath(pathValue: string): string {
  return isAbsolute(pathValue) ? pathValue : resolve(pathValue);
}

export function resolveOrchestratorHomePathFromEnv(
  env: StoragePathEnv,
  osHome?: string
): string {
  const configured = normalize(env.TASK_ORCHESTRATOR_HOME);
  if (configured) {
    return toAbsolutePath(expandTilde(configured, env, osHome));
  }

  return join(resolveSystemHomeDirectory(env, osHome), '.task-orchestrator');
}

export function resolveOrchestratorHomePath(): string {
  return resolveOrchestratorHomePathFromEnv(process.env);
}

export function resolveOrchestratorDbPath(): string {
  return join(resolveOrchestratorHomePath(), 'tasks.db');
}

export function resolveOrchestratorConfigPath(): string {
  return join(resolveOrchestratorHomePath(), 'config.yaml');
}

export function resolveOrchestratorRuntimeDirPath(): string {
  return join(resolveOrchestratorHomePath(), 'runtime');
}

export function resolveOrchestratorRuntimeStatusPath(): string {
  return join(resolveOrchestratorRuntimeDirPath(), 'mcp-http-status.json');
}
