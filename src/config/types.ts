/**
 * Configuration types for Task Orchestrator v3.
 *
 * Pipelines are arrays of status strings defining the linear progression
 * for features and tasks. Config is loaded from YAML at boot time.
 */

export interface OrchestratorConfig {
  version: string;
  pipelines: {
    feature: string[];
    task: string[];
  };
}

export interface PipelineInfo {
  states: string[];
  first: string;
  last: string;
  terminal: string[];
}
