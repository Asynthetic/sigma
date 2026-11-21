export interface SourceRef {
  path: string;
  symbol?: string;
}

export interface SemanticNote {
  path: string;
  excerpt: string;
}

export type NodeSpec = (
  | (SourceRef & { commands?: string; package?: never })
  | {
      path?: never;
      package: string;
      importSpecifier?: string;
      symbol?: never;
      commands?: never;
    }
) & {
  label?: string;
  notes?: readonly SemanticNote[];
  tests?: readonly string[];
};

const declaredTypes = [
  "assigns",
  "delegates",
  "encodes",
  "frame_channel",
  "initializes",
  "loads",
  "persists",
  "queues_frames",
  "sends_control",
  "starts_process",
  "telemetry_channel",
  "worker_message",
] as const;

export type DeclaredEdgeType = (typeof declaredTypes)[number];
export const declaredEdgeTypes: ReadonlySet<string> = new Set(declaredTypes);

export interface Declaration {
  from: string;
  to: string;
  type: DeclaredEdgeType;
  evidence: readonly SourceRef[];
}

export interface ArchitectureModel {
  schemaVersion: number;
  subsystems: Readonly<Record<string, string>>;
  registry: string;
  nodes: readonly (NodeSpec & { id: string })[];
  declarations: readonly Declaration[];
}

export type GraphEdge =
  | (Declaration & { provenance: "declared" })
  | ({
      from: string;
      to: string;
      provenance: "verified";
      evidence: readonly SourceRef[];
    } & (
      | { type: "imports" | "starts_worker" }
      | { type: "invokes" | "registers"; commands: readonly string[] }
    ));

export type ReadSource = (path: string) => string | undefined;
