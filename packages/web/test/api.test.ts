import { describe, expect, it, vi } from "vitest";
import { subscribeToServerEvents, setBackend, type BackendEvents } from "../src/lib/api";
import { createMemoryBackend } from "../src/lib/memory-backend";
import { OutlineStore } from "../src/lib/outline.svelte";

class FakeEventStream extends EventTarget {
  close = vi.fn();
}

describe("subscribeToServerEvents", () => {
  it("forwards events until its idempotent disposer closes the stream", () => {
    const stream = new FakeEventStream();
    const events: BackendEvents = {
      onConnected: vi.fn(),
      onDisconnected: vi.fn(),
      onOutlineChanged: vi.fn(),
      onMetaChanged: vi.fn(),
    };
    const createSource = vi.fn(() => stream);

    const stop = subscribeToServerEvents(events, createSource);
    expect(createSource).toHaveBeenCalledWith("/api/events");

    stream.dispatchEvent(new Event("open"));
    stream.dispatchEvent(new Event("error"));
    stream.dispatchEvent(new Event("outline-changed"));
    stream.dispatchEvent(new Event("meta-changed"));
    expect(events.onConnected).toHaveBeenCalledOnce();
    expect(events.onDisconnected).toHaveBeenCalledOnce();
    expect(events.onOutlineChanged).toHaveBeenCalledOnce();
    expect(events.onMetaChanged).toHaveBeenCalledOnce();

    stop();
    stop();
    expect(stream.close).toHaveBeenCalledOnce();

    stream.dispatchEvent(new Event("open"));
    stream.dispatchEvent(new Event("outline-changed"));
    expect(events.onConnected).toHaveBeenCalledOnce();
    expect(events.onOutlineChanged).toHaveBeenCalledOnce();
  });
});

describe("OutlineStore event lifecycle", () => {
  it("does not open a stream when initial loading finishes after pagehide", async () => {
    const backend = createMemoryBackend([]);
    let finishNodes!: (result: { nodes: [] }) => void;
    backend.getNodes = () =>
      new Promise((resolve) => {
        finishNodes = resolve;
      });
    const stop = vi.fn();
    backend.subscribe = vi.fn(() => stop);
    setBackend(backend);

    const store = new OutlineStore();
    const init = store.init();
    store.pauseEvents();
    finishNodes({ nodes: [] });
    await init;

    expect(backend.subscribe).not.toHaveBeenCalled();

    store.resumeEvents();
    expect(backend.subscribe).toHaveBeenCalledOnce();
    store.pauseEvents();
    expect(stop).toHaveBeenCalledOnce();
  });
});
