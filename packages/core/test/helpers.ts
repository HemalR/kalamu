import type { KalamuNode } from "../src/model.js";

let counter = 0;

export function makeNode(overrides: Partial<KalamuNode> & { id?: string }): KalamuNode {
  counter += 1;
  return {
    id: overrides.id ?? `n_${String(counter).padStart(3, "0")}`,
    parentId: null,
    kind: "bullet",
    text: `node ${counter}`,
    createdAt: "2026-07-09T07:00:00.000Z",
    doneAt: null,
    handoff: null,
    ...overrides,
  };
}

export function task(id: string, overrides: Partial<KalamuNode> = {}): KalamuNode {
  return makeNode({ id, kind: "task", ...overrides });
}

export function bullet(id: string, overrides: Partial<KalamuNode> = {}): KalamuNode {
  return makeNode({ id, kind: "bullet", ...overrides });
}
