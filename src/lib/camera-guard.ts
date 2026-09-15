// Pixels stay in the browser; no camera images are uploaded or retained.
const sampleIntervalMs = 200;
const startupTimeoutMs = 8000;
const imageLossTimeoutMs = 5000;
const freshFrameMs = 1500;
const requiredFrames = 3;

export class CameraImageUnavailableError extends Error {
  constructor(message = "La cámara no entrega una imagen visible y actualizada. Revisa la tapa, la iluminación o la cámara seleccionada.") {
    super(message);
    this.name = "CameraImageUnavailableError";
  }
}

export function pixelsContainVisibleImage(pixels: Uint8ClampedArray) {
  if (!pixels.length || pixels.length % 4 !== 0) return false;
  let total = 0;
  let squares = 0;
  let minimum = 255;
  let maximum = 0;
  let visible = 0;
  const count = pixels.length / 4;
  for (let index = 0; index < pixels.length; index += 4) {
    const luminance = pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
    total += luminance;
    squares += luminance * luminance;
    minimum = Math.min(minimum, luminance);
    maximum = Math.max(maximum, luminance);
    if (luminance >= 24) visible += 1;
  }
  const average = total / count;
  return average >= 16 && visible / count >= 0.08 && maximum - minimum >= 24
    && squares / count - average * average >= 20;
}

export type CameraGuard = {
  /** Require three NEW visible samples, including at later admission checkpoints. */
  waitForImage: () => Promise<void>;
  stop: () => void;
};

type ImageWaiter = { sequence: number; deadline: number; resolve: () => void; reject: (error: Error) => void };

/** One independent probe survives preflight, connection and the entire call. */
export function startCameraGuard(
  getTrack: () => MediaStreamTrack | undefined,
  options: { signal: AbortSignal; onFailure: (error: CameraImageUnavailableError) => void },
): CameraGuard {
  const video = document.createElement("video");
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("aria-hidden", "true");
  video.dataset.cameraProbe = "true";
  video.style.cssText = "position:fixed;left:-10000px;width:64px;height:48px;pointer-events:none";
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 48;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const waiters = new Set<ImageWaiter>();
  let track: MediaStreamTrack | undefined;
  let stopped = false;
  let failure: Error | undefined;
  let interval: number | undefined;
  let callbackId: number | undefined;
  let presentedFrames = 0;
  let lastPresentedFrames = 0;
  let lastDecodedFrames = 0;
  let sequence = 0;
  let visibleFrames = 0;
  let validated = false;
  let lastVisibleAt = performance.now();
  let lastSampleAt = 0;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(interval);
    if (callbackId !== undefined) video.cancelVideoFrameCallback(callbackId);
    track?.removeEventListener("ended", onEnded);
    options.signal.removeEventListener("abort", stop);
    video.pause();
    video.srcObject = null;
    video.remove();
    for (const waiter of waiters) waiter.reject(failure ?? new DOMException("Comprobación cancelada", "AbortError"));
    waiters.clear();
  };

  const fail = (message?: string) => {
    if (stopped) return;
    const error = new CameraImageUnavailableError(message);
    failure = error;
    stop();
    options.onFailure(error);
  };

  function onEnded() {
    // LiveKit can replace the underlying track when reacquiring a device.
    if (track !== getTrack()) { sample(); return; }
    fail("La cámara se desconectó o perdió el permiso de acceso.");
  }

  const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
    if (stopped) return;
    presentedFrames = metadata.presentedFrames;
    callbackId = video.requestVideoFrameCallback(onFrame);
  };

  const sample = () => {
    if (stopped) return;
    const now = performance.now();
    const currentTrack = getTrack();
    // Track.stop() does not fire "ended", so polling is also necessary.
    if (!currentTrack || currentTrack.kind !== "video" || currentTrack.readyState !== "live" || !currentTrack.enabled) {
      fail("La cámara debe permanecer encendida para participar en la llamada.");
      return;
    }
    if (track !== currentTrack) {
      track?.removeEventListener("ended", onEnded);
      if (callbackId !== undefined) video.cancelVideoFrameCallback(callbackId);
      track = currentTrack;
      track.addEventListener("ended", onEnded);
      visibleFrames = 0;
      presentedFrames = lastPresentedFrames = lastDecodedFrames = 0;
      video.srcObject = new MediaStream([track]);
      if (typeof video.requestVideoFrameCallback === "function") {
        callbackId = video.requestVideoFrameCallback(onFrame);
      }
      // Do not await play(): a camera with permissions but no frames may never resolve it.
      void video.play().catch(() => {
        // Replacing srcObject can reject the previous track's pending play().
        if (track === currentTrack) fail("No se pudo reproducir la imagen de la cámara. Revisa el dispositivo e intenta nuevamente.");
      });
      return;
    }

    // The decoder counter also advances when rendering callbacks are throttled.
    // Never use currentTime alone: it can advance while displaying an old frame.
    const decodedFrames = video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
    const fresh = decodedFrames > lastDecodedFrames || presentedFrames > lastPresentedFrames;
    if (fresh) {
      lastDecodedFrames = decodedFrames;
      lastPresentedFrames = presentedFrames;
      let visible = false;
      if (!track.muted && !video.paused && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0 && context) {
        try {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          visible = pixelsContainVisibleImage(context.getImageData(0, 0, canvas.width, canvas.height).data);
        } catch { /* A frame that cannot be read is not proof of a working camera. */ }
      }
      if (now - lastSampleAt > freshFrameMs) visibleFrames = 0;
      lastSampleAt = now;
      sequence += 1;
      visibleFrames = visible ? visibleFrames + 1 : 0;
      if (visible) lastVisibleAt = now;
      for (const waiter of waiters) {
        if (visibleFrames >= requiredFrames && sequence - waiter.sequence >= requiredFrames) {
          validated = true;
          waiters.delete(waiter);
          waiter.resolve();
        }
      }
    } else if (track.muted || now - lastSampleAt > freshFrameMs) {
      visibleFrames = 0;
    }

    if (now - lastVisibleAt >= (validated ? imageLossTimeoutMs : startupTimeoutMs)
      || [...waiters].some((waiter) => now >= waiter.deadline)) {
      fail();
    }
  };

  const guard: CameraGuard = {
    stop,
    waitForImage: () => new Promise<void>((resolve, reject) => {
      if (stopped) {
        reject(failure ?? new DOMException("Comprobación cancelada", "AbortError"));
        return;
      }
      waiters.add({ sequence, deadline: performance.now() + startupTimeoutMs, resolve, reject });
    }),
  };
  options.signal.addEventListener("abort", stop, { once: true });
  if (options.signal.aborted) {
    stop();
    return guard;
  }
  document.body.appendChild(video);
  interval = window.setInterval(sample, sampleIntervalMs);
  sample();
  return guard;
}
