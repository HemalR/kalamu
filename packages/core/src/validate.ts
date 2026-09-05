import { parseJsonl } from "./jsonl.js";
import type { KalamuNode } from "./model.js";
import { docReferences } from "./tokens.js";
import { buildTree, preorder } from "./tree.js";

export interface ValidationResult {
  valid: boolean;
  nodes: number;
  errors: string[];
  warnings: string[];
}

export interface ValidateOptions {
  /**
   * Whether a repo-relative `.md` path referenced in node text exists. Core
   * never touches the filesystem, so the caller (CLI, server) supplies the
   * lookup; without it doc references are not checked. A miss is a warning,
   * not an error: the outline is still well-formed, the doc was renamed.
   */
  docExists?: (path: string) => boolean;
}

export function validateOutline(content: string, options: ValidateOptions = {}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const parsed = parseJsonl(content);
  for (const err of parsed.errors) {
    errors.push(`line ${err.line}: ${err.message}`);
  }

  const seen = new Set<string>();
  for (const node of parsed.nodes) {
    if (seen.has(node.id)) errors.push(`duplicate id ${node.id}`);
    seen.add(node.id);
  }

  const byId = new Map(parsed.nodes.map((n) => [n.id, n]));
  for (const node of parsed.nodes) {
    if (node.parentId !== null && !byId.has(node.parentId)) {
      errors.push(`${node.id} has missing parent ${node.parentId}`);
    }
  }

  for (const cycleId of findCycles(parsed.nodes)) {
    errors.push(`${cycleId} is part of a parent cycle`);
  }

  for (const node of parsed.nodes) {
    for (const blockerId of node.blockedBy ?? []) {
      if (blockerId === node.id) errors.push(`${node.id} is blocked by itself`);
      else if (!byId.has(blockerId)) errors.push(`${node.id} is blocked by missing node ${blockerId}`);
      else if (isAncestor(byId, node.id, blockerId)) {
        errors.push(`${node.id} is blocked by ancestor ${blockerId}`);
      }
    }
  }

  for (const cycleId of findBlockerCycles(parsed.nodes)) {
    errors.push(`${cycleId} is part of a blocker cycle`);
  }

  const { docExists } = options;
  if (docExists) {
    for (const node of parsed.nodes) {
      for (const { path } of docReferences(node.text)) {
        if (!docExists(path)) warnings.push(`${node.id} references missing doc ${path}`);
      }
    }
  }

  // Not-pre-order is a warning, not an error: the next write normalizes it.
  if (errors.length === 0 && parsed.nodes.length > 0) {
    const canonical = preorder(buildTree(parsed.nodes));
    const matches = canonical.every((node, i) => parsed.nodes[i]?.id === node.id);
    if (!matches) warnings.push("file is not in pre-order traversal; the next write will normalize it");
  }

  return {
    valid: errors.length === 0,
    nodes: parsed.nodes.length,
    errors,
    warnings,
  };
}

/**
 * Blocker edges form a DAG across the tree, so a cycle needs a real traversal
 * rather than the single-parent walk above: a node can wait on many blockers.
 */
function findBlockerCycles(nodes: readonly KalamuNode[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  for (const node of nodes) {
    if (!node.blockedBy?.length) continue;
    const seen = new Set<string>();
    // A self-reference is already reported as "blocked by itself" above;
    // skipping it here keeps that from doubling as a one-node "cycle".
    const stack = node.blockedBy.filter((id) => id !== node.id);
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || seen.has(current)) continue;
      seen.add(current);
      if (current === node.id) {
        out.push(node.id);
        break;
      }
      stack.push(...(byId.get(current)?.blockedBy ?? []));
    }
  }
  return out;
}

/** Walk `parentId` rather than the tree: missing parents are already reported. */
function isAncestor(byId: Map<string, KalamuNode>, nodeId: string, ancestorId: string): boolean {
  const seen = new Set<string>();
  let current = byId.get(nodeId)?.parentId ?? null;
  while (current !== null) {
    if (current === ancestorId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

function findCycles(nodes: readonly KalamuNode[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  for (const node of nodes) {
    const seen = new Set<string>([node.id]);
    let current = node.parentId;
    while (current !== null) {
      if (seen.has(current)) {
        out.push(node.id);
        break;
      }
      seen.add(current);
      current = byId.get(current)?.parentId ?? null;
    }
  }
  return out;
}
