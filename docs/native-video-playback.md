# Native Video Playback Architecture

Sigma starts with a single-stream cap on an uncalibrated machine. Probe and frontend metrics can raise the cap before full validation. A profile that passes the 4K base case unlocks the 32-stream cap, subject to resource budgets and rendered size.

## Platform Validation

- Tauri v2 commands carry manifests, profile requests, calibration requests, and frontend metrics. Backend telemetry snapshots use a separate Tauri channel.
- Tauri v2 channels are the frame plane. Frame payloads are sent as `InvokeResponseBody::Raw(Vec<u8>)`, not JSON.
- Tauri events are not used for frames because they are JSON-oriented and intended for lower-throughput messages.
- The renderer probes `OffscreenCanvas.transferControlToOffscreen()` and starts a dedicated worker before any native manifest is sent.
- The worker probes `navigator.gpu.requestAdapter()` and `OffscreenCanvas.getContext("webgpu")`.
- If WebGPU is unavailable, the worker falls back to an OffscreenCanvas 2D compositor.
- The browser `<video>` path remains available. The native surface requires worker and OffscreenCanvas support, plus either a validated profile or `localStorage["sigma.nativeVideo.enabled"] = "true"`.
- To run the base-case probe from the app, also set `localStorage["sigma.nativeVideo.calibrate"] = "true"` and keep one source video visible; the first visible video is decoded through FFmpeg into the worker channel.

## Architecture

See the [generated native media diagram](architecture/media.md) for the IPC, frame, worker and profile paths. The [architecture graph](architecture/graph.json) records the source evidence for those relationships.

The [Rust decode worker](../src-tauri/src/native_video/worker.rs) runs FFmpeg from the application's PATH for active assignments. The [frame writer](../src-tauri/src/native_video/frame_packet.rs) packs the decoded YUV420 planes for the [frontend compositor](../src/workers/nativeVideoCompositor.worker.ts). The [base-case command](../src-tauri/src/native_video/commands.rs) has its own probe path.

## Rust Subsystems

### ResourceMonitor

Ownership:
- Runs as a long-lived async task spawned by `NativeVideoState::new`.
- Owns no frame buffers.
- Publishes process-local CPU and RSS telemetry every 150 ms through a watch channel.

Sampling:
- CPU core usage is derived from process CPU-time deltas divided by wall time. A value of `1.0` means one full core.
- CPU time and peak RSS come from platform process APIs. Unix uses `getrusage()`.
- The profile estimates a VRAM budget from detected or default capacity. The resource monitor samples CPU and RSS.

### AssetRegistry

Ownership:
- The controller owns the latest debounced `CanvasManifest`.
- React sends only visible video assets, rendered pixel occupancy, source dimensions, focus weight, and center weight.

Lifetime:
- Assets absent from the current manifest are removed from the worker set.
- Visible assets receive one worker handle, but that worker may be suspended.

### Arbiter

Ownership:
- Pure allocation logic. It does not decode, allocate frame buffers, or touch IPC.
- Inputs are manifest, profile, telemetry pressure, and previous decisions.

Rules:
- Uncalibrated profiles cap active streams at `1`. Partial calibration can raise the cap to `2` or `4`, depending on the available probe and frontend metrics. Validated profiles cap active streams at `32`.
- Assets are sorted by `priority = focus * 4 + center * 2 + sqrt(visible_area / canvas_area)`.
- Each asset receives the highest fixed tier whose predicted cumulative cost fits the safe budget.
- Upgrade requires explicit headroom and minimum dwell time.
- Downgrade requires sustained budget, queue, or drop pressure, with a shorter dwell to prevent flapping.

### DecodeWorkers

Ownership:
- One async worker exists per visible asset.
- Active assignments launch a looping FFmpeg subprocess with audio disabled. FFmpeg resamples the source to the assigned dimensions and frame rate and writes planar `yuv420p` rawvideo to stdout. The worker reads one frame at a time and packs it into a pooled SVF1 packet.
- `native_video_run_base_case_probe` selects a separate FFmpeg YUV420 probe when given a `sourcePath`. With no source, it generates synthetic YUV420 packets to exercise the frame channel and compositor. Probe packets go directly to the supplied channel.
- Workers are controlled through `watch::Sender<WorkerAssignment>`.

Lifetime:
- `Active` assignments emit frames at the assigned tier and fps.
- On reassignment the running worker stops its current decoder. `Suspended` assignments wait for another assignment without decoding. Decoder failures can retry after a short delay or reassignment.
- Removed assets abort their worker task.

### FrameBroker

Ownership:
- Owns the bounded decoded-frame queue.
- Drains the bounded queue, keeps the latest queued frame per stream in each drain, and dispatches raw packets directly to registered Tauri channel subscribers.
- Tracks delivered frames, dropped frames, queue depth, and pressure.

Hard caps:
- Broker input queue: `96` packets.
- The Rust packet pool is sized to the broker queue depth plus two. Workers back off under queue pressure and drop frames when a packet buffer is unavailable.

## Binary Frame Packet Format

All integer fields are little-endian. Header length is fixed at 64 bytes.

