import { ProjectStatus, FeatureStatus, TaskStatus } from '../domain/types';

// Valid statuses per container type
const PROJECT_STATUSES = Object.values(ProjectStatus);
const FEATURE_STATUSES = Object.values(FeatureStatus);
const TASK_STATUSES = Object.values(TaskStatus);

// Status transition maps
const PROJECT_TRANSITIONS: Record<string, string[]> = {
  PLANNING: ['IN_DEVELOPMENT', 'ON_HOLD', 'CANCELLED'],
  IN_DEVELOPMENT: ['COMPLETED', 'ON_HOLD', 'CANCELLED'],
  ON_HOLD: ['PLANNING', 'IN_DEVELOPMENT', 'CANCELLED'],
  COMPLETED: ['ARCHIVED'],
  CANCELLED: ['PLANNING'],
  ARCHIVED: [],
};

const FEATURE_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PLANNING'],
  PLANNING: ['IN_DEVELOPMENT', 'ON_HOLD'],
  IN_DEVELOPMENT: ['TESTING', 'BLOCKED', 'ON_HOLD'],
  TESTING: ['VALIDATING', 'IN_DEVELOPMENT'],
  VALIDATING: ['PENDING_REVIEW', 'IN_DEVELOPMENT'],
  PENDING_REVIEW: ['DEPLOYED', 'IN_DEVELOPMENT'],
  BLOCKED: ['IN_DEVELOPMENT', 'ON_HOLD'],
  ON_HOLD: ['PLANNING', 'IN_DEVELOPMENT'],
  DEPLOYED: ['COMPLETED'],
  COMPLETED: ['ARCHIVED'],
  ARCHIVED: [],
};

const TASK_TRANSITIONS: Record<string, string[]> = {
  BACKLOG: ['PENDING'],
  PENDING: ['IN_PROGRESS', 'BLOCKED', 'ON_HOLD', 'CANCELLED', 'DEFERRED'],
  IN_PROGRESS: ['IN_REVIEW', 'TESTING', 'BLOCKED', 'ON_HOLD', 'COMPLETED'],
  IN_REVIEW: ['CHANGES_REQUESTED', 'COMPLETED'],
  CHANGES_REQUESTED: ['IN_PROGRESS'],
  TESTING: ['READY_FOR_QA', 'IN_PROGRESS'],
  READY_FOR_QA: ['INVESTIGATING', 'DEPLOYED', 'COMPLETED'],
  INVESTIGATING: ['IN_PROGRESS', 'BLOCKED'],
  BLOCKED: ['PENDING', 'IN_PROGRESS'],
  ON_HOLD: ['PENDING', 'IN_PROGRESS'],
  DEPLOYED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: ['BACKLOG', 'PENDING'],
  DEFERRED: ['BACKLOG', 'PENDING'],
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

export function getTransitions(containerType: ContainerType): Record<string, string[]> {
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
