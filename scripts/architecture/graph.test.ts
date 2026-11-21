import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scanFrontend } from "./extract.ts";
import { buildGraph } from "./graph.ts";
import { model } from "./model.ts";
import { CONTEXT_MAX_BYTES, renderOutputs } from "./render.ts";

function read(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

describe("architecture graph integrity", () => {
  it("requires a supported schema and valid unique node IDs", () => {
    expect(() => buildGraph({ ...model, schemaVersion: 2 }, read)).toThrow(
      "Unsupported architecture schema version",
    );
    const [first, ...others] = model.nodes;
    expect(() =>
      buildGraph({ ...model, nodes: [...others, first, first] }, read),
    ).toThrow("Duplicate architecture node ID");
    expect(() =>
      buildGraph(
        { ...model, nodes: [...others, { ...first, id: "unknown.app" }] },
        read,
      ),
    ).toThrow("Invalid architecture node ID or subsystem");
  });

  it("rejects edges with missing endpoints, duplicate identities or missing evidence", () => {
    const [first, ...others] = model.declarations;
    expect(() =>
      buildGraph(
        { ...model, declarations: [{ ...first, to: "media.missing" }] },
        read,
      ),
    ).toThrow("Dangling architecture edge");
    expect(() =>
      buildGraph({ ...model, declarations: [...others, first, first] }, read),
    ).toThrow("Duplicate architecture edge");
    expect(() =>
      buildGraph(
        { ...model, declarations: [{ ...first, evidence: [] }] },
        read,
      ),
    ).toThrow("missing evidence");
  });

  it("fails when a file, source anchor or existing semantic quote disappears", () => {
    expect(() =>
      buildGraph(model, (path) =>
        path === "src/App.tsx" ? undefined : read(path),
      ),
    ).toThrow("Missing architecture source: src/App.tsx");
    expect(() =>
      buildGraph(model, (path) =>
        path === "src/App.tsx" ? "/* moved */" : read(path),
      ),
    ).toThrow("Missing source anchor in src/App.tsx: App");
    expect(() =>
      buildGraph(model, (path) =>
        path === "docs/engineering-audit.md" ? "Edited audit" : read(path),
      ),
    ).toThrow("Missing source anchor in docs/engineering-audit.md");
  });

  it("connects literal frontend invokes to declared and registered Rust handlers", () => {
    const graph = buildGraph(model, read);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: "persistence.files",
        to: "persistence.atomic",
        type: "invokes",
        provenance: "verified",
        commands: ["save_canvas_atomic"],
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: "ipc.builder",
        to: "persistence.atomic",
        type: "registers",
        provenance: "verified",
        commands: ["save_canvas_atomic"],
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: "media.broker",
        to: "media.video",
        type: "frame_channel",
        provenance: "declared",
      }),
    );

    const withoutRegistration = (path: string) =>
      path === "src-tauri/src/lib.rs"
        ? read(path)?.replace("canvas_persistence::save_canvas_atomic,", "")
        : read(path);
    expect(() => buildGraph(model, withoutRegistration)).toThrow(
      "Unregistered Tauri command: canvas_persistence::save_canvas_atomic",
    );
    const withoutHandler = (path: string) =>
      path === "src-tauri/src/canvas_persistence.rs"
        ? read(path)?.replace("fn save_canvas_atomic", "fn renamed")
        : read(path);
    expect(() => buildGraph(model, withoutHandler)).toThrow(
      "Tauri registration has no declaration: canvas_persistence::save_canvas_atomic",
    );
    const withStaleInvoke = (path: string) =>
      path === "src/utils/fs.ts"
        ? read(path)?.replace(
            'invoke("save_canvas_atomic"',
            'invoke("stale_command"',
          )
        : read(path);
    expect(() => buildGraph(model, withStaleInvoke)).toThrow(
      "Unregistered Tauri invoke in src/utils/fs.ts: stale_command",
    );
  });

  it("uses TypeScript syntax and bindings for imports, literal invokes and worker URLs", () => {
    const result = scanFrontend(
      "src/example.ts",
      [
        'import type { Something } from "./types";',
        'import { type SomethingElse } from "./type-only";',
        'import { invoke as dispatch } from "@tauri-apps/api/core";',
        '// dispatch("ignored");',
        'function ignored(dispatch: (name: string) => void) { dispatch("shadowed"); }',
        'dispatch<string>("real_command");',
        'new Worker(new URL("./compositor.worker.ts", import.meta.url), { type: "module" });',
      ].join("\n"),
    );
    expect(result.imports).toEqual(["@tauri-apps/api/core"]);
    expect([...result.commands]).toEqual(["real_command"]);
    expect([...result.workers]).toEqual(["src/compositor.worker.ts"]);
    expect(() =>
      scanFrontend(
        "src/example.ts",
        [
          'import { invoke } from "@tauri-apps/api/core";',
          "invoke(command);",
        ].join("\n"),
      ),
    ).toThrow("use a literal Tauri command");
  });

  it("produces identical committed outputs under reordered inputs", () => {
    const outputs = renderOutputs(buildGraph(model, read));
    const reordered = {
      ...model,
      nodes: [...model.nodes].reverse(),
      declarations: [...model.declarations].reverse(),
      subsystems: Object.fromEntries(
        Object.entries(model.subsystems).reverse(),
      ),
    };
    expect(renderOutputs(buildGraph(reordered, read))).toEqual(outputs);
    for (const [file, contents] of outputs) {
      expect(read(`docs/architecture/${file}`), file).toBe(contents);
    }
  });

  it("preserves stable IDs, source references and provenance within the context budget", () => {
    const graph = buildGraph(model, read);
    const outputs = renderOutputs(graph);
    const serialized = outputs.get("agent-context.json") ?? "";
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(
      CONTEXT_MAX_BYTES,
    );
    const context = JSON.parse(serialized);
    expect(context.schemaVersion).toBe(1);
    expect(context.graph).toBe("docs/architecture/graph.json");
    expect(context.nodes["media.packet"].source).toEqual({
      path: "src-tauri/src/native_video/frame_packet.rs",
      symbol: "write_yuv420_packet_from_payload",
    });
    expect(context.nodes["media.packet"].notes[0].provenance).toBe("declared");
    expect(context.edges).toHaveLength(graph.edges.length);
    const oversized = {
      ...graph,
      nodes: {
        ...graph.nodes,
        "canvas.app": {
          ...graph.nodes["canvas.app"],
          label: "x".repeat(CONTEXT_MAX_BYTES),
        },
      },
    };
    expect(() => renderOutputs(oversized)).toThrow(
      "agent-context.json exceeds",
    );
  });
});