| Offset | Size | Field |
| --- | ---: | --- |
| 0 | 4 | Magic: `SVF1` |
| 4 | 1 | Version: `1` |
| 5 | 1 | Header length: `64` |
| 6 | 1 | Pixel format: `2 = planar YUV420` |
| 7 | 1 | Flags |
| 8 | 8 | Sequence |
| 16 | 8 | PTS microseconds |
| 24 | 8 | Stable FNV-1a stream id |
| 32 | 4 | Decode width |
| 36 | 4 | Decode height |
| 40 | 4 | Luma stride in bytes |
| 44 | 4 | Payload bytes |
| 48 | 2 | Quality tier id |
| 50 | 2 | Reserved |
| 52 | 4 | Y plane offset from packet start |
| 56 | 4 | U plane offset from packet start |
| 60 | 4 | V plane offset from packet start |
| 64 | N | Contiguous Y, U, V planes |

Y has `width × height` bytes, and each chroma plane has `width/2 × height/2` bytes. Decode dimensions are even. The worker derives the packed plane offsets from the header length and decode dimensions. The steady-state stream id is `FNV-1a-64(asset.id)`. The worker computes the same id for layout metadata, so frame packets never need JSON metadata alongside pixels.

## Frontend Compositor Loop

React responsibilities:
- Maintain editor state.
- Debounce and send visible-asset manifests.
- Transfer Tauri channel `ArrayBuffer` packets to the worker.
- Never place frame pixels in React state.

Worker responsibilities:
- Parse `SVF1` packets.
- Keep the latest frame per stream.
- Composite only active allocations.
- Prefer WebGPU:
  - `navigator.gpu.requestAdapter()`
  - `requestDevice()`
  - `canvas.getContext("webgpu")`
  - upload Y, U and V planes with `queue.writeTexture()`
  - convert the planes to RGBA with a compute shader and render textured quads at display resolution
- Fallback to OffscreenCanvas 2D:
  - convert YUV420 to RGBA in the worker and create an `ImageBitmap`
  - draw the bitmap through a per-stream scratch canvas into the display canvas
- Post upload/composite/drop/throughput metrics back to Rust.

## Resource Formulas

Safe budget:

```text
B_total = min(B_cpu_decode, B_ipc, 0.8 * B_ram_bw)
```

Tier raw byte rate:

```text
raw_bytes_per_sec = width * height * 1.5 * fps
```

Predicted tier cost:

```text
tier_cost =
  raw_bytes_per_sec *
  max(1.0, decode_factor + upload_factor + composite_factor)
```

Rendered-pixel cap:

```text
cap_w = rendered_width_px  * 1.15
cap_h = rendered_height_px * 1.15
```

A fixed tier is eligible only if its aspect-preserving tier dimensions fit within `cap_w` and `cap_h`. The cap rejects too-large tiers; it does not invent continuous intermediate decode sizes.

Hysteresis:

```text
downgrade if queue_pressure >= 0.65
          or frame_drop_rate >= 0.03
          or predicted_cost > B_total

upgrade only if headroom >= 0.25
            and queue_pressure <= 0.25
            and current_tier_dwell >= 2000 ms
```

## 32-Stream Target

For equal 32-way tiling on a 3840 x 2160 canvas:
- Typical 8 x 4 tile occupancy is approximately 480 x 540, or 480 x 270 for 16:9 content.
- The rendered-pixel cap rejects 720p, 1080p, and 2160p tiers for those tiles.
- The controller preserves focused and centered tiles first.
- Lowest-priority tiles fall from active tier to thumbnail/suspended before the broker queue can collapse.

The target is 32 source assets, not 32 decoded 4K outputs.

## Validation Plan

The profile validates when it receives 4K canvas metrics with at most 1% drops, P95 upload and composite latencies of at most 8 ms each, and a RAM-bandwidth measurement from the probe. Use these acceptance checks to exercise the 4K base case:
- One 3840 x 2160 stream at 60 fps.
- Run `native_video_run_base_case_probe` with a 4K source `sourcePath` when FFmpeg is available; use the synthetic path only to validate IPC/compositor plumbing.
- UI thread remains responsive.
- Worker compositor is active.
- Frame pixels are transported as binary channel payloads.
- P95 upload latency <= 8 ms.
- P95 composite latency <= 8 ms.
- Frame drop rate <= 1%.
- Broker queue pressure remains below 25% after warmup.
- Process peak CPU and RAM are recorded.
- Machine profile is persisted to `native-video-profile.json`.

Multi-stream pass/fail:
- Controller never assigns tiers whose predicted total cost exceeds `B_total`.
- No active decode above rendered-pixel cap.
- Quality decisions dwell long enough to avoid flap.
- Overload causes tier downgrade, then thumbnail, then suspend.
- Broker queue never grows beyond its hard cap.
- The app does not OOM under a 32 visible source-asset manifest.

## Degradation Ladder

1. Hold current tiers during transient jitter.
2. Downgrade lowest-priority active assets one tier.
3. Replace lowest-priority assets with thumbnails.
4. Suspend off-center or tiny assets.
5. Preserve focused/selected/audio-active assets preferentially.
6. Stop native presentation and keep the existing browser video path as the safe fallback.

## Calibrated Versus Hard Limits

Calibrated assumptions:
- CPU decode budget.
- IPC byte throughput.
- Upload/composite latency factors.
- RAM bandwidth budget.
- Base-case validation state.

Hard limits:
- 80% multiplier for RAM bandwidth and estimated VRAM capacity.
- Broker queue capacity of 96 packets.
- Active-stream caps of 1 uncalibrated, 2–4 partially calibrated, and 32 validated.
- Fixed quality tier list.
- Rendered-pixel cap.
