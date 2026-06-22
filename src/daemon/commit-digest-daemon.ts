import type { AppConfig } from "../config.js";
import { openEngineeringMemoryDb, type EngineeringMemoryDb } from "../db/database.js";
import { isCommitProcessed } from "../db/knowledge-queries.js";
import { syncCommitVersionTags } from "../db/commit-store.js";
import { listCommitsNewestFirst, resolveCommit } from "../git/git-client.js";
import { ingestCommit, ingestOptionsFromRepository, readRepositoryVersionTags } from "../application/ingest-service.js";
import type { RepositoryConfig } from "../repositories/repository-config.js";
import {
  digestDaemonStatus,
  registerDigestDaemonPauseHandler,
  registerDigestDaemonResumeHandler
} from "./status.js";

export class CommitDigestDaemon {
  readonly #config: AppConfig;
  readonly #repositories: RepositoryConfig[];
  readonly #lastRunAt = new Map<string, number>();
  #db: EngineeringMemoryDb | null = null;
  #timer: NodeJS.Timeout | null = null;
  #cyclePromise: Promise<void> | null = null;
  #activeAnalysis: AbortController | null = null;
  #stopping = false;

  constructor(config: AppConfig, repositories: RepositoryConfig[]) {
    this.#config = config;
    this.#repositories = repositories.filter((repository) => repository.enabled);
  }

  async start(): Promise<void> {
    if (this.#timer !== null || this.#db !== null) {
      return;
    }
    if (this.#repositories.length === 0) {
      console.log("[digest] No enabled repositories configured");
      return;
    }

    this.#db = await openEngineeringMemoryDb(this.#config.database.path);
    digestDaemonStatus.enabled = true;
    digestDaemonStatus.paused = false;
    registerDigestDaemonResumeHandler(() => this.#scheduleCycle(true));
    registerDigestDaemonPauseHandler(() => this.#activeAnalysis?.abort());
    const schedulerIntervalMs = Math.min(
      ...this.#repositories.map((repository) => repository.polling.intervalSeconds * 1000)
    );

    console.log(`[digest] Monitoring ${this.#repositories.length} repositories every ${schedulerIntervalMs / 1000}s`);
    this.#scheduleCycle(true);
    this.#timer = setInterval(() => this.#scheduleCycle(false), schedulerIntervalMs);
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    digestDaemonStatus.enabled = false;
    digestDaemonStatus.paused = false;
    registerDigestDaemonResumeHandler(null);
    registerDigestDaemonPauseHandler(null);
    this.#activeAnalysis?.abort();
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    await this.#cyclePromise;
    if (this.#db !== null) {
      await this.#db.close();
      this.#db = null;
    }
  }

  #scheduleCycle(force: boolean): void {
    if (this.#stopping || digestDaemonStatus.paused || this.#cyclePromise !== null) {
      if (this.#cyclePromise !== null) {
        console.log("[digest] Cycle skipped because digestion is already running");
      }
      return;
    }

    this.#cyclePromise = this.#runCycle(force)
      .catch((error: unknown) => {
        console.error("[digest] Cycle failed", error instanceof Error ? error.message : error);
      })
      .finally(() => {
        this.#cyclePromise = null;
      });
  }

  async #runCycle(force: boolean): Promise<void> {
    const db = this.#db;
    if (db === null) {
      return;
    }

    digestDaemonStatus.running = true;
    digestDaemonStatus.lastCycleStartedAt = new Date().toISOString();
    digestDaemonStatus.indexedThisCycle = 0;
    digestDaemonStatus.ignoredThisCycle = 0;
    digestDaemonStatus.failedThisCycle = 0;

    try {
      const now = Date.now();
      for (const repository of this.#repositories) {
        if (this.#stopping || digestDaemonStatus.paused) {
          break;
        }
        const lastRunAt = this.#lastRunAt.get(repository.id) ?? 0;
        const intervalMs = repository.polling.intervalSeconds * 1000;
        if (!force && now - lastRunAt < intervalMs) {
          continue;
        }

        this.#lastRunAt.set(repository.id, now);
        await this.#digestRepository(db, repository);
      }
    } finally {
      digestDaemonStatus.running = false;
      digestDaemonStatus.currentRepository = null;
      digestDaemonStatus.currentCommit = null;
      digestDaemonStatus.lastCycleFinishedAt = new Date().toISOString();
    }
  }

  async #digestRepository(db: EngineeringMemoryDb, repository: RepositoryConfig): Promise<void> {
    digestDaemonStatus.currentRepository = repository.id;
    const history = repository.polling.initialHistory;
    const commits = await listCommitsNewestFirst(repository.checkout.localPath, repository.checkout.branch, {
      ...(history.count === undefined ? {} : { count: history.count }),
      ...(history.mode === "since" && history.since !== undefined ? { since: history.since } : {}),
      ...(repository.projectRoot === null ? {} : { paths: [repository.projectRoot] })
    });
    const branchHead = await resolveCommit(repository.checkout.localPath, repository.checkout.branch);
    console.log(`[digest] ${repository.id}/${repository.checkout.branch} head=${branchHead.slice(0, 8)} candidates=${commits.length}`);

    for (const commitHash of commits) {
      if (this.#stopping || digestDaemonStatus.paused) {
        break;
      }
      digestDaemonStatus.currentCommit = commitHash;
      const processed = await isCommitProcessed(db, repository.id, commitHash, this.#config.ai.chatModel);
      if (processed) {
        await syncCommitVersionTags(
          db,
          repository.id,
          commitHash,
          await readRepositoryVersionTags(repository, commitHash)
        );
        continue;
      }

      console.log(`[digest] ${repository.id} analyzing ${commitHash.slice(0, 8)}`);
      const analysisController = new AbortController();
      this.#activeAnalysis = analysisController;
      try {
        const result = await ingestCommit(db, this.#config, {
          ...ingestOptionsFromRepository(repository, commitHash),
          signal: analysisController.signal
        });
        if (result.status === "ignored") {
          digestDaemonStatus.ignoredThisCycle += 1;
          console.log(`[digest] ${repository.id} ignored ${commitHash.slice(0, 8)} ${result.reason}`);
        } else {
          digestDaemonStatus.indexedThisCycle += 1;
          console.log(`[digest] ${repository.id} indexed ${commitHash.slice(0, 8)} ${result.subject}`);
        }
      } catch (error) {
        if (analysisController.signal.aborted) {
          console.log(`[digest] ${repository.id} paused ${commitHash.slice(0, 8)} before storing analysis`);
          break;
        }
        digestDaemonStatus.failedThisCycle += 1;
        console.error(
          `[digest] ${repository.id} failed ${commitHash.slice(0, 8)}`,
          error instanceof Error ? error.message : error
        );
      } finally {
        if (this.#activeAnalysis === analysisController) {
          this.#activeAnalysis = null;
        }
      }
    }
  }
}
