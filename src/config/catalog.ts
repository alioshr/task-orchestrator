/**
 * State catalogs and pipeline validation for Task Orchestrator v3.
 *
 * Catalogs define the full set of allowed states.
 * Pipelines select a subset for linear progression.
 * WILL_NOT_IMPLEMENT is an exit state, never part of a pipeline.
 */

export const FEATURE_CATALOG = ['NEW', 'ACTIVE', 'READY_TO_PROD', 'CLOSED'] as const;
export const TASK_CATALOG = ['NEW', 'ACTIVE', 'TO_BE_TESTED', 'READY_TO_PROD', 'CLOSED'] as const;

export const EXIT_STATE = 'WILL_NOT_IMPLEMENT';

export const PIPELINE_MINIMUM_CONSTRAINTS = {
  feature: ['NEW', 'ACTIVE', 'CLOSED'] as const,
  task: ['NEW', 'ACTIVE', 'CLOSED'] as const,
};

export type FeatureState = (typeof FEATURE_CATALOG)[number] | typeof EXIT_STATE;
export type TaskState = (typeof TASK_CATALOG)[number] | typeof EXIT_STATE;

/**
 * Validate that a pipeline array is a valid subset of its catalog.
 * Rules:
 * - Must start with the catalog's first state
 * - Must contain ACTIVE
 * - Must end with CLOSED (the terminal pipeline state)
 * - All states must be in the catalog
 * - States must appear in catalog order (no reordering)
 * - Minimum constraints must be met
 */
export function validatePipeline(
  entityType: 'feature' | 'task',
  pipeline: string[]
): { valid: boolean; error?: string } {
  const catalog = entityType === 'feature' ? FEATURE_CATALOG : TASK_CATALOG;
  const minimums = PIPELINE_MINIMUM_CONSTRAINTS[entityType];

  if (pipeline.length < minimums.length) {
    return { valid: false, error: `Pipeline must have at least ${minimums.length} states: ${minimums.join(', ')}` };
  }

  // All states must be in catalog
  for (const state of pipeline) {
    if (!(catalog as readonly string[]).includes(state)) {
      return { valid: false, error: `Unknown state '${state}' for ${entityType}. Allowed: ${catalog.join(', ')}` };
    }
  }

  // Must contain minimum constraints
  for (const required of minimums) {
    if (!pipeline.includes(required)) {
      return { valid: false, error: `Pipeline must include '${required}'` };
    }
  }

  // Must start with first catalog state
  const expectedFirst = 'NEW';
  if (pipeline[0] !== expectedFirst) {
    return { valid: false, error: `Pipeline must start with '${expectedFirst}'` };
  }

  // Must end with CLOSED
  if (pipeline[pipeline.length - 1] !== 'CLOSED') {
    return { valid: false, error: `Pipeline must end with 'CLOSED'` };
  }

  // States must appear in catalog order
  let lastIndex = -1;
  for (const state of pipeline) {
    const idx = (catalog as readonly string[]).indexOf(state);
    if (idx <= lastIndex) {
      return { valid: false, error: `States must appear in catalog order. '${state}' is out of order.` };
    }
    lastIndex = idx;
  }

  return { valid: true };
}
