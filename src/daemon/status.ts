export interface DigestDaemonStatus {
  enabled: boolean;
  paused: boolean;
  running: boolean;
  currentRepository: string | null;
  currentCommit: string | null;
  lastCycleStartedAt: string | null;
  lastCycleFinishedAt: string | null;
  indexedThisCycle: number;
  ignoredThisCycle: number;
  failedThisCycle: number;
}

export const digestDaemonStatus: DigestDaemonStatus = {
  enabled: false,
  paused: false,
  running: false,
  currentRepository: null,
  currentCommit: null,
  lastCycleStartedAt: null,
  lastCycleFinishedAt: null,
  indexedThisCycle: 0,
  ignoredThisCycle: 0,
  failedThisCycle: 0
};

let resumeHandler: (() => void) | null = null;
let pauseHandler: (() => void) | null = null;

export function setDigestDaemonPaused(paused: boolean): void {
  digestDaemonStatus.paused = paused;
  if (paused) {
    pauseHandler?.();
  } else {
    resumeHandler?.();
  }
}

export function registerDigestDaemonResumeHandler(handler: (() => void) | null): void {
  resumeHandler = handler;
}

export function registerDigestDaemonPauseHandler(handler: (() => void) | null): void {
  pauseHandler = handler;
}
