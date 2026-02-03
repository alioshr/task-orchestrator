import type { ContainerType } from './status-validator';
import { getAllowedTransitions, isTerminalStatus, isValidStatus } from './status-validator';
import { getProject } from '../repos/projects';
import { getFeature } from '../repos/features';
import { getTask } from '../repos/tasks';
import { getDependencies } from '../repos/dependencies';
import { searchTasks } from '../repos/tasks';
import type { Result } from '../domain/types';
import { ok, err } from '../repos/base';

export interface WorkflowState {
  containerType: ContainerType;
  id: string;
  currentStatus: string;
  allowedTransitions: string[];
  isTerminal: boolean;
  cascadeEvents?: string[];
  blockingDependencies?: Array<{
    taskId: string;
    taskTitle: string;
    status: string;
  }>;
}

export function getWorkflowState(containerType: ContainerType, id: string): Result<WorkflowState> {
  // 1. Get entity
  let currentStatus: string;

  switch (containerType) {
    case 'project': {
      const result = getProject(id);
      if (!result.success) return err(result.error, result.code);
      currentStatus = result.data.status;
      break;
    }
    case 'feature': {
      const result = getFeature(id);
      if (!result.success) return err(result.error, result.code);
      currentStatus = result.data.status;
      break;
    }
    case 'task': {
      const result = getTask(id);
      if (!result.success) return err(result.error, result.code);
      currentStatus = result.data.status;
      break;
    }
  }

  // 2. Get allowed transitions
  const allowedTransitions = getAllowedTransitions(containerType, currentStatus);
  const isTerminal = isTerminalStatus(containerType, currentStatus);

  // 3. Build state
  const state: WorkflowState = {
    containerType,
    id,
    currentStatus,
    allowedTransitions,
    isTerminal,
  };

  // 4. For tasks, check blocking dependencies
  if (containerType === 'task') {
    const depsResult = getDependencies(id, 'dependents');
    if (depsResult.success) {
      const blockers = depsResult.data
        .filter(d => d.type === 'BLOCKS')
        .map(d => {
          const taskResult = getTask(d.fromTaskId);
          if (taskResult.success) {
            return {
              taskId: d.fromTaskId,
              taskTitle: taskResult.data.title,
              status: taskResult.data.status,
            };
          }
          return { taskId: d.fromTaskId, taskTitle: 'Unknown', status: 'UNKNOWN' };
        })
        .filter(b => b.status !== 'COMPLETED' && b.status !== 'CANCELLED');

      if (blockers.length > 0) {
        state.blockingDependencies = blockers;
      }
    }
  }

  // 5. Detect cascade events for features/projects
  if (containerType === 'feature') {
    const tasksResult = searchTasks({ featureId: id });
    if (tasksResult.success && tasksResult.data.length > 0) {
      const events: string[] = [];
      const allCompleted = tasksResult.data.every(t => t.status === 'COMPLETED' || t.status === 'CANCELLED');
      const anyStarted = tasksResult.data.some(t => t.status !== 'PENDING' && t.status !== 'BACKLOG');

      if (allCompleted) events.push('all_tasks_complete');
      if (anyStarted) events.push('first_task_started');

      if (events.length > 0) state.cascadeEvents = events;
    }
  }

  return ok(state);
}
