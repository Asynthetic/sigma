import {
  declaredCommands,
  registeredCommands,
  resolveSpecifier,
  scanFrontend,
} from "./extract.ts";
import {
  type ArchitectureModel,
  declaredEdgeTypes,
  type GraphEdge,
  type ReadSource,
  type SourceRef,
} from "./types.ts";

export const GRAPH_VERSION = 1;
const idPattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;

function compare(a: string, b: string) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function sortedEntries<T>(record: Readonly<Record<string, T>>) {
  return Object.keys(record)
    .sort()
    .map((key) => [key, record[key]] as const);
}

export function buildGraph(model: ArchitectureModel, read: ReadSource) {
  if (model.schemaVersion !== GRAPH_VERSION) {
    throw new Error(
      `Unsupported architecture schema version ${model.schemaVersion}`,
    );
  }
  const subsystems = sortedEntries(model.subsystems);
  for (const [id, title] of subsystems) {
    if (!/^[a-z][a-z0-9]*$/.test(id) || !title.trim())
      throw new Error(`Invalid subsystem ${id}`);
  }

  const sources = new Map<string, string>();
  function readRequired(path: string) {
    if (
      !path ||
      path.split("/").some((part) => !part || part === "." || part === "..") ||
      /[:\\]/.test(path)
    ) {
      throw new Error(`Invalid repository-relative source path: ${path}`);
    }
    const cached = sources.get(path);
    if (cached !== undefined) return cached;
    const source = read(path);
    if (source === undefined)
      throw new Error(`Missing architecture source: ${path}`);
    sources.set(path, source);
    return source;
  }

  function checkRef({ path, symbol }: SourceRef) {
    const source = readRequired(path);
    if (symbol !== undefined && (!symbol.trim() || !source.includes(symbol))) {
      throw new Error(`Missing source anchor in ${path}: ${symbol}`);
    }
    return source;
  }

  const imports = new Map<string, string>();
  const handlers = new Map<
    string,
    { node: string; path: string; name: string }
  >();
  const nodeIds = new Set(model.nodes.map((node) => node.id));
  if (nodeIds.size !== model.nodes.length)
    throw new Error("Duplicate architecture node ID");
  const nodes = Object.fromEntries(
    model.nodes
      .slice()
      .sort((a, b) => compare(a.id, b.id))
      .map(({ id, ...spec }) => {
        const subsystem = id.split(".")[0];
        if (
          !idPattern.test(id) ||
          !Object.hasOwn(model.subsystems, subsystem)
        ) {
          throw new Error(`Invalid architecture node ID or subsystem: ${id}`);
        }
        if (spec.package) {
          const manifest = JSON.parse(readRequired("package.json"));
          if (!Object.hasOwn(manifest.dependencies, spec.package))
            throw new Error(`Missing dependency: ${spec.package}`);
          imports.set(spec.importSpecifier ?? spec.package, id);
        } else if (spec.path) {
          const source = checkRef(spec);
          if (/\.tsx?$/.test(spec.path)) {
            if (imports.has(spec.path))
              throw new Error(`Duplicate frontend source: ${spec.path}`);
            imports.set(spec.path, id);
          }
          if (spec.commands !== undefined) {
            const names = declaredCommands(source);
            if (!names.length)
              throw new Error(`No Tauri command declarations in ${spec.path}`);
            for (const name of names) {
              const qualified = spec.commands
                ? `${spec.commands}::${name}`
                : name;
              if (handlers.has(qualified))
                throw new Error(`Duplicate Tauri command: ${qualified}`);
              handlers.set(qualified, { node: id, path: spec.path, name });
            }
          }
        } else {
          throw new Error(`Missing source for architecture node: ${id}`);
        }
        const notes = spec.notes?.map(({ path, excerpt }) => {
          checkRef({ path, symbol: excerpt });
          return { provenance: "declared" as const, path, excerpt };
        });
        const tests = spec.tests?.slice().sort();
        tests?.forEach(readRequired);
        const label =
          spec.label ??
          spec.symbol ??
          spec.package ??
          spec.path?.split("/").at(-1);
        return [
          id,
          {
            subsystem,
            label,
            source: spec.path
              ? { path: spec.path, symbol: spec.symbol }
              : { path: "package.json", symbol: spec.package },
            notes,
            tests,
          },
        ];
      }),
  );

  const registry = nodes[model.registry];
  if (!registry?.source.path.endsWith(".rs"))
    throw new Error("Missing Tauri registry node");
  const registered = new Map<
    string,
    { node: string; path: string; name: string }
  >();
  for (const entry of registeredCommands(readRequired(registry.source.path))) {
    const handler = handlers.get(entry);
    if (!handler)
      throw new Error(`Tauri registration has no declaration: ${entry}`);
    if (registered.has(handler.name))
      throw new Error(`Duplicate registered command name: ${handler.name}`);
    registered.set(handler.name, handler);
  }
  for (const [entry, handler] of handlers) {
    if (registered.get(handler.name) !== handler)
      throw new Error(`Unregistered Tauri command: ${entry}`);
  }

  const edges = new Map<string, GraphEdge>();
  function addEdge(edge: GraphEdge) {
    if (!Object.hasOwn(nodes, edge.from) || !Object.hasOwn(nodes, edge.to)) {
      throw new Error(`Dangling architecture edge: ${edge.from} -> ${edge.to}`);
    }
    const key = `${edge.from}:${edge.to}:${edge.type}`;
    if (edges.has(key)) throw new Error(`Duplicate architecture edge: ${key}`);
    edges.set(key, edge);
  }

  function addCommandEdges(
    from: string,
    type: "registers" | "invokes",
    names: Iterable<string>,
    path: string,
  ) {
    const byTarget = new Map<string, { path: string; names: string[] }>();
    for (const name of names) {
      const handler = registered.get(name);
      if (!handler)
        throw new Error(`Unregistered Tauri invoke in ${path}: ${name}`);
      const group = byTarget.get(handler.node) ?? {
        path: handler.path,
        names: [],
      };
      group.names.push(name);
      byTarget.set(handler.node, group);
    }
    for (const [to, group] of byTarget) {
      addEdge({
        from,
        to,
        type,
        provenance: "verified",
        commands: group.names.sort(),
        evidence:
          type === "registers"
            ? [
                { path, symbol: "tauri::generate_handler!" },
                { path: group.path, symbol: "#[tauri::command]" },
              ]
            : [
                { path, symbol: "@tauri-apps/api/core" },
                { path: group.path, symbol: "#[tauri::command]" },
              ],
      });
    }
  }

  addCommandEdges(
    model.registry,
    "registers",
    registered.keys(),
    registry.source.path,
  );
  for (const [path, from] of imports) {
    if (!/\.tsx?$/.test(path)) continue;
    const source = scanFrontend(path, readRequired(path));
    const imported = new Map<string, string>();
    for (const specifier of source.imports) {
      const resolved = resolveSpecifier(path, specifier);
      const to = [resolved, `${resolved}.ts`, `${resolved}.tsx`]
        .map((candidate) => imports.get(candidate))
        .find(Boolean);
      if (to) imported.set(to, specifier);
    }
    for (const [to, symbol] of imported) {
      addEdge({
        from,
        to,
        type: "imports",
        provenance: "verified",
        evidence: [{ path, symbol }],
      });
    }
    for (const worker of source.workers) {
      const to = imports.get(worker);
      if (!to)
        throw new Error(`Unmapped worker entry point from ${path}: ${worker}`);
      addEdge({
        from,
        to,
        type: "starts_worker",
        provenance: "verified",
        evidence: [{ path, symbol: "new Worker" }, { path: worker }],
      });
    }
    addCommandEdges(from, "invokes", source.commands, path);
  }

  for (const edge of model.declarations) {
    if (!declaredEdgeTypes.has(edge.type) || !edge.evidence.length) {
      throw new Error(
        `Invalid declared edge or missing evidence: ${edge.type}`,
      );
    }
    edge.evidence.forEach(checkRef);
    addEdge({ ...edge, provenance: "declared" });
  }

  return {
    schemaVersion: GRAPH_VERSION,
    subsystems: Object.fromEntries(subsystems),
    nodes,
    edges: [...edges.entries()]
      .sort(([a], [b]) => compare(a, b))
      .map(([, edge]) => edge),
  };
}

export type ArchitectureGraph = ReturnType<typeof buildGraph>;
