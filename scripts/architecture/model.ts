import type { ArchitectureModel } from "./types.ts";

const audit = "docs/engineering-audit.md";
const playback = "docs/native-video-playback.md";

export const model = {
  schemaVersion: 1,
  subsystems: {
    canvas: "React and Zustand",
    ipc: "Tauri IPC",
    media: "Native media",
    persistence: "Persistence",
  },
  registry: "ipc.builder",
  nodes: [
    { id: "canvas.app", path: "src/App.tsx", symbol: "App" },
    {
      id: "canvas.editor",
      path: "src/InfiniteCanvas.tsx",
      symbol: "InfiniteCanvas",
      notes: [
        {
          path: audit,
          excerpt:
            "React's `InfiniteCanvas` coordinates interaction, viewport and media components.",
        },
      ],
      tests: ["src/InfiniteCanvas.interactions.test.tsx"],
    },
    {
      id: "canvas.interaction",
      path: "src/stores/useInteractionStore.ts",
      symbol: "useInteractionStore",
    },
    {
      id: "canvas.settings",
      path: "src/stores/useSettingsStore.ts",
      symbol: "useSettingsStore",
    },
    {
      id: "canvas.audio",
      path: "src/stores/useAudioPlaybackStore.ts",
      symbol: "useAudioPlaybackStore",
    },
    {
      id: "canvas.zustand",
      package: "zustand",
      notes: [
        {
          path: audit,
          excerpt:
            "Zustand stores own the canvas session, settings, interaction and audio state.",
        },
      ],
    },
    {
      id: "ipc.builder",
      path: "src-tauri/src/lib.rs",
      symbol: "configure_tauri_builder",
    },
    {
      id: "ipc.client",
      package: "@tauri-apps/api",
      importSpecifier: "@tauri-apps/api/core",
      label: "@tauri-apps/api/core",
    },
    {
      id: "media.actions",
      path: "src/components/CanvasActions.tsx",
    },
    {
      id: "media.client",
      path: "src/utils/media.tsx",
    },
    {
      id: "media.commands",
      path: "src-tauri/src/lib.rs",
      label: "Media commands",
      commands: "",
      tests: ["src-tauri/tests/media_ipc.rs"],
    },
    {
      id: "media.decode",
      path: "src-tauri/src/decode_arbiter.rs",
      symbol: "DecodeArbiter",
    },
    {
      id: "media.image",
      path: "src/components/native-image/NativeImageSurface.tsx",
      symbol: "NativeImageSurface",
      notes: [
        {
          path: audit,
          excerpt:
            "Images have a separate worker-backed compositor and decode queue.",
        },
      ],
    },
    {
      id: "media.imageworker",
      path: "src/workers/nativeImageCompositor.worker.ts",
      tests: ["src/workers/nativeImageCompositor.worker.test.ts"],
    },
    {
      id: "media.video",
      path: "src/components/native-video/NativeVideoSurface.tsx",
      symbol: "NativeVideoSurface",
      notes: [
        {
          path: "src/components/native-video/NativeVideoSurface.tsx",
          excerpt: "profile.baseCaseValidated || shouldForceNativePlayback()",
        },
      ],
    },
    {
      id: "media.manifest",
      path: "src/components/native-video/useNativeVideoManifest.ts",
      symbol: "useNativeVideoManifest",
      tests: ["src/components/native-video/useNativeVideoManifest.test.ts"],
    },
    {
      id: "media.videoworker",
      path: "src/workers/nativeVideoCompositor.worker.ts",
    },
    {
      id: "media.videocommands",
      path: "src-tauri/src/native_video/commands.rs",
      label: "Native video commands",
      commands: "native_video::commands",
      tests: ["src-tauri/tests/native_video_scope.rs"],
    },
    {
      id: "media.state",
      path: "src-tauri/src/native_video/state.rs",
      symbol: "NativeVideoState",
    },
    {
      id: "media.monitor",
      path: "src-tauri/src/native_video/resource_monitor.rs",
      symbol: "spawn_resource_monitor",
    },
    {
      id: "media.controller",
      path: "src-tauri/src/native_video/controller.rs",
      symbol: "spawn_controller",
    },
    {
      id: "media.decoder",
      path: "src-tauri/src/native_video/worker.rs",
      symbol: "spawn_decode_worker",
      tests: ["desktop-tests/lifecycle.mjs"],
    },
    {
      id: "media.broker",
      path: "src-tauri/src/native_video/worker.rs",
      symbol: "spawn_frame_broker",
    },
    {
      id: "media.packet",
      path: "src-tauri/src/native_video/frame_packet.rs",
      symbol: "write_yuv420_packet_from_payload",
      notes: [
        {
          path: "src-tauri/src/native_video/frame_packet.rs",
          excerpt:
            "SVF1 payloads are packed as YUV420 planar bytes at 1.5 Bpp.",
        },
      ],
    },
    {
      id: "media.ffmpeg",
      label: "ffmpeg",
      path: "src-tauri/src/native_video/worker.rs",
      symbol: 'TokioCommand::new("ffmpeg")',
    },
    {
      id: "persistence.session",
      path: "src/stores/useCanvasSessionStore.ts",
      symbol: "useCanvasSessionStore",
      notes: [
        {
          path: audit,
          excerpt: "Save, Save As, and Load requests use one in-process FIFO.",
        },
        {
          path: "src/stores/useCanvasSessionStore.ts",
          excerpt: 'const SESSION_STORAGE_KEY = "sigma:canvas-session";',
        },
      ],
      tests: ["src/stores/useCanvasSessionStore.test.ts"],
    },
    {
      id: "persistence.files",
      path: "src/utils/fs.ts",
      notes: [
        {
          path: audit,
          excerpt:
            "Session JSON stores asset paths relative to the selected project file when possible.",
        },
      ],
      tests: ["src/utils/fs.test.ts"],
    },
    {
      id: "persistence.atomic",
      path: "src-tauri/src/canvas_persistence.rs",
      label: "Atomic project save",
      commands: "canvas_persistence",
      notes: [
        {
          path: audit,
          excerpt:
            "Ordinary failures before replacement remove the temporary file and leave the previous destination untouched.",
        },
      ],
      tests: ["src-tauri/tests/canvas_persistence.rs"],
    },
    {
      id: "persistence.profile",
      path: "src-tauri/src/native_video/profile.rs",
      label: "Native video profile",
      symbol: "persist_profile",
    },
  ],
  declarations: [
    {
      from: "ipc.builder",
      to: "media.state",
      type: "initializes",
      evidence: [
        {
          path: "src-tauri/src/lib.rs",
          symbol: "app.manage(native_video::NativeVideoState::new(",
        },
      ],
    },
    {
      from: "media.state",
      to: "media.controller",
      type: "initializes",
      evidence: [
        {
          path: "src-tauri/src/native_video/state.rs",
          symbol: "spawn_controller(",
        },
      ],
    },
    {
      from: "media.state",
      to: "media.monitor",
      type: "initializes",
      evidence: [
        {
          path: "src-tauri/src/native_video/state.rs",
          symbol: "spawn_resource_monitor(",
        },
      ],
    },
    {
      from: "media.state",
      to: "media.broker",
      type: "initializes",
      evidence: [
        {
          path: "src-tauri/src/native_video/state.rs",
          symbol: "spawn_frame_broker(",
        },
      ],
    },
    {
      from: "media.state",
      to: "persistence.profile",
      type: "loads",
      evidence: [
        {
          path: "src-tauri/src/native_video/state.rs",
          symbol: "load_profile(&profile_path)",
        },
      ],
    },
    {
      from: "media.commands",
      to: "media.decode",
      type: "delegates",
      evidence: [
        { path: "src-tauri/src/lib.rs", symbol: ".request_decode(item_id" },
      ],
    },
    {
      from: "media.videocommands",
      to: "media.controller",
      type: "sends_control",
      evidence: [
        {
          path: "src-tauri/src/native_video/commands.rs",
          symbol: "ControlMessage::UpdateManifest",
        },
        {
          path: "src-tauri/src/native_video/controller.rs",
          symbol: "ControlMessage::UpdateManifest",
        },
      ],
    },
    {
      from: "media.controller",
      to: "media.decoder",
      type: "assigns",
      evidence: [
        {
          path: audit,
          symbol:
            "the Rust controller arbitrates budgets and launches FFmpeg decode workers",
        },
        {
          path: "src-tauri/src/native_video/controller.rs",
          symbol: "reconcile_workers(",
        },
      ],
    },
    {
      from: "media.decoder",
      to: "media.ffmpeg",
      type: "starts_process",
      evidence: [
        {
          path: "src-tauri/src/native_video/worker.rs",
          symbol: "spawn_ffmpeg_rawvideo_decoder(&source_path",
        },
        {
          path: "src-tauri/src/native_video/worker.rs",
          symbol: "format=yuv420p",
        },
      ],
    },
    {
      from: "media.decoder",
      to: "media.packet",
      type: "encodes",
      evidence: [
        {
          path: "src-tauri/src/native_video/worker.rs",
          symbol: "write_yuv420_packet_from_payload(",
        },
      ],
    },
    {
      from: "media.decoder",
      to: "media.broker",
      type: "queues_frames",
      evidence: [
        {
          path: "src-tauri/src/native_video/worker.rs",
          symbol: "broker_tx.try_send(",
        },
      ],
    },
    {
      from: "media.broker",
      to: "media.video",
      type: "frame_channel",
      evidence: [
        { path: playback, symbol: "Tauri v2 channels are the frame plane." },
        {
          path: "src-tauri/src/native_video/worker.rs",
          symbol: "InvokeResponseBody::Raw",
        },
        {
          path: "src/components/native-video/NativeVideoSurface.tsx",
          symbol: "new Channel<ArrayBuffer>()",
        },
      ],
    },
    {
      from: "media.videocommands",
      to: "media.video",
      type: "frame_channel",
      evidence: [
        {
          path: "src-tauri/src/native_video/commands.rs",
          symbol: "ffmpeg-rawvideo-yuv420p",
        },
        {
          path: "src/components/native-video/NativeVideoSurface.tsx",
          symbol: "onFrame: frameChannelRef.current",
        },
      ],
    },
    {
      from: "media.videocommands",
      to: "media.video",
      type: "telemetry_channel",
      evidence: [
        {
          path: "src-tauri/src/native_video/commands.rs",
          symbol: "Channel<TelemetrySnapshot>",
        },
        {
          path: "src/components/native-video/NativeVideoSurface.tsx",
          symbol: "new Channel<NativeVideoTelemetrySnapshot>()",
        },
      ],
    },
    {
      from: "media.video",
      to: "media.videoworker",
      type: "worker_message",
      evidence: [
        {
          path: playback,
          symbol: "Transfer Tauri channel `ArrayBuffer` packets to the worker.",
        },
        {
          path: "src/components/native-video/NativeVideoSurface.tsx",
          symbol: 'worker.postMessage({ type: "frame"',
        },
        {
          path: "src/workers/nativeVideoCompositor.worker.ts",
          symbol: 'message.type === "frame"',
        },
      ],
    },
    {
      from: "media.videoworker",
      to: "media.video",
      type: "worker_message",
      evidence: [
        {
          path: playback,
          symbol: "Post upload/composite/drop/throughput metrics back to Rust.",
        },
        {
          path: "src/workers/nativeVideoCompositor.worker.ts",
          symbol: 'type: "metrics"',
        },
        {
          path: "src/components/native-video/NativeVideoSurface.tsx",
          symbol: 'message.type !== "metrics"',
        },
      ],
    },
    {
      from: "media.videocommands",
      to: "persistence.profile",
      type: "persists",
      evidence: [
        {
          path: "src-tauri/src/native_video/commands.rs",
          symbol: "persist_profile(",
        },
        {
          path: "src-tauri/src/native_video/profile.rs",
          symbol: "native-video-profile.json",
        },
      ],
    },
  ],
} satisfies ArchitectureModel;
