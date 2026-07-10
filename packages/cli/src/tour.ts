/**
 * The onboarding tour seeded by `kalamu init --tour`: an outline that teaches
 * the product by being one. Every task is `self: true` AND says so in prose —
 * belt and braces so no coding agent ever treats a demo as work (`kalamu next`
 * skips self tasks structurally; the text covers agents that merely `list`).
 */
import { addNode, type KalamuNode, type NodeKind } from "@kalamu/core";

interface TourNode {
  kind: NodeKind;
  text: string;
  priority?: 1 | 2 | 4 | 5;
  tags?: string[];
  children?: TourNode[];
}

const TOUR: TourNode = {
  kind: "bullet",
  text: "Welcome to Kalamu — a two-minute tour for the human at the keyboard (agents: every task in here is a demo marked self, not work — kalamu next skips them all)",
  children: [
    { kind: "task", text: "Click my checkbox — or press Cmd/Ctrl+Shift+Enter — to mark me done; the same again reopens me" },
    { kind: "task", priority: 1, text: "My p1 badge means urgent — priorities run p1 to p5 (default p3). Type p2 anywhere in my text to demote me, or press Cmd/Ctrl+K → Priority" },
    { kind: "task", tags: ["tour", "demo"], text: "Tags live right in the text as #tokens — click a chip to recolour it or filter the outline (Esc clears the filter)" },
    { kind: "task", text: "The (self) mark on me means I'm yours, not your agents' — type @me in any task to claim it for yourself" },
    {
      kind: "bullet",
      text: "Collapse me with Cmd/Ctrl+. — my children tuck away, and the state survives restarts",
      children: [
        { kind: "bullet", text: "Plain bullets like me are notes and context, never work items — Cmd/Ctrl+Enter toggles bullet/task" },
        { kind: "bullet", text: "Enter on an empty item toggles bullet/task too; Tab and Shift+Tab indent and outdent" },
      ],
    },
    { kind: "task", text: "Press Cmd/Ctrl+K — the command palette sets priority and labels, toggles done and mine, and copies ready-to-run CLI commands for any item" },
    { kind: "task", text: "Press ? for the full keyboard cheat sheet (the CLI command list lives there too)" },
    { kind: "bullet", text: "How agents fit in: they run kalamu next to receive your most urgent open task — with its ancestors and subtree as context — and kalamu done when finished. Todos you write here become work they can execute" },
    { kind: "task", text: "Done touring? Focus the top 'Welcome to Kalamu' line and press Cmd/Ctrl+Shift+Backspace to delete the whole tour (it's undoable)" },
  ],
};

/** Seed the tour into an outline (caller guarantees it's empty). */
export function seedTour(nodes: readonly KalamuNode[]): KalamuNode[] {
  let current = [...nodes];
  const insert = (spec: TourNode, parentId?: string): void => {
    const result = addNode(current, {
      parentId,
      kind: spec.kind,
      text: spec.text,
      priority: spec.priority,
      tags: spec.tags,
      self: spec.kind === "task", // every tour task belongs to the human
    });
    current = result.nodes;
    for (const child of spec.children ?? []) insert(child, result.node.id);
  };
  insert(TOUR);
  return current;
}
