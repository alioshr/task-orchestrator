/**
 * Config loading, defaults, and transition helpers for Task Orchestrator v3.
 *
 * Config is a YAML file at TASK_ORCHESTRATOR_HOME/config.yaml.
 * Once data exists in the DB, pipeline changes in config are ignored.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { OrchestratorConfig, PipelineInfo } from './types';
import { validatePipeline, EXIT_STATE } from './catalog';
import { db } from '../db/client';
import {
  resolveOrchestratorHomePath,
  resolveOrchestratorDbPath,
  resolveOrchestratorConfigPath,
} from '../storage-paths';

export { EXIT_STATE } from './catalog';
export type { OrchestratorConfig, PipelineInfo } from './types';
export { validatePipeline, FEATURE_CATALOG, TASK_CATALOG, PIPELINE_MINIMUM_CONSTRAINTS } from './catalog';
export type { FeatureState, TaskState } from './catalog';

const DEFAULT_CONFIG: OrchestratorConfig = {
  version: '3.0',
  pipelines: {
    feature: ['NEW', 'ACTIVE', 'CLOSED'],
    task: ['NEW', 'ACTIVE', 'CLOSED'],
  },
};

const CONFIG_COMMENT = `# Task Orchestrator v3 Configuration
#
# Pipelines define the linear status progression for features and tasks.
# States must appear in catalog order. WILL_NOT_IMPLEMENT is always available
# as an exit state and should NOT be listed in pipelines.
#
# Optional states you can add before data exists:
#   feature: READY_TO_PROD (between ACTIVE and CLOSED)
#   task: TO_BE_TESTED (between ACTIVE and READY_TO_PROD)
#         READY_TO_PROD (between TO_BE_TESTED/ACTIVE and CLOSED)
#
# Example with all optional states enabled:
#   feature: [NEW, ACTIVE, READY_TO_PROD, CLOSED]
#   task: [NEW, ACTIVE, TO_BE_TESTED, READY_TO_PROD, CLOSED]
#
# Once the database contains records, pipeline edits are ignored.
# To reconfigure, run sync with override: true (backs up existing DB).
`;

const PIPELINE_CONFIG_TABLE = '_pipeline_config';

let _config: OrchestratorConfig | null = null;
let _featurePipeline: PipelineInfo | null = null;
let _taskPipeline: PipelineInfo | null = null;

export function getHomePath(): string {
  return resolveOrchestratorHomePath();
}

export function getDbPath(): string {
  return resolveOrchestratorDbPath();
}

export function getConfigPath(): string {
  return resolveOrchestratorConfigPath();
}

export function generateDefaultConfig(): string {
  const yamlContent = stringifyYaml(DEFAULT_CONFIG);
  return CONFIG_COMMENT + yamlContent;
}

export function writeDefaultConfig(configPath: string): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, generateDefaultConfig(), 'utf-8');
}

export function loadConfig(configPath?: string): OrchestratorConfig {
  const path = configPath ?? getConfigPath();

  if (!existsSync(path)) {
    return { ...DEFAULT_CONFIG };
  }

  const raw = readFileSync(path, 'utf-8');
  const parsed = parseYaml(raw);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid config file at ${path}: expected YAML object`);
  }

  const config = parsed as OrchestratorConfig;

  const version = String((config as any).version);
  if (version !== '3.0' && version !== '3') {
    throw new Error(`Unsupported config version: ${config.version}. Expected '3.0'.`);
  }

  if (!config.pipelines?.feature || !Array.isArray(config.pipelines.feature)) {
    throw new Error('Config missing pipelines.feature array');
  }

  if (!config.pipelines?.task || !Array.isArray(config.pipelines.task)) {
    throw new Error('Config missing pipelines.task array');
  }

  const normalized: OrchestratorConfig = {
    version: '3.0',
    pipelines: {
      feature: config.pipelines.feature.map(s => String(s)),
      task: config.pipelines.task.map(s => String(s)),
    },
  };

  // Validate pipelines
  const featureResult = validatePipeline('feature', normalized.pipelines.feature);
  if (!featureResult.valid) {
    throw new Error(`Invalid feature pipeline: ${featureResult.error}`);
  }

  const taskResult = validatePipeline('task', normalized.pipelines.task);
  if (!taskResult.valid) {
    throw new Error(`Invalid task pipeline: ${taskResult.error}`);
  }

  return normalized;
}

function buildPipelineInfo(states: string[]): PipelineInfo {
  if (states.length === 0) {
    throw new Error('Pipeline cannot be empty');
  }

  const first = states[0];
  const last = states[states.length - 1];
  if (!first || !last) {
    throw new Error('Pipeline first/last state cannot be undefined');
  }

  return {
    states,
    first,
    last,
    terminal: [last, EXIT_STATE],
  };
}

function ensurePipelineConfigTable(): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS ${PIPELINE_CONFIG_TABLE} (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

function hasWorkflowData(): boolean {
  const tables = ['projects', 'features', 'tasks'];

  for (const table of tables) {
    try {
      const row = db.query<{ count: number }, []>(`SELECT COUNT(*) as count FROM ${table}`).get();
      if ((row?.count ?? 0) > 0) return true;
    } catch {
      // Table may not exist yet (pre-migration bootstrap)
      return false;
    }
  }

  return false;
}

function readLockedConfig(): OrchestratorConfig | null {
  const row = db.query<{ config_json: string }, []>(
    `SELECT config_json FROM ${PIPELINE_CONFIG_TABLE} WHERE id = 1`
  ).get();
  if (!row) return null;

  try {
    const parsed = JSON.parse(row.config_json) as OrchestratorConfig;
    const featureResult = validatePipeline('feature', parsed.pipelines.feature);
    const taskResult = validatePipeline('task', parsed.pipelines.task);
    if (!featureResult.valid || !taskResult.valid) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLockedConfig(config: OrchestratorConfig): void {
  db.run(
    `INSERT INTO ${PIPELINE_CONFIG_TABLE} (id, config_json, updated_at)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       config_json = excluded.config_json,
       updated_at = excluded.updated_at`,
    [JSON.stringify(config), new Date().toISOString()]
  );
}

function resolveEffectiveConfig(loadedConfig: OrchestratorConfig): OrchestratorConfig {
  ensurePipelineConfigTable();
  const dataExists = hasWorkflowData();
  const lockedConfig = readLockedConfig();

  // Before data exists, keep lock row synced to file so users can still tune pipelines.
  if (!dataExists) {
    writeLockedConfig(loadedConfig);
    return loadedConfig;
  }

  // Once data exists, ignore file edits and stick to the locked pipeline.
  if (lockedConfig) {
    return lockedConfig;
  }

  // Fallback for first boot on pre-lock databases that already contain data.
  writeLockedConfig(loadedConfig);
  return loadedConfig;
}

export function initConfig(config?: OrchestratorConfig): void {
  const loaded = config ?? loadConfig();
  const cfg = resolveEffectiveConfig(loaded);
  _config = cfg;
  _featurePipeline = buildPipelineInfo(cfg.pipelines.feature);
  _taskPipeline = buildPipelineInfo(cfg.pipelines.task);
}

export function getConfig(): OrchestratorConfig {
  if (!_config) {
    initConfig();
  }
  return _config!;
}

export function getFeaturePipeline(): PipelineInfo {
  if (!_featurePipeline) {
    initConfig();
  }
  return _featurePipeline!;
}

export function getTaskPipeline(): PipelineInfo {
  if (!_taskPipeline) {
    initConfig();
  }
  return _taskPipeline!;
}

export function getPipeline(entityType: 'feature' | 'task'): PipelineInfo {
  return entityType === 'feature' ? getFeaturePipeline() : getTaskPipeline();
}

/**
 * Get the next state in the pipeline (advance).
 * Returns null if already at the last state.
 */
