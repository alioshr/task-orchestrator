import { ProjectStatus, FeatureStatus, TaskStatus } from '../domain/types';

type TransitionMap = Record<string, string[]>;

// Valid statuses per container type
const PROJECT_STATUSES = Object.values(ProjectStatus);
const FEATURE_STATUSES = Object.values(FeatureStatus);
const TASK_STATUSES = Object.values(TaskStatus);

/**
 * Status transition maps
 *
 * Note: CANCELLED and DEFERRED are intentionally non-terminal statuses.
 * They allow transitions back to earlier workflow stages (BACKLOG/PENDING for tasks,
 * PLANNING for projects) to support reinstating cancelled or deferred work.
 */
export const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  [ProjectStatus.PLANNING]: [ProjectStatus.IN_DEVELOPMENT, ProjectStatus.ON_HOLD, ProjectStatus.CANCELLED],
  [ProjectStatus.IN_DEVELOPMENT]: [ProjectStatus.COMPLETED, ProjectStatus.ON_HOLD, ProjectStatus.CANCELLED],
  [ProjectStatus.ON_HOLD]: [ProjectStatus.PLANNING, ProjectStatus.IN_DEVELOPMENT, ProjectStatus.CANCELLED],
  [ProjectStatus.COMPLETED]: [ProjectStatus.ARCHIVED],
  [ProjectStatus.CANCELLED]: [ProjectStatus.PLANNING], // Non-terminal: allows reinstating cancelled projects
  [ProjectStatus.ARCHIVED]: [],
};

export const FEATURE_TRANSITIONS: Record<FeatureStatus, FeatureStatus[]> = {
  [FeatureStatus.DRAFT]: [FeatureStatus.PLANNING],
  [FeatureStatus.PLANNING]: [FeatureStatus.IN_DEVELOPMENT, FeatureStatus.ON_HOLD],
  [FeatureStatus.IN_DEVELOPMENT]: [FeatureStatus.TESTING, FeatureStatus.BLOCKED, FeatureStatus.ON_HOLD],
  [FeatureStatus.TESTING]: [FeatureStatus.VALIDATING, FeatureStatus.IN_DEVELOPMENT],
  [FeatureStatus.VALIDATING]: [FeatureStatus.PENDING_REVIEW, FeatureStatus.IN_DEVELOPMENT],
  [FeatureStatus.PENDING_REVIEW]: [FeatureStatus.DEPLOYED, FeatureStatus.IN_DEVELOPMENT],
  [FeatureStatus.BLOCKED]: [FeatureStatus.IN_DEVELOPMENT, FeatureStatus.ON_HOLD],
  [FeatureStatus.ON_HOLD]: [FeatureStatus.PLANNING, FeatureStatus.IN_DEVELOPMENT],
  [FeatureStatus.DEPLOYED]: [FeatureStatus.COMPLETED],
  [FeatureStatus.COMPLETED]: [FeatureStatus.ARCHIVED],
  [FeatureStatus.ARCHIVED]: [],
};

export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  [TaskStatus.BACKLOG]: [TaskStatus.PENDING],
  [TaskStatus.PENDING]: [TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED, TaskStatus.ON_HOLD, TaskStatus.CANCELLED, TaskStatus.DEFERRED],
  [TaskStatus.IN_PROGRESS]: [TaskStatus.IN_REVIEW, TaskStatus.TESTING, TaskStatus.BLOCKED, TaskStatus.ON_HOLD, TaskStatus.COMPLETED],
  [TaskStatus.IN_REVIEW]: [TaskStatus.CHANGES_REQUESTED, TaskStatus.COMPLETED],
  [TaskStatus.CHANGES_REQUESTED]: [TaskStatus.IN_PROGRESS],
  [TaskStatus.TESTING]: [TaskStatus.READY_FOR_QA, TaskStatus.IN_PROGRESS],
  [TaskStatus.READY_FOR_QA]: [TaskStatus.INVESTIGATING, TaskStatus.DEPLOYED, TaskStatus.COMPLETED],
  [TaskStatus.INVESTIGATING]: [TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED],
  [TaskStatus.BLOCKED]: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
  [TaskStatus.ON_HOLD]: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
  [TaskStatus.DEPLOYED]: [TaskStatus.COMPLETED],
  [TaskStatus.COMPLETED]: [], // Terminal: no transitions allowed
  [TaskStatus.CANCELLED]: [TaskStatus.BACKLOG, TaskStatus.PENDING], // Non-terminal: allows reinstating cancelled tasks
  [TaskStatus.DEFERRED]: [TaskStatus.BACKLOG, TaskStatus.PENDING], // Non-terminal: allows resuming deferred tasks
};

// Terminal statuses (no transitions out)
const TERMINAL_STATUSES: Record<string, string[]> = {
  project: ['ARCHIVED'],
  feature: ['ARCHIVED'],
  task: ['COMPLETED'],
};

export type ContainerType = 'project' | 'feature' | 'task';

export function isValidStatus(containerType: ContainerType, status: string): boolean {
  switch (containerType) {
    case 'project': return PROJECT_STATUSES.includes(status as ProjectStatus);
    case 'feature': return FEATURE_STATUSES.includes(status as FeatureStatus);
    case 'task': return TASK_STATUSES.includes(status as TaskStatus);
  }
}

export function getValidStatuses(containerType: ContainerType): string[] {
  switch (containerType) {
    case 'project': return [...PROJECT_STATUSES];
    case 'feature': return [...FEATURE_STATUSES];
    case 'task': return [...TASK_STATUSES];
  }
}

export function getTransitions(containerType: ContainerType): TransitionMap {
  switch (containerType) {
    case 'project': return PROJECT_TRANSITIONS;
    case 'feature': return FEATURE_TRANSITIONS;
    case 'task': return TASK_TRANSITIONS;
  }
}

export function getAllowedTransitions(containerType: ContainerType, currentStatus: string): string[] {
  const transitions = getTransitions(containerType);
  return transitions[currentStatus] || [];
}

export function isValidTransition(containerType: ContainerType, from: string, to: string): boolean {
  const allowed = getAllowedTransitions(containerType, from);
  return allowed.includes(to);
}

export function isTerminalStatus(containerType: ContainerType, status: string): boolean {
  return TERMINAL_STATUSES[containerType]?.includes(status) ?? false;
}
