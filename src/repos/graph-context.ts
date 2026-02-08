import { getMolecule } from './graph-molecules';
import { getRecentChangelog } from './graph-changelog';
import type { Atom } from './graph-atoms';
import type { ChangelogEntry } from './graph-changelog';
import type { Molecule } from './graph-molecules';

// ============================================================================
// Response Types
// ============================================================================

export interface AtomContextResponse {
  id: string;
  name: string;
  knowledge: string;
  matchedPaths: string[];
  relatedAtoms: Array<{ atomId: string; reason: string }>;
  changelog?: ChangelogEntry[];
}

export interface MoleculeContextResponse {
  id: string;
  name: string;
  knowledge: string;
  relatedMolecules: Array<{ moleculeId: string; reason: string }>;
  atoms: AtomContextResponse[];
  changelog?: ChangelogEntry[];
}

export interface GraphContextResponse {
  molecules: MoleculeContextResponse[];
  orphanAtoms: AtomContextResponse[];
  unmatchedPaths: string[];
}

// ============================================================================
// Shared Context Builder
// ============================================================================

/**
 * Build a hierarchical context response from matched atoms.
 * Groups atoms by molecule, sorts deterministically by name,
 * and optionally includes changelog entries.
 */
export function buildGraphContext(
  atoms: Array<Atom & { matchedPaths: string[] }>,
  unmatchedPaths: string[],
  options: { includeChangelog: boolean; changelogLimit: number } = { includeChangelog: true, changelogLimit: 5 }
): GraphContextResponse {
  const { includeChangelog, changelogLimit } = options;

  // Group atoms by molecule
  const moleculeMap = new Map<string, {
    molecule: Molecule;
    atoms: Array<Atom & { matchedPaths: string[] }>;
  }>();
  const orphanAtoms: Array<Atom & { matchedPaths: string[] }> = [];

  for (const atom of atoms) {
    if (atom.moleculeId) {
      if (!moleculeMap.has(atom.moleculeId)) {
        const molResult = getMolecule(atom.moleculeId);
        if (molResult.success) {
          moleculeMap.set(atom.moleculeId, {
            molecule: molResult.data,
            atoms: [],
          });
        }
      }
      const group = moleculeMap.get(atom.moleculeId);
      if (group) {
        group.atoms.push(atom);
      } else {
        orphanAtoms.push(atom);
      }
    } else {
      orphanAtoms.push(atom);
    }
  }

  function buildAtomResponse(atom: Atom & { matchedPaths: string[] }): AtomContextResponse {
    const response: AtomContextResponse = {
      id: atom.id,
      name: atom.name,
      knowledge: atom.knowledge,
      matchedPaths: atom.matchedPaths,
      relatedAtoms: atom.relatedAtoms,
    };
    if (includeChangelog) {
      response.changelog = getRecentChangelog('atom', atom.id, changelogLimit);
    }
    return response;
  }

  // Build response, sorted deterministically
  const molecules: MoleculeContextResponse[] = Array.from(moleculeMap.values())
    .sort((a, b) => a.molecule.name.localeCompare(b.molecule.name))
    .map(({ molecule, atoms: molAtoms }) => {
      const response: MoleculeContextResponse = {
        id: molecule.id,
        name: molecule.name,
        knowledge: molecule.knowledge,
        relatedMolecules: molecule.relatedMolecules,
        atoms: molAtoms
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(buildAtomResponse),
      };
      if (includeChangelog) {
        response.changelog = getRecentChangelog('molecule', molecule.id, changelogLimit);
      }
      return response;
    });

  const sortedOrphans = orphanAtoms
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(buildAtomResponse);

  return {
    molecules,
    orphanAtoms: sortedOrphans,
    unmatchedPaths,
  };
}
