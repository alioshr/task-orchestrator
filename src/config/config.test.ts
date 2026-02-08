import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { stringify as stringifyYaml } from 'yaml';
import {
  validatePipeline,
  loadConfig,
  writeDefaultConfig,
  generateDefaultConfig,
  initConfig,
  getNextState,
  getPrevState,
  isTerminal,
  isValidState,
  getPipelinePosition,
  getFeaturePipeline,
  getTaskPipeline,
  resetConfig,
  EXIT_STATE,
} from './index';

const TEST_DIR = join(import.meta.dir, '../../.test-config');

function writeTestConfig(content: object, path?: string): string {
  const configPath = path ?? join(TEST_DIR, 'config.yaml');
  mkdirSync(join(configPath, '..'), { recursive: true });
  writeFileSync(configPath, stringifyYaml(content), 'utf-8');
  return configPath;
}

beforeEach(() => {
  resetConfig();
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  resetConfig();
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

// ============================================================================
// validatePipeline
// ============================================================================

describe('validatePipeline', () => {
  test('accepts minimal feature pipeline', () => {
    const result = validatePipeline('feature', ['NEW', 'ACTIVE', 'CLOSED']);
    expect(result.valid).toBe(true);
  });

  test('accepts full feature pipeline', () => {
    const result = validatePipeline('feature', ['NEW', 'ACTIVE', 'READY_TO_PROD', 'CLOSED']);
    expect(result.valid).toBe(true);
  });

  test('accepts minimal task pipeline', () => {
    const result = validatePipeline('task', ['NEW', 'ACTIVE', 'CLOSED']);
    expect(result.valid).toBe(true);
  });

  test('accepts full task pipeline', () => {
    const result = validatePipeline('task', ['NEW', 'ACTIVE', 'TO_BE_TESTED', 'READY_TO_PROD', 'CLOSED']);
    expect(result.valid).toBe(true);
  });

  test('rejects pipeline missing ACTIVE', () => {
    const result = validatePipeline('task', ['NEW', 'CLOSED']);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('ACTIVE');
  });

  test('rejects pipeline not starting with first state', () => {
    const result = validatePipeline('task', ['ACTIVE', 'CLOSED']);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('NEW');
  });

  test('rejects pipeline not ending with CLOSED', () => {
    const result = validatePipeline('task', ['NEW', 'ACTIVE']);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('CLOSED');
  });

  test('rejects unknown state', () => {
    const result = validatePipeline('task', ['NEW', 'ACTIVE', 'BOGUS', 'CLOSED']);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('BOGUS');
  });

  test('rejects out-of-order states', () => {
    const result = validatePipeline('task', ['NEW', 'TO_BE_TESTED', 'ACTIVE', 'CLOSED']);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('out of order');
  });

  test('rejects too-short pipeline', () => {
    const result = validatePipeline('task', ['NEW', 'CLOSED']);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('at least');
  });
});

// ============================================================================
// loadConfig
// ============================================================================

describe('loadConfig', () => {
  test('returns defaults when config file does not exist', () => {
    const config = loadConfig(join(TEST_DIR, 'nonexistent.yaml'));
    expect(config.version).toBe('3.0');
    expect(config.pipelines.feature).toEqual(['NEW', 'ACTIVE', 'CLOSED']);
    expect(config.pipelines.task).toEqual(['NEW', 'ACTIVE', 'CLOSED']);
  });

  test('loads valid config from file', () => {
    const configPath = writeTestConfig({
      version: '3.0',
      pipelines: {
        feature: ['NEW', 'ACTIVE', 'READY_TO_PROD', 'CLOSED'],
        task: ['NEW', 'ACTIVE', 'TO_BE_TESTED', 'CLOSED'],
      },
    });
    const config = loadConfig(configPath);
    expect(config.pipelines.feature).toEqual(['NEW', 'ACTIVE', 'READY_TO_PROD', 'CLOSED']);
    expect(config.pipelines.task).toEqual(['NEW', 'ACTIVE', 'TO_BE_TESTED', 'CLOSED']);
  });

  test('throws on wrong version', () => {
    const configPath = writeTestConfig({
      version: '2.0',
      pipelines: { feature: ['NEW', 'ACTIVE', 'CLOSED'], task: ['NEW', 'ACTIVE', 'CLOSED'] },
    });
    expect(() => loadConfig(configPath)).toThrow('Unsupported config version');
  });

  test('throws on invalid pipeline', () => {
    const configPath = writeTestConfig({
      version: '3.0',
      pipelines: { feature: ['ACTIVE', 'CLOSED'], task: ['NEW', 'ACTIVE', 'CLOSED'] },
    });
    expect(() => loadConfig(configPath)).toThrow('Invalid feature pipeline');
  });
});

// ============================================================================
// writeDefaultConfig
// ============================================================================

describe('writeDefaultConfig', () => {
  test('writes a loadable config file', () => {
    const configPath = join(TEST_DIR, 'generated.yaml');
    writeDefaultConfig(configPath);
    const config = loadConfig(configPath);
    expect(config.version).toBe('3.0');
    expect(config.pipelines.feature).toEqual(['NEW', 'ACTIVE', 'CLOSED']);
  });
});

// ============================================================================
// Transition helpers
// ============================================================================

describe('transition helpers', () => {
  beforeEach(() => {
    initConfig({
      version: '3.0',
      pipelines: {
        feature: ['NEW', 'ACTIVE', 'READY_TO_PROD', 'CLOSED'],
        task: ['NEW', 'ACTIVE', 'TO_BE_TESTED', 'CLOSED'],
      },
    });
  });

  test('getNextState returns next state', () => {
    expect(getNextState('task', 'NEW')).toBe('ACTIVE');
    expect(getNextState('task', 'ACTIVE')).toBe('TO_BE_TESTED');
    expect(getNextState('task', 'CLOSED')).toBeNull();
  });

  test('getPrevState returns previous state', () => {
    expect(getPrevState('task', 'ACTIVE')).toBe('NEW');
    expect(getPrevState('task', 'NEW')).toBeNull();
  });

  test('isTerminal checks terminal states', () => {
    expect(isTerminal('task', 'CLOSED')).toBe(true);
    expect(isTerminal('task', 'WILL_NOT_IMPLEMENT')).toBe(true);
    expect(isTerminal('task', 'ACTIVE')).toBe(false);
  });

  test('isValidState includes pipeline states and EXIT_STATE', () => {
    expect(isValidState('task', 'NEW')).toBe(true);
    expect(isValidState('task', 'WILL_NOT_IMPLEMENT')).toBe(true);
    expect(isValidState('task', 'BOGUS')).toBe(false);
  });

  test('getPipelinePosition returns position string', () => {
    expect(getPipelinePosition('task', 'NEW')).toBe('1 of 4');
    expect(getPipelinePosition('task', 'CLOSED')).toBe('4 of 4');
    expect(getPipelinePosition('task', 'WILL_NOT_IMPLEMENT')).toBeNull();
  });

  test('getFeaturePipeline returns pipeline info', () => {
    const p = getFeaturePipeline();
    expect(p.first).toBe('NEW');
    expect(p.last).toBe('CLOSED');
    expect(p.terminal).toContain('CLOSED');
    expect(p.terminal).toContain('WILL_NOT_IMPLEMENT');
  });

  test('getTaskPipeline returns pipeline info', () => {
    const p = getTaskPipeline();
    expect(p.first).toBe('NEW');
    expect(p.last).toBe('CLOSED');
  });
});
