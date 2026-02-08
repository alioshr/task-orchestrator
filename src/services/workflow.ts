/**
 * Workflow service for Task Orchestrator v3.
 *
 * Returns lean workflow state payload for tasks and features.
 * Projects are stateless — query_workflow_state is not supported for projects.
 */

import type { ContainerType } from './status-validator';
import { isTerminalStatus } from './status-validator';
import { getFeature } from '../repos/features';
import { getTask } from '../repos/tasks';
import { getNextState, getPrevState, getPipelinePosition, EXIT_STATE } from '../config';
import type { Result } from '../domain/types';
import { ok, err } from '../repos/base';

export interface WorkflowState {
  containerType: ContainerType;
  id: string;
  currentStatus: string;
  nextStatus: string | null;
  prevStatus: string | null;
  isTerminal: boolean;
  isBlocked: boolean;
  blockedBy: string[];
  blockedReason: string | null;
  pipelinePosition: string | null;
  relatedEntities: string[];
}

export function getWorkflowState(containerType: ContainerType, id: string): Result<WorkflowState> {
  if (containerType === 'project') {
    return err('Projects are stateless boards — workflow state is not applicable.', 'VALIDATION_ERROR');
  }

  const entityType = containerType as 'feature' | 'task';

  let currentStatus: string;
  let blockedBy: string[] = [];
  let blockedReason: string | null = null;
  let relatedTo: string[] = [];

  if (entityType === 'feature') {
    const result = getFeature(id);
    if (!result.success) return err(result.error, result.code);
    currentStatus = result.data.status;
    blockedBy = result.data.blockedBy;
    blockedReason = result.data.blockedReason ?? null;
    relatedTo = result.data.relatedTo;
  } else {
    const result = getTask(id);
    if (!result.success) return err(result.error, result.code);
    currentStatus = result.data.status;
    blockedBy = result.data.blockedBy;
    blockedReason = result.data.blockedReason ?? null;
    relatedTo = result.data.relatedTo;
  }

  const isTerminal = isTerminalStatus(containerType, currentStatus);
  const isBlocked = blockedBy.length > 0;

  const state: WorkflowState = {
    containerType,
    id,
    currentStatus,
    nextStatus: getNextState(entityType, currentStatus),
    prevStatus: getPrevState(entityType, currentStatus),
    isTerminal,
    isBlocked,
    blockedBy,
    blockedReason,
    pipelinePosition: getPipelinePosition(entityType, currentStatus),
    relatedEntities: relatedTo,
  };

  return ok(state);
}
