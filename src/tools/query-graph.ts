import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, uuidSchema, optionalUuidSchema } from './registry';
import { getMolecule, searchMolecules } from '../repos/graph-molecules';
import { getAtom, searchAtoms, getAtomsByMolecule, findAtomsByPaths } from '../repos/graph-atoms';
import { getRecentChangelog } from '../repos/graph-changelog';
import { buildGraphContext } from '../repos/graph-context';
import type { Atom } from '../repos/graph-atoms';
import type { ChangelogEntry } from '../repos/graph-changelog';
import type { Molecule } from '../repos/graph-molecules';

export function registerQueryGraphTool(server: McpServer): void {
  server.tool(
    'query_graph',
    'Read operations for the knowledge graph. Supports get (single entity), search (filtered list), and context (file-path matching) operations.',
    {
      operation: z.enum(['get', 'search', 'context']),
      entityType: z.enum(['atom', 'molecule']).optional(),
      id: optionalUuidSchema,
      projectId: optionalUuidSchema,
      paths: z.string().optional().describe('Comma-separated file paths for context operation'),
      query: z.string().optional().describe('Text search on knowledge/name'),
      moleculeId: optionalUuidSchema.describe('Filter atoms by molecule'),
      orphansOnly: z.boolean().optional().default(false).describe('Atoms without molecule'),
      includeChangelog: z.boolean().optional().default(true),
      changelogLimit: z.coerce.number().int().optional().default(5),
      limit: z.coerce.number().int().optional().default(20),
      offset: z.coerce.number().int().optional().default(0),
    },
    async (params) => {
      try {
        const { operation } = params;

        // ===== GET OPERATION =====
        if (operation === 'get') {
          if (!params.id) {
            const response = createErrorResponse('id is required for get operation');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }
          if (!params.entityType) {
            const response = createErrorResponse('entityType is required for get operation');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          if (params.entityType === 'molecule') {
            const result = getMolecule(params.id);
            if (!result.success) {
              const response = createErrorResponse(result.error || 'Molecule not found', result.code);
              return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
            }

            const data: {
              molecule: Molecule;
              atoms?: Array<Atom & { changelog?: ChangelogEntry[] }>;
              changelog?: ChangelogEntry[];
            } = { molecule: result.data };

            // Include member atoms
            const atomsResult = getAtomsByMolecule(params.id);
            if (atomsResult.success) {
              data.atoms = atomsResult.data;
            }

            // Include changelog
            if (params.includeChangelog) {
              data.changelog = getRecentChangelog('molecule', params.id, params.changelogLimit);
              // Also include changelog for each atom
              if (data.atoms) {
                data.atoms = data.atoms.map(atom => ({
                  ...atom,
                  changelog: getRecentChangelog('atom', atom.id, params.changelogLimit),
                }));
              }
            }

            const response = createSuccessResponse('Molecule retrieved successfully', data);
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          if (params.entityType === 'atom') {
            const result = getAtom(params.id);
            if (!result.success) {
              const response = createErrorResponse(result.error || 'Atom not found', result.code);
              return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
            }

            const data: { atom: Atom; changelog?: ChangelogEntry[] } = { atom: result.data };

            // Include changelog
            if (params.includeChangelog) {
              data.changelog = getRecentChangelog('atom', params.id, params.changelogLimit);
            }

            const response = createSuccessResponse('Atom retrieved successfully', data);
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }
        }

        // ===== SEARCH OPERATION =====
        if (operation === 'search') {
          if (!params.entityType) {
            const response = createErrorResponse('entityType is required for search operation');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }
          if (!params.projectId) {
            const response = createErrorResponse('projectId is required for search operation');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          if (params.entityType === 'molecule') {
            const result = searchMolecules({
              projectId: params.projectId,
              query: params.query,
              limit: params.limit,
              offset: params.offset,
            });

            if (!result.success) {
              const response = createErrorResponse(result.error || 'Search failed', result.code);
              return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
            }

            // Include changelog for each molecule if requested
            let items: Array<Molecule & { changelog?: ChangelogEntry[] }> = result.data;
            if (params.includeChangelog) {
              items = items.map(mol => ({
                ...mol,
                changelog: getRecentChangelog('molecule', mol.id, params.changelogLimit),
              }));
            }

            const response = createSuccessResponse(
              `Found ${items.length} molecule(s)`,
              { items, count: items.length, limit: params.limit, offset: params.offset }
            );
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          if (params.entityType === 'atom') {
            const result = searchAtoms({
              projectId: params.projectId,
              moleculeId: params.moleculeId,
              query: params.query,
              orphansOnly: params.orphansOnly,
              limit: params.limit,
              offset: params.offset,
            });

            if (!result.success) {
              const response = createErrorResponse(result.error || 'Search failed', result.code);
              return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
            }

            // Include changelog for each atom if requested
            let items: Array<Atom & { changelog?: ChangelogEntry[] }> = result.data;
            if (params.includeChangelog) {
              items = items.map(atom => ({
                ...atom,
                changelog: getRecentChangelog('atom', atom.id, params.changelogLimit),
              }));
            }

            const response = createSuccessResponse(
              `Found ${items.length} atom(s)`,
              { items, count: items.length, limit: params.limit, offset: params.offset }
            );
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }
        }

        // ===== CONTEXT OPERATION =====
        if (operation === 'context') {
          if (!params.projectId) {
            const response = createErrorResponse('projectId is required for context operation');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }
          if (!params.paths) {
            const response = createErrorResponse('paths is required for context operation');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          // Parse file paths (comma-separated)
          const filePaths = params.paths
            .split(',')
            .map(p => p.trim())
            .filter(p => p.length > 0);

          if (filePaths.length === 0) {
            const response = createErrorResponse('No valid file paths provided');
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          const result = findAtomsByPaths(params.projectId, filePaths);
          if (!result.success) {
            const response = createErrorResponse(result.error || 'Context query failed', result.code);
            return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
          }

          const contextData = buildGraphContext(
            result.data.atoms,
            result.data.unmatchedPaths,
            { includeChangelog: params.includeChangelog, changelogLimit: params.changelogLimit }
          );

          const response = createSuccessResponse('Graph context retrieved', contextData);
          return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
        }

        const response = createErrorResponse('Invalid operation');
        return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
      } catch (error: any) {
        const response = createErrorResponse(error.message || 'Internal error');
        return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
      }
    }
  );
}
