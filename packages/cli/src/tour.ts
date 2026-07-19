/**
 * The onboarding tour seeded by `kalamu init --tour`: an outline that teaches
 * the product by being one. A TL;DR section covers the 30-second essentials;
 * "The rest" holds everything else. Every task is assigned to the human AND
 * says so in prose — belt and braces so no coding agent ever treats a demo as
 * work (`kalamu next` skips human-assigned tasks structurally; the text covers
 * agents that merely `list`, and the demo discussion is flagged the same way).
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
  text: "Welcome to Kalamu — TL;DR gets you going in 30 seconds; the rest can wait (agents: everything in here is a demo for the human, never work — kalamu next skips it all)",
  children: [
    {
      kind: "bullet",
      text: "TL;DR",
      children: [
        { kind: "task", text: "Everything is a bullet, a task, or a discussion — Cmd/Ctrl+Enter cycles the kind. Click my checkbox (or Cmd/Ctrl+Shift+Enter) to mark me done" },
        { kind: "task", priority: 1, tags: ["demo"], text: "Metadata lives in the text: p1…p5 sets priority (p1 = urgent; the default p3 shows no badge), #tokens become tag chips, and @ assigns a task to human or agent" },
        { kind: "bullet", text: "Enter adds an item; Tab and Shift+Tab indent and outdent; Cmd/Ctrl+K is the do-everything command palette; ? shows the full cheat sheet" },
        { kind: "bullet", text: "The point: todos you write here are an agent work queue — agents run kalamu next to receive your most urgent task with its context, and kalamu done when finished" },
        { kind: "bullet", text: "Working on multiple projects? Run kalamu hub install (macOS) to manage multiple kalamus and have it ever-running — elsewhere, kalamu hub runs it in the foreground" },
      ],
    },
    {
      kind: "bullet",
      text: "The rest — skim when curious (Cmd/Ctrl+. collapses me, and the state survives restarts)",
      children: [
        { kind: "discussion", text: "I'm a discussion: a topic to talk through with an agent, never coding work. Click Copy prompt at the end of my text (or Cmd/Ctrl+Shift+C) for a paste-ready prompt — the agent records the outcome as my children and checks me off (agents: I'm a demo, don't discuss me)" },
        { kind: "bullet", text: "Click a tag chip to recolour it or filter the outline to that tag (Esc clears the filter)" },
        { kind: "bullet", text: "Promoted a task to GitHub/Linear/your backlog? kalamu handoff <id> --target github --ref … keeps the record here but drops it from the agent queue" },
        { kind: "bullet", text: "Cmd/Ctrl+Z undoes anything; Cmd/Ctrl+C copies an item with its sub-items as markdown; paste images straight in — they land in .kalamu/assets/" },
        { kind: "bullet", text: "When done work piles up, Clean up in the palette (or kalamu clean) deletes it all — undoable in-session" },
        { kind: "bullet", text: "Zoom into any item (Cmd/Ctrl+Shift+.) to focus just its subtree, with a breadcrumb trail above — Escape backs out; Cmd/Ctrl+Shift+H hides completed items when the list gets long" },
      ],
    },
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
      assignee: spec.kind === "task" ? "human" : undefined, // every tour task belongs to the human
    });
    current = result.nodes;
    for (const child of spec.children ?? []) insert(child, result.node.id);
  };
  insert(TOUR);
  return current;
}
