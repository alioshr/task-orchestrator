import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// --- Shared UUID schemas ---
// Accept both dashed (550e8400-e29b-41d4-a716-446655440000) and dashless (550e8400e29b41d4a716446655440000) UUIDs.
// Always transform to dashless lowercase to match the DB storage format.
const UUID_REGEX = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
export const uuidSchema = z.string().regex(UUID_REGEX, 'Invalid UUID').transform(v => v.replace(/-/g, '').toLowerCase());
export const optionalUuidSchema = z.string().regex(UUID_REGEX, 'Invalid UUID').optional().transform(v => v ? v.replace(/-/g, '').toLowerCase() : undefined);

// Shared container type schema for dependency tools
export const dependencyContainerTypeSchema = z.enum(['task', 'feature']);

// --- Tool Definition interface ---
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;  // Zod schemas
  execute: (params: Record<string, any>) => Promise<ToolResponse>;
}

// --- Standard response format ---
export interface ToolResponse {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
  metadata?: {
    timestamp: string;
    version: string;
  };
}

export function createSuccessResponse(message: string, data: any): ToolResponse {
  return {
    success: true,
    message,
    data,
    metadata: {
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    }
  };
}

export function createErrorResponse(message: string, error?: string): ToolResponse {
  return {
    success: false,
    message,
    error: error || message,
    metadata: {
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    }
  };
}

// --- Parameter validation helpers ---

export function requireString(params: Record<string, any>, key: string): string {
  const value = params[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Required string parameter '${key}' is missing or empty`);
  }
  return value.trim();
}

export function optionalString(params: Record<string, any>, key: string): string | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`Parameter '${key}' must be a string`);
  return value.trim() || undefined;
}

export function requireUUID(params: Record<string, any>, key: string): string {
  const value = requireString(params, key);
  // Accept both dashed and non-dashed UUID formats
  const uuidRegex = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) {
    throw new Error(`Parameter '${key}' must be a valid UUID`);
  }
  return value.replace(/-/g, '').toLowerCase();
}

export function optionalUUID(params: Record<string, any>, key: string): string | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  return requireUUID(params, key);
}

export function requireBoolean(params: Record<string, any>, key: string): boolean {
  const value = params[key];
  if (typeof value !== 'boolean') {
    throw new Error(`Required boolean parameter '${key}' is missing`);
  }
  return value;
}

export function optionalBoolean(params: Record<string, any>, key: string, defaultValue?: boolean): boolean | undefined {
  const value = params[key];
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== 'boolean') throw new Error(`Parameter '${key}' must be a boolean`);
  return value;
}

export function requireInteger(params: Record<string, any>, key: string): number {
  const value = params[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Required integer parameter '${key}' is missing or not an integer`);
  }
  return value;
}

export function optionalInteger(params: Record<string, any>, key: string, defaultValue?: number): number | undefined {
  const value = params[key];
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Parameter '${key}' must be an integer`);
  }
  return value;
}

export function requireEnum<T extends string>(params: Record<string, any>, key: string, validValues: readonly T[]): T {
  const value = requireString(params, key).toUpperCase() as T;
  if (!validValues.includes(value)) {
    throw new Error(`Parameter '${key}' must be one of: ${validValues.join(', ')}`);
  }
  return value;
}

export function optionalEnum<T extends string>(params: Record<string, any>, key: string, validValues: readonly T[]): T | undefined {
  const value = optionalString(params, key);
  if (!value) return undefined;
  const upper = value.toUpperCase() as T;
  if (!validValues.includes(upper)) {
    throw new Error(`Parameter '${key}' must be one of: ${validValues.join(', ')}`);
  }
  return upper;
}

// --- Error codes ---
export enum ErrorCode {
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  CONFLICT = 'CONFLICT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  INVALID_OPERATION = 'INVALID_OPERATION',
  CIRCULAR_DEPENDENCY = 'CIRCULAR_DEPENDENCY',
}

// --- Tool registration helper ---
// This will be used to register tools with the MCP server instance
export function registerTool(server: McpServer, tool: ToolDefinition): void {
  server.tool(
    tool.name,
    tool.description,
    tool.parameters,
    async (params: any) => {
      try {
        const response = await tool.execute(params);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(response, null, 2)
          }]
        };
      } catch (error: any) {
        const response = createErrorResponse(
          error.message || 'Internal error',
          error.name === 'NotFoundError' ? ErrorCode.NOT_FOUND
            : error.name === 'ValidationError' ? ErrorCode.VALIDATION_ERROR
            : error.name === 'ConflictError' ? ErrorCode.CONFLICT
            : ErrorCode.INTERNAL_ERROR
        );
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(response, null, 2)
          }]
        };
      }
    }
  );
}
