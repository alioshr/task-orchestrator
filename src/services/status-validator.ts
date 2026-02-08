/**
 * Config-driven status validator for Task Orchestrator v3.
 *
 * Pipeline transitions are linear: advance goes forward one step,
 * revert goes backward one step. Terminal states (CLOSED, WILL_NOT_IMPLEMENT)
 * allow no transitions out.
 *
 * Projects are stateless — no validation needed.
 */

import { getNextState, getPrevState, isTerminal as configIsTerminal, isValidState, getPipeline, EXIT_STATE } from '../config';

export type ContainerType = 'project' | 'feature' | 'task';

/**
 * Check whether a status is terminal (no transitions out).
 * For projects, always returns false (stateless).
 */
export function isTerminalStatus(containerType: ContainerType, status: string): boolean {
  if (containerType === 'project') return false;
  return configIsTerminal(containerType, status);
}

/**
 * Get allowed transitions from a given status.
 * In v3, this is at most: [nextState] for advance, [prevState] for revert,
 * plus WILL_NOT_IMPLEMENT (terminate) from any non-terminal state.
 * Projects return empty array.
 */
export function getAllowedTransitions(containerType: ContainerType, currentStatus: string): string[] {
  if (containerType === 'project') return [];
  if (!isValidState(containerType, currentStatus)) return [];
  if (isTerminalStatus(containerType, currentStatus)) return [];

  const transitions: string[] = [];

  const next = getNextState(containerType, currentStatus);
  if (next) transitions.push(next);

  const prev = getPrevState(containerType, currentStatus);
  if (prev) transitions.push(prev);

  transitions.push(EXIT_STATE);

  return transitions;
}

/**
 * Check if a specific transition is valid.
 * Projects always return false (no status transitions).
 */
export function isValidTransition(containerType: ContainerType, from: string, to: string): boolean {
  if (containerType === 'project') return false;
  const allowed = getAllowedTransitions(containerType, from);
  return allowed.includes(to);
}

/**
 * Check if a status string is recognized for the given entity type.
 * Projects always return true (no status).
 */
export function isStatusValid(containerType: ContainerType, status: string): boolean {
  if (containerType === 'project') return true;
  return isValidState(containerType, status);
}
