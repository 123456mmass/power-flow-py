/**
 * Server-side data access for React Server Components.
 *
 * This is the in-process implementation of the same contract the browser uses
 * over REST (`SolverClient`). Server components read through this facade to
 * avoid a self-fetch round trip; swapping to a remote service means replacing
 * these functions with `HttpSolverClient` calls against the service base URL.
 */

import type { AuditQuery, RunQuery } from "@/lib/solver/client";
import { SolverRequestError } from "@/lib/solver/client";
import { HttpSolverClient } from "@/lib/solver/http-client";
import { getEngine } from "@/server/mock/engine";

const remoteBase = process.env.SOLVER_API_BASE?.replace(/\/$/, "");
const remote = remoteBase ? new HttpSolverClient({ baseUrl: remoteBase }) : null;

export async function readStats() {
  return remote ? remote.stats() : getEngine().stats();
}

export async function readHealth() {
  return remote ? remote.health() : getEngine().health();
}

export async function readRuns(query: RunQuery = {}) {
  return remote ? remote.listRuns(query) : getEngine().list(query as never);
}

export async function readRun(runId: string) {
  if (!remote) return getEngine().get(runId);
  try {
    return await remote.getRun(runId);
  } catch (error) {
    if (error instanceof SolverRequestError && error.status === 404) return null;
    throw error;
  }
}

export async function readResult(runId: string) {
  if (!remote) return getEngine().result(runId);
  try {
    return await remote.getResult(runId);
  } catch (error) {
    if (error instanceof SolverRequestError && (error.status === 404 || error.code === "result_not_ready")) return null;
    throw error;
  }
}

export async function readPresets() {
  return remote ? remote.listPresets() : getEngine().presets();
}

export async function readAudit(query: AuditQuery = {}) {
  return remote ? remote.listAudit(query) : getEngine().audit(query);
}
