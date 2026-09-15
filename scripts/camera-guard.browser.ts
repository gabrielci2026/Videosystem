import { CameraImageUnavailableError, pixelsContainVisibleImage, startCameraGuard } from "../src/lib/camera-guard";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function camera(mode: "visible" | "black" | "white" = "visible", continuous = true) {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 120;
  const context = canvas.getContext("2d")!;
  let current = mode;
  const draw = () => {
    context.fillStyle = current === "black" ? "black" : "white";
    context.fillRect(0, 0, 160, 120);
    if (current === "visible") {
      // A STILL scene must pass if the camera keeps sending new frames.
      context.fillStyle = "#486b9e";
      context.fillRect(0, 0, 80, 120);
      context.fillStyle = "#2d2425";
      context.fillRect(40, 20, 30, 70);
    }
  };
  draw();
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const emit = () => { draw(); track.requestFrame(); };
  let timer: number | undefined = continuous ? window.setInterval(emit, 50) : undefined;
  return {
    track, emit,
    change: (mode: typeof current) => { current = mode; },
    freeze: () => { clearInterval(timer); timer = undefined; },
    stop: () => { clearInterval(timer); track.stop(); },
  };
}

export async function runTests() {
  const results: string[] = [];
  const tests: Array<[string, () => Promise<void>]> = [];

  tests.push(["visible pixels, black/white screens and a covered-camera bright speck", async () => {
    const pixels = new Uint8ClampedArray(64 * 48 * 4);
    assert(!pixelsContainVisibleImage(pixels), "Black frame passed");
    pixels.fill(255);
    assert(!pixelsContainVisibleImage(pixels), "Uniform white frame passed");
    pixels.fill(0);
    pixels.set([255, 255, 255, 255], 0);
    assert(!pixelsContainVisibleImage(pixels), "One bright pixel passed");
  }]);

  tests.push(["still visible scene with new frames passes, without deviceId/frameRate metadata", async () => {
    const source = camera();
    const controller = new AbortController();
    let failures = 0;
    const guard = startCameraGuard(() => source.track, { signal: controller.signal, onFailure: () => failures++ });
    try {
      await guard.waitForImage();
      await guard.waitForImage();
      assert(failures === 0, "Valid video failed");
    } finally { guard.stop(); source.stop(); }
  }]);

  for (const mode of ["black", "white"] as const) {
    tests.push(["permission and live track with " + mode + " image cannot enter", async () => {
      const source = camera(mode);
      const controller = new AbortController();
      let failures = 0;
      const guard = startCameraGuard(() => source.track, { signal: controller.signal, onFailure: () => failures++ });
      try {
        const error = await guard.waitForImage().then(() => null, (error) => error);
        assert(error instanceof CameraImageUnavailableError, "Invalid image passed preflight");
        assert(failures === 1, "Failure must fire exactly once");
      } finally { guard.stop(); source.stop(); }
    }]);
  }

  tests.push(["single visible frame is not counted repeatedly", async () => {
    const source = camera("visible", false);
    const controller = new AbortController();
    const guard = startCameraGuard(() => source.track, { signal: controller.signal, onFailure: () => {} });
    try {
      source.emit();
      const error = await guard.waitForImage().then(() => null, (error) => error);
      assert(error instanceof CameraImageUnavailableError, "A single frozen frame passed preflight");
    } finally { guard.stop(); source.stop(); }
  }]);

  for (const loss of ["covered", "frozen", "disabled", "stopped", "ended"] as const) {
    tests.push(["connected camera " + loss + " triggers closure", async () => {
      const source = camera();
      const controller = new AbortController();
      let failure: Error | undefined;
      let failureCount = 0;
      const guard = startCameraGuard(() => source.track, {
        signal: controller.signal, onFailure: (error) => { failure = error; failureCount++; },
      });
      try {
        await guard.waitForImage();
        if (loss === "covered") source.change("black");
        if (loss === "frozen") source.freeze();
        if (loss === "disabled") source.track.enabled = false;
        if (loss === "stopped") source.track.stop(); // No "ended" event is emitted by stop().
        if (loss === "ended") source.track.dispatchEvent(new Event("ended"));
        const deadline = performance.now() + 6200;
        while (!failure && performance.now() < deadline) await wait(100);
        assert(failure instanceof CameraImageUnavailableError, "Camera loss was not detected: " + loss);
        assert(failureCount === 1, "Duplicate closure");
      } finally { guard.stop(); source.stop(); }
    }]);
  }

  tests.push(["loss between preflight and joining cannot reuse an old success", async () => {
    const source = camera();
    const controller = new AbortController();
    const guard = startCameraGuard(() => source.track, { signal: controller.signal, onFailure: () => {} });
    try {
      await guard.waitForImage();
      source.change("black");
      await wait(400);
      const error = await guard.waitForImage().then(() => null, (error) => error);
      assert(error instanceof CameraImageUnavailableError, "Stale preflight success allowed admission");
    } finally { guard.stop(); source.stop(); }
  }]);

  tests.push(["cancelling preflight removes the probe and rejects pending admission", async () => {
    const source = camera("black");
    const controller = new AbortController();
    let failures = 0;
    const guard = startCameraGuard(() => source.track, { signal: controller.signal, onFailure: () => failures++ });
    const result = guard.waitForImage().then(() => null, (error: Error) => error);
    controller.abort();
    const error = await result;
    assert(error?.name === "AbortError", "Cancellation did not reject admission");
    assert(failures === 0, "Cancellation was reported as camera failure");
    source.stop();
  }]);

  tests.push(["pending video.play() cannot hang camera validation", async () => {
    const source = camera("black", false);
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = () => new Promise(() => {});
    const controller = new AbortController();
    const guard = startCameraGuard(() => source.track, { signal: controller.signal, onFailure: () => {} });
    try {
      const error = await guard.waitForImage().then(() => null, (error) => error);
      assert(error instanceof CameraImageUnavailableError, "Missing playback did not time out");
    } finally { guard.stop(); source.stop(); HTMLMediaElement.prototype.play = originalPlay; }
  }]);

  tests.push(["decoder counter works without rendering callbacks", async () => {
    const originalCallback = HTMLVideoElement.prototype.requestVideoFrameCallback;
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", { configurable: true, writable: true, value: undefined });
    const source = camera();
    const controller = new AbortController();
    const guard = startCameraGuard(() => source.track, { signal: controller.signal, onFailure: () => {} });
    try { await guard.waitForImage(); }
    finally {
      guard.stop(); source.stop();
      HTMLVideoElement.prototype.requestVideoFrameCallback = originalCallback;
    }
  }]);

  tests.push(["a replacement track needs fresh image and ignores the old track ending", async () => {
    const source = camera();
    const replacement = camera("black");
    let currentTrack: MediaStreamTrack = source.track;
    const controller = new AbortController();
    let failures = 0;
    const guard = startCameraGuard(() => currentTrack, { signal: controller.signal, onFailure: () => failures++ });
    try {
      await guard.waitForImage();
      currentTrack = replacement.track;
      source.track.dispatchEvent(new Event("ended"));
      let admitted = false;
      const admission = guard.waitForImage().then(() => { admitted = true; });
      await wait(400);
      assert(!admitted, "The replacement reused the old track's image");
      replacement.change("visible");
      await admission;
      assert(failures === 0, "The old track closed the replacement camera");
    } finally { guard.stop(); source.stop(); replacement.stop(); }
  }]);

  tests.push(["a stale play rejection does not close a replacement camera", async () => {
    const source = camera("black", false);
    const replacement = camera();
    let currentTrack: MediaStreamTrack = source.track;
    const originalPlay = HTMLMediaElement.prototype.play;
    let plays = 0;
    let rejectOldPlay: (() => void) | undefined;
    HTMLMediaElement.prototype.play = function () {
      if (++plays === 1) return new Promise<void>((_resolve, reject) => {
        rejectOldPlay = () => reject(new DOMException("Source replaced", "AbortError"));
      });
      return originalPlay.call(this);
    };
    const controller = new AbortController();
    let failures = 0;
    const guard = startCameraGuard(() => currentTrack, { signal: controller.signal, onFailure: () => failures++ });
    try {
      currentTrack = replacement.track;
      await wait(400);
      rejectOldPlay?.();
      await guard.waitForImage();
      assert(failures === 0, "A stale playback promise closed the current camera");
    } finally {
      guard.stop(); source.stop(); replacement.stop();
      HTMLMediaElement.prototype.play = originalPlay;
    }
  }]);

  for (const [name, run] of tests) {
    await run();
    assert(document.querySelectorAll("[data-camera-probe]").length === 0, "Leaked probe after " + name);
    results.push(name);
    console.log("PASS " + name);
  }
  return results;
}
