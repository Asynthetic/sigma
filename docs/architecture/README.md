# Maintaining the architecture graph

Start with the [overview and subsystem diagrams](overview.md) or the [agent context](agent-context.json). The [versioned graph](graph.json) is the canonical snapshot. Both views project the same graph, assembled from [the model](../../scripts/architecture/model.ts) and the current checkout using Node 26 and the installed TypeScript compiler.

## Graph contract

- `schemaVersion` versions the graph and context format. `nodes` is keyed by stable IDs such as `persistence.session`. Preserve an ID when its label, source path, or symbol changes, and never reuse a retired ID for a different concept.
- Nodes carry a subsystem, a repository-relative source reference, and relevant test paths where available. Semantic notes quote existing repository documentation or source.
- Edges carry `from`, `to`, `type`, `provenance`, and source evidence. Command edges list the Rust command names. Source anchors are symbols or literal excerpts and survive changes to line numbers.
- `verified` covers runtime TypeScript imports between modeled nodes, literal invocations of the named Tauri API, matching Rust command declarations and registrations, and literal Vite worker entry URLs.
- `declared` covers the interpretation of ownership, runtime gates, process lifecycle, channels, and worker messages. CI checks the supplied evidence anchors. Reviewers still evaluate whether the interpretation follows from the source.
- The context carries the same IDs, node sources, semantic notes, typed edges, and provenance in at most 16 KiB. Use the graph to look up per-edge evidence by its `from`, `to`, and `type` triple.

## Updating the graph

1. Update the modeled source inventory or declared relationships in `scripts/architecture/model.ts` with the responsible code change. For semantic notes, use existing source or reviewed project documentation and keep the evidence close to the claim.
2. Run `pnpm architecture:generate`. Review the graph and diagrams alongside the source change, especially any declared edges and semantic notes. Include generated changes in the same pull request.
3. Run `pnpm architecture:check` for a read-only comparison and `pnpm test` for schema, integrity, and determinism tests. CI runs the drift check on pull requests and pushes to `main`.

The MVP covers selected canvas components and Zustand stores, the Tauri command registry, native image and video paths, and project and profile persistence. The extractor reads the modeled frontend files and handles direct named imports and literal worker URLs. It recognizes the current Rust `generate_handler!` list and plain `#[tauri::command]` functions. Wrapper or computed IPC, Tauri plugin APIs, general Rust dependency analysis, and full runtime message tracing are outside the MVP. The check relies on code review for architectural changes that preserve a declared evidence anchor.
