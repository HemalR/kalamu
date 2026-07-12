<script lang="ts">
  /**
   * Hub-mode project list (rendered only when the app is served under
   * /p/<slug>). Entries are plain links on purpose: each project gets a
   * fresh app instance, so navigation is a full page load.
   */
  import { apiBase } from "../lib/api";

  interface HubProject {
    slug: string;
    name: string;
    path: string;
    openTasks: number | null;
    lastSeenAt: string;
  }

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
</script>

{#if projects !== null}
  <nav class="sidebar" aria-label="Projects">
    <span class="brand">kalamu</span>
    <ul>
      {#each projects as project (project.slug)}
        <li>
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
  a:hover {
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
</style>
