'use client';

import { NODE_LABELS, NODE_ORDER, type NodeKey } from '@/lib/reportNodes';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

// Re-exported so existing imports (and report-ui.test) keep resolving from here.
export { NODE_LABELS, NODE_ORDER, type NodeKey };

/** Returns the label for a given node name, or a formatted fallback. */
export function labelForNode(node: string | null | undefined): string {
  if (!node) return 'Starting…';
  return NODE_LABELS[node] ?? node;
}

/** Returns the index of the currently active step (0-based), or -1 if none. */
export function activeStepIndex(currentNode: string | null | undefined): number {
  if (!currentNode) return -1;
  return NODE_ORDER.indexOf(currentNode as NodeKey);
}

// ---------------------------------------------------------------------------
// API response shape
// ---------------------------------------------------------------------------

interface StatusResponse {
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  currentNode: string | null;
  percentage: number;
  pdfUrl: string | null;
  errorMessage: string | null;
  subjectAddress: string | null;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
      <div
        className="h-full rounded-full bg-accent transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function Stepper({ seen, currentNode }: { seen: Set<string>; currentNode: string | null }) {
  return (
    <ol className="space-y-2">
      {NODE_ORDER.map((node) => {
        // Monotonic: a step is "done" once its node has appeared as currentNode in
        // any poll. The graph runs the fan-out nodes in parallel, so completion
        // order isn't list order — but ticks only ever accumulate, never bounce
        // back (which is what made the old index-based stepper jump around).
        const isDone = seen.has(node);
        const isCurrent = node === currentNode; // most-recently-completed node (the frontier)
        return (
          <li
            key={node}
            className={`flex items-center gap-3 text-sm ${
              isCurrent ? 'text-ink font-medium' : isDone ? 'text-ink-muted' : 'text-ink-muted/50'
            }`}
          >
            {/* Step indicator: ✓ once seen, filled accent on the frontier, else a
                neutral dot (no numbers — completion isn't sequential here). */}
            <span
              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                isCurrent
                  ? 'bg-accent text-white'
                  : isDone
                    ? 'bg-accent/15 text-accent'
                    : 'bg-black/[0.06] text-ink-muted/40'
              }`}
            >
              {isDone ? '✓' : ''}
            </span>
            {NODE_LABELS[node]}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ReportProgress({ id }: { id: string }) {
  const [data, setData] = useState<StatusResponse | null>(null);
  // Accumulated set of nodes seen as `currentNode` across polls — drives the
  // monotonic stepper so ticks never bounce back (parallel fan-out completes out
  // of list order).
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [fetchError, setFetchError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Define stop/poll locally inside the effect so Biome sees no external deps.
    function stop() {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    async function pollOnce() {
      try {
        const res = await fetch(`/api/reports/${id}`);
        if (!res.ok) {
          setFetchError('Could not load report status.');
          stop();
          return;
        }
        const json = (await res.json()) as StatusResponse;
        setData(json);
        const cn = json.currentNode;
        if (cn) setSeen((s) => (s.has(cn) ? s : new Set(s).add(cn)));
        if (json.status !== 'queued' && json.status !== 'running') {
          stop();
        }
      } catch {
        setFetchError('Network error. Please refresh the page.');
        stop();
      }
    }

    void pollOnce();
    intervalRef.current = setInterval(() => {
      void pollOnce();
    }, 2000);
    return stop;
  }, [id]);

  // ---- Loading skeleton ----
  if (!data && !fetchError) {
    return (
      <div className="rounded-lg border border-black/5 bg-bg-card p-8 shadow-sm">
        <div className="h-4 w-1/3 animate-pulse rounded bg-black/[0.06]" />
        <div className="mt-4 h-1.5 w-full animate-pulse rounded-full bg-black/[0.06]" />
      </div>
    );
  }

  // ---- Fetch error ----
  if (fetchError) {
    return (
      <div className="rounded-lg border border-danger/20 bg-danger/5 p-8">
        <p className="text-sm text-danger">{fetchError}</p>
      </div>
    );
  }

  const d = data!;

  // ---- Succeeded ----
  if (d.status === 'succeeded') {
    return (
      <div className="rounded-lg border border-black/5 bg-bg-card p-8 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-xs text-green-700">
            ✓
          </span>
          <span className="text-sm font-medium text-ink">Report ready</span>
        </div>
        {d.subjectAddress && (
          <p className="mt-1 text-lg font-semibold text-ink">{d.subjectAddress}</p>
        )}
        <div className="mt-6">
          <a
            href={`/reports/${id}/pdf`}
            className="inline-flex items-center rounded-md bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent/90 transition"
          >
            Download PDF
          </a>
        </div>
      </div>
    );
  }

  // ---- Failed ----
  if (d.status === 'failed') {
    return (
      <div className="rounded-lg border border-danger/20 bg-danger/5 p-8 shadow-sm">
        <p className="text-sm font-medium text-danger mb-1">Report generation failed</p>
        {d.errorMessage && <p className="text-sm text-ink-muted">{d.errorMessage}</p>}
        <div className="mt-6">
          <Link
            href={'/reports/new' as Route}
            className="text-sm font-medium text-accent hover:underline"
          >
            Start a new report
          </Link>
        </div>
      </div>
    );
  }

  // ---- Queued / Running ----
  const isQueued = d.status === 'queued';
  // Monotonic progress: fraction of distinct nodes completed (matches the ticks).
  // Derived from `seen` rather than the API's index-based percentage, which bounces
  // as parallel fan-out nodes finish out of order.
  const pct = isQueued ? 0 : Math.round((seen.size / NODE_ORDER.length) * 100);
  return (
    <div className="rounded-lg border border-black/5 bg-bg-card p-8 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-medium text-ink">
          {isQueued ? 'Queued — starting soon…' : labelForNode(d.currentNode)}
        </span>
        <span className="font-mono text-xs text-ink-muted">{pct}%</span>
      </div>
      <ProgressBar pct={pct} />
      <div className="mt-6">
        <Stepper seen={seen} currentNode={isQueued ? null : d.currentNode} />
      </div>
      <p className="mt-6 text-xs text-ink-muted">
        This usually takes 3–5 minutes. You can leave this page and come back — the report will
        still be here when done.
      </p>
    </div>
  );
}
