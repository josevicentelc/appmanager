import { afterEach, describe, expect, it, vi } from "vitest";
import {
  digestDaemonStatus,
  registerDigestDaemonPauseHandler,
  registerDigestDaemonResumeHandler,
  setDigestDaemonPaused
} from "./status.js";

describe("digest daemon control", () => {
  afterEach(() => {
    registerDigestDaemonResumeHandler(null);
    registerDigestDaemonPauseHandler(null);
    digestDaemonStatus.paused = false;
  });

  it("pauses without scheduling work and schedules an immediate cycle when resumed", () => {
    const resume = vi.fn();
    const pause = vi.fn();
    registerDigestDaemonResumeHandler(resume);
    registerDigestDaemonPauseHandler(pause);

    setDigestDaemonPaused(true);
    expect(digestDaemonStatus.paused).toBe(true);
    expect(pause).toHaveBeenCalledOnce();
    expect(resume).not.toHaveBeenCalled();

    setDigestDaemonPaused(false);
    expect(digestDaemonStatus.paused).toBe(false);
    expect(resume).toHaveBeenCalledOnce();
  });
});
