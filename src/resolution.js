// Adaptive pixel ratio: GPU fill at DPR 2 is the first bottleneck on an iPad (docs/perf/2026-10-baseline.md).
// Judges the mean frame interval of each window of `interval` seconds: steps down when it is over `downMean`,
// steps up after `upWindows` windows in a row at or under `upMean`. A step down right after a step up doubles the
// windows needed before the next step up, so a ratio the GPU can't hold isn't retried every few seconds.
// shortcut: assumes the browser can draw at 60 Hz; a 50 Hz screen or iOS Low Power Mode (30 fps) sits at min.
// Judge against the shortest interval seen if that matters.
export function createResolution(t, deviceRatio, touch) {
  // Never above the screen's own ratio: those pixels would only be scaled away.
  const max = Math.min(t.max, deviceRatio);
  const min = Math.min(t.min, max);
  let ratio = Math.min(touch ? t.touchStart : t.max, max);
  let elapsed = 0;
  let frames = 0;
  let good = 0; // windows in a row at or under upMean
  let upWindows = t.upWindows;
  let steppedUp = false; // whether the last change was a step up, in the window just before this one

  // Takes one frame interval in ms; returns the new ratio when it changes, else null.
  function frame(ms) {
    elapsed += Math.min(ms, t.maxFrame);
    frames++;
    if (elapsed < t.interval * 1000) return null;
    const mean = elapsed / frames;
    const wasUp = steppedUp;
    elapsed = frames = 0;
    steppedUp = false;
    if (mean > t.downMean) {
      good = 0;
      if (wasUp) upWindows = Math.min(upWindows * 2, t.maxUpWindows);
      return change(Math.max(min, ratio - t.step));
    }
    good = mean <= t.upMean ? good + 1 : 0;
    if (good < upWindows) return null;
    good = 0;
    steppedUp = ratio < max;
    return change(Math.min(max, ratio + t.step));
  }

  function change(next) {
    if (next === ratio) return null;
    ratio = next;
    return ratio;
  }

  return { frame, get ratio() { return ratio; } };
}
