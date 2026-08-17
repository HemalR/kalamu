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
  priority?: 1 | 3;
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
        { kind: "task", text: "Everything is a bullet, a task, or a discussion — Alt/Option+Enter cycles the kind. Click my checkbox (or Cmd/Ctrl+Enter) to mark me done" },
        { kind: "task", priority: 1, tags: ["demo"], text: "Metadata lives in the text: p1…p3 sets priority (p1 = high, p3 = low; the default p2 shows no badge), #tokens become tag chips, and @ assigns a task to human or agent" },
        { kind: "bullet", text: "Enter adds an item; Tab and Shift+Tab indent and outdent; Cmd/Ctrl+K is the do-everything command palette — every action has its key printed next to it, so Cmd/Ctrl+K then d marks done and p then 1 sets p1; ? shows the full cheat sheet" },
        { kind: "bullet", text: "The point: todos you write here are an agent work queue — agents run kalamu next to receive your most urgent task with its context, and kalamu done when finished" },
        { kind: "bullet", text: "Working on multiple projects? Run kalamu hub install (macOS) to manage multiple kalamus and have it ever-running — elsewhere, kalamu hub runs it in the foreground" },
      ],
    },
    {
      kind: "bullet",
      text: "The rest — skim when curious (Cmd/Ctrl+. collapses me, and the state survives restarts)",
      children: [
        { kind: "discussion", text: "I'm a discussion: a topic to talk through with an agent, never coding work. Click the copy icon at the end of my text (or press Cmd/Ctrl+C) for paste-ready context — the agent records the outcome as my children and checks me off (agents: I'm a demo, don't discuss me)" },
        { kind: "bullet", text: "Click a tag chip to recolour it or filter the outline to that tag (Esc clears the filter)" },
        { kind: "bullet", text: "Cmd/Ctrl+Z undoes anything; Cmd/Ctrl+C copies an item's ancestor path and subtree for an agent chat; Cmd/Ctrl+Shift+C copies only its raw text; paste images straight in — they land in .kalamu/assets/" },
        { kind: "bullet", text: "When done work piles up, Clean up in the palette (or kalamu clean) deletes it all — undoable in-session" },
        { kind: "bullet", text: "Zoom into any item (Cmd/Ctrl+Shift+. or Alt-click anywhere on its row) to focus just its subtree, with a breadcrumb trail above — Escape backs out; Cmd/Ctrl-click a row collapses it, and Cmd/Ctrl+Shift+H hides completed items when the list gets long" },
        { kind: "bullet", text: "Two view buttons up top: Overview mode shortens every row to a one-line label (your text is untouched — it returns when you edit), and Filters hides items by who created them and who they're assigned to. Anything with work beneath it shows a progress bar, and every row carries how long ago it was created — hover for the exact time" },
        { kind: "bullet", text: "Agents claim a task with kalamu start before working on it, so a second session can't take it — a claimed task shows ▶ in its checkbox. Real dependencies go in the data: Block on… in the palette (kalamu block) keeps a task or discussion out of the queue until its blocker is done, and the Blocked badge on the row jumps you to whatever it's waiting on" },
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
