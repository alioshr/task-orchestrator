/**
 * Domain Types for Task Orchestrator v3.0
 *
 * v3 changes:
 * - Projects are stateless boards (no status)
 * - Feature/task status follows lean pipeline: configurable linear states
 * - WILL_NOT_IMPLEMENT is an exit state for tasks and features
 * - Blocking is a field (blockedBy/blockedReason), not a status
 * - Dependencies table removed; blocked_by and related_to are JSON fields
 * - LockStatus removed (dead code)
 */

// ============================================================================
// Enums
// ============================================================================

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
  RELATES_TO = 'RELATES_TO',
}

// ============================================================================
// Interfaces
// ============================================================================

export interface Project {
  id: string;
  name: string;
  summary: string;
  description?: string;
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
  status: string;
  priority: Priority;
  blockedBy: string[];
  blockedReason?: string;
  relatedTo: string[];
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
  status: string;
  priority: Priority;
  complexity: number;
  blockedBy: string[];
  blockedReason?: string;
  relatedTo: string[];
  version: number;
  lastModifiedBy?: string;
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