export function getNextState(entityType: 'feature' | 'task', currentState: string): string | null {
  const pipeline = getPipeline(entityType);
  const idx = pipeline.states.indexOf(currentState);
  if (idx === -1 || idx >= pipeline.states.length - 1) return null;
  return pipeline.states[idx + 1] ?? null;
}

/**
 * Get the previous state in the pipeline (revert).
 * Returns null if already at the first state.
 */
export function getPrevState(entityType: 'feature' | 'task', currentState: string): string | null {
  const pipeline = getPipeline(entityType);
  const idx = pipeline.states.indexOf(currentState);
  if (idx <= 0) return null;
  return pipeline.states[idx - 1] ?? null;
}

/**
 * Check if a state is terminal (CLOSED or WILL_NOT_IMPLEMENT).
 */
export function isTerminal(entityType: 'feature' | 'task', state: string): boolean {
  const pipeline = getPipeline(entityType);
  return pipeline.terminal.includes(state);
}

/**
 * Check if a state is in the configured pipeline (or is EXIT_STATE).
 */
export function isValidState(entityType: 'feature' | 'task', state: string): boolean {
  if (state === EXIT_STATE) return true;
  const pipeline = getPipeline(entityType);
  return pipeline.states.includes(state);
}

/**
 * Get pipeline position as "N of M" string.
 */
export function getPipelinePosition(entityType: 'feature' | 'task', state: string): string | null {
  if (state === EXIT_STATE) return null;
  const pipeline = getPipeline(entityType);
  const idx = pipeline.states.indexOf(state);
  if (idx === -1) return null;
  return `${idx + 1} of ${pipeline.states.length}`;
}

/**
 * Reset loaded config (for testing).
 */
export function resetConfig(): void {
  _config = null;
  _featurePipeline = null;
  _taskPipeline = null;
}
