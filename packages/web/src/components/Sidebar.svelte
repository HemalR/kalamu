<script lang="ts">
  /**
   * Hub-mode project list (rendered only when the app is served under
   * /p/<slug>). Entries are plain links on purpose: each project gets a
   * fresh app instance, so navigation is a full page load.
   */
  import type { Attachment } from "svelte/attachments";
  import { apiBase } from "../lib/api";

  interface HubProject {
    slug: string;
    name: string;
    path: string;
    openTasks: number | null;
    lastSeenAt: string;
  }

  /** Called with the effective name after the ACTIVE project is renamed. */
  let { onrename }: { onrename?: (name: string) => void } = $props();

  const activeSlug = apiBase.slice("/p/".length);

  /** null until the hub list loads; stays null (no sidebar) if it fails. */
  let projects = $state<HubProject[] | null>(null);
  // Hub-global endpoint — deliberately NOT prefixed with apiBase.
  void fetch("/api/projects")
    .then((response) => {
      if (!response.ok) return;
      return response.json().then((body: unknown) => {
        if (body !== null && typeof body === "object" && "projects" in body && Array.isArray(body.projects)) {
          projects = body.projects as HubProject[];
        }
      });
    })
    .catch(() => {});

  /** Non-destructive: deregisters the project; it re-registers on next CLI use. */
  async function removeProject(slug: string): Promise<void> {
    try {
      const response = await fetch(`/api/projects/${slug}`, { method: "DELETE" });
      if (!response.ok || projects === null) return;
      projects = projects.filter((project) => project.slug !== slug);
      if (slug === activeSlug) location.href = "/";
    } catch {
      // Failures leave the entry in place, same as the list fetch.
    }
  }

  /** Slug of the row being renamed inline; null when none. */
  let editingSlug = $state<string | null>(null);
  let draft = $state("");

  function startRename(project: HubProject): void {
    editingSlug = project.slug;
    draft = project.name;
  }

  const focusAndSelect: Attachment<HTMLInputElement> = (input) => {
    input.focus();
    input.select();
  };

  function onRenameKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitRename();
    } else if (event.key === "Escape") {
      event.stopPropagation(); // Escape is a global "clear filter" key.
      editingSlug = null;
    }
  }

  /** Sends the raw draft; the server trims, and blank clears the override. */
  async function commitRename(): Promise<void> {
    const slug = editingSlug;
    editingSlug = null; // also guards the blur that follows Enter
    if (slug === null || projects === null) return;
    const project = projects.find((entry) => entry.slug === slug);
    if (project === undefined || draft === project.name) return;
    try {
      const response = await fetch(`/api/projects/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft }),
      });
      if (!response.ok) return;
      const body: unknown = await response.json();
      if (body !== null && typeof body === "object" && "name" in body && typeof body.name === "string") {
        project.name = body.name;
        if (slug === activeSlug) onrename?.(body.name);
      }
    } catch {
      // Quiet failure: the old name stays, same as removeProject.
    }
  }
</script>

{#if projects !== null}
  <nav class="sidebar" aria-label="Projects">
    <span class="brand">kalamu</span>
    <ul>
      {#each projects as project (project.slug)}
        <li>
          {#if editingSlug === project.slug}
            <input
              class="rename"
              type="text"
              bind:value={draft}
              aria-label={`New name for ${project.name}`}
              onkeydown={onRenameKeydown}
              onblur={() => void commitRename()}
              {@attach focusAndSelect}
            />
          {:else}
            <a
              href={`/p/${project.slug}`}
              class:active={project.slug === activeSlug}
              aria-current={project.slug === activeSlug ? "page" : undefined}
              title={project.path}
            >
              <span class="name">{project.name}</span>
              {#if project.openTasks !== null && project.openTasks > 0}
                <span class="count">{project.openTasks}</span>
              {/if}
            </a>
            <button
              class="edit"
              aria-label={`Rename ${project.name}`}
              title="Rename"
              onclick={() => startRename(project)}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
            </button>
            <button
              class="remove"
              aria-label={`Remove ${project.name} from sidebar`}
              title="Remove from sidebar (project data is untouched)"
              onclick={() => removeProject(project.slug)}
            >×</button>
          {/if}
        </li>
      {/each}
    </ul>
  </nav>
{/if}

<style>
  .sidebar {
    position: sticky;
    top: 0;
    flex: 0 0 230px;
    height: 100vh;
    overflow-y: auto;
    padding: 28px 12px 16px;
    border-right: 1px solid var(--guide);
    user-select: none;
  }

  /* Same tone as the header wordmark. */
  .brand {
    display: block;
    padding: 0 10px;
    margin-bottom: 14px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: var(--muted);
  }

  ul {
    list-style: none;
  }

  /* Hover target for the row: anchor and remove button are siblings. */
  li {
    position: relative;
  }

  a {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    border-radius: 6px;
    font-size: 13.5px;
    color: var(--muted);
    text-decoration: none;
  }
  /* li:hover (not a:hover) so the row stays lit while pointing at the ×. */
  li:hover a {
    background: var(--guide);
    color: var(--fg);
  }
  a.active {
    background: var(--guide);
    color: var(--fg);
    font-weight: 500;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    flex-shrink: 0;
    font-size: 11px;
    line-height: 1;
    padding: 3px 7px;
    border-radius: 999px;
    color: var(--muted);
    background: var(--guide);
  }
  /* The hover buttons replace the count while they're showing. */
  li:hover .count,
  li:has(.edit:focus-visible) .count,
  li:has(.remove:focus-visible) .count {
    visibility: hidden;
  }

  .edit,
  .remove {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    padding: 1px 6px;
    border: none;
    border-radius: 6px;
    background: none;
    font-size: 14px;
    line-height: 1.2;
    color: var(--muted);
    cursor: pointer;
    opacity: 0;
  }
  .remove {
    right: 6px;
  }
  .edit {
    right: 26px;
    display: flex;
    align-items: center;
    padding: 3px 4px;
  }
  li:hover .edit,
  li:hover .remove,
  .edit:focus-visible,
  .remove:focus-visible {
    opacity: 1;
  }
  .edit:hover,
  .remove:hover {
    color: var(--fg);
  }

  /* Sits where the anchor was, in the anchor's hover/active tone. */
  .rename {
    width: 100%;
    padding: 5px 10px;
    border: none;
    border-radius: 6px;
    background: var(--guide);
    font: inherit;
    font-size: 13.5px;
    color: var(--fg);
  }
  .rename:focus {
    outline: none;
  }
</style>
