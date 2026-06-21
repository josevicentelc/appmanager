export interface DigestDaemonStatus {
  enabled: boolean;
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
  running: false,
  currentRepository: null,
  currentCommit: null,
  lastCycleStartedAt: null,
  lastCycleFinishedAt: null,
  indexedThisCycle: 0,
  ignoredThisCycle: 0,
  failedThisCycle: 0
};
