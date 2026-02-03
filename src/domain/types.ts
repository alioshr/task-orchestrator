/**
 * Domain Types for Task Orchestrator v2.0
 *
 * All TypeScript interfaces and enums for the domain model.
 * Based on the v2.0 schema specification.
 */

// ============================================================================
// Enums
// ============================================================================

export enum ProjectStatus {
  PLANNING = 'PLANNING',
  IN_DEVELOPMENT = 'IN_DEVELOPMENT',
  ON_HOLD = 'ON_HOLD',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
  ARCHIVED = 'ARCHIVED'
}

export enum FeatureStatus {
  DRAFT = 'DRAFT',
  PLANNING = 'PLANNING',
  IN_DEVELOPMENT = 'IN_DEVELOPMENT',
  TESTING = 'TESTING',
  VALIDATING = 'VALIDATING',
  PENDING_REVIEW = 'PENDING_REVIEW',
  BLOCKED = 'BLOCKED',
  ON_HOLD = 'ON_HOLD',
  DEPLOYED = 'DEPLOYED',
  COMPLETED = 'COMPLETED',
  ARCHIVED = 'ARCHIVED'
}

export enum TaskStatus {
  BACKLOG = 'BACKLOG',
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  IN_REVIEW = 'IN_REVIEW',
  CHANGES_REQUESTED = 'CHANGES_REQUESTED',
  TESTING = 'TESTING',
  READY_FOR_QA = 'READY_FOR_QA',
  INVESTIGATING = 'INVESTIGATING',
  BLOCKED = 'BLOCKED',
  ON_HOLD = 'ON_HOLD',
  DEPLOYED = 'DEPLOYED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  DEFERRED = 'DEFERRED'
}

export enum Priority {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW'
}

export enum ContentFormat {
  PLAIN_TEXT = 'PLAIN_TEXT',
  MARKDOWN = 'MARKDOWN',
  JSON = 'JSON',
  CODE = 'CODE'
}

export enum EntityType {
  PROJECT = 'PROJECT',
  FEATURE = 'FEATURE',
  TASK = 'TASK',
  TEMPLATE = 'TEMPLATE',
  SECTION = 'SECTION'
}

export enum DependencyType {
  BLOCKS = 'BLOCKS',
  IS_BLOCKED_BY = 'IS_BLOCKED_BY',
  RELATES_TO = 'RELATES_TO'
}

export enum LockStatus {
  UNLOCKED = 'UNLOCKED',
  LOCKED_EXCLUSIVE = 'LOCKED_EXCLUSIVE',
  LOCKED_SHARED = 'LOCKED_SHARED',
  LOCKED_SECTION = 'LOCKED_SECTION'
}

// ============================================================================
// Interfaces
// ============================================================================

export interface Project {
  id: string;
  name: string;
  summary: string;
  description?: string;
  status: ProjectStatus;
  version: number;
  createdAt: Date;
  modifiedAt: Date;
  searchVector?: string;
  tags?: string[];
}

export interface Feature {
  id: string;
  projectId?: string;
  name: string;
  summary: string;
  description?: string;
  status: FeatureStatus;
  priority: Priority;
  version: number;
  createdAt: Date;
  modifiedAt: Date;
  searchVector?: string;
  tags?: string[];
}

export interface Task {
  id: string;
  projectId?: string;
  featureId?: string;
  title: string;
  summary: string;
  description?: string;
  status: TaskStatus;
  priority: Priority;
  complexity: number;
  version: number;
  lastModifiedBy?: string;
  lockStatus: LockStatus;
  createdAt: Date;
  modifiedAt: Date;
  searchVector?: string;
  tags?: string[];
}

export interface Section {
  id: string;
  entityType: EntityType;
  entityId: string;
  title: string;
  usageDescription: string;
  content: string;
  contentFormat: ContentFormat;
  ordinal: number;
  tags: string;
  version: number;
  createdAt: Date;
  modifiedAt: Date;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  targetEntityType: EntityType;
  isBuiltIn: boolean;
  isProtected: boolean;
  isEnabled: boolean;
  createdBy?: string;
  tags: string;
  createdAt: Date;
  modifiedAt: Date;
}

export interface TemplateSection {
  id: string;
  templateId: string;
  title: string;
  usageDescription: string;
  contentSample: string;
  contentFormat: ContentFormat;
  ordinal: number;
  isRequired: boolean;
  tags: string;
}

export interface Dependency {
  id: string;
  fromTaskId: string;
  toTaskId: string;
  type: DependencyType;
  createdAt: Date;
}

export interface EntityTag {
  id: string;
  entityId: string;
  entityType: EntityType;
  tag: string;
  createdAt: Date;
}

// ============================================================================
// Result Type
// ============================================================================

export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

// ============================================================================
// Error Types
// ============================================================================

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}
