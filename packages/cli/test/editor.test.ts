import { describe, expect, it } from "vitest";
import { EDITOR_CHOICES, EDITOR_PRESETS, resolveEditorTemplate } from "../src/editor.js";

describe("resolveEditorTemplate", () => {
  it("expands a preset name and passes a custom {path} template through", () => {
    expect(resolveEditorTemplate("vscode")).toBe(EDITOR_PRESETS.vscode);
    expect(resolveEditorTemplate("  zed  ")).toBe(EDITOR_PRESETS.zed);
    expect(resolveEditorTemplate("myeditor://go?f={path}")).toBe("myeditor://go?f={path}");
  });

  it("rejects templates without {path}, without a scheme, or with a script scheme", () => {
    expect(resolveEditorTemplate("vscode://file/")).toBeNull();
    expect(resolveEditorTemplate("/usr/bin/code {path}")).toBeNull();
    expect(resolveEditorTemplate("javascript:alert({path})")).toBeNull();
    expect(resolveEditorTemplate("DATA:text/html,{path}")).toBeNull();
  });
});

describe("EDITOR_CHOICES", () => {
  it("offers a subset of the presets, VS Code first (the Enter default)", () => {
    expect(EDITOR_CHOICES[0].preset).toBe("vscode");
    for (const choice of EDITOR_CHOICES) {
      expect(EDITOR_PRESETS[choice.preset]).toContain("{path}");
    }
  });
});
