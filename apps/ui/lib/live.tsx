"use client";

/**
 * One EventSource per tab on GET /api/events, shared through context.
 *
 * The server sends `ready` on every (re)connect and `change` with the id of a
 * session that was written. Neither carries data: subscribers refetch. Changes
 * made while disconnected are not replayed, so `ready` is delivered to every
 * subscriber as a change too, which makes a reconnect refetch everything on
 * screen.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { LiveChange } from "@postrun/core/server/api";
import { DEMO } from "@/lib/api";

export type LiveStatus = "connecting" | "live" | "offline" | "demo";

/** session_id is undefined for a reconnect, which means "anything may have changed". */
type Listener = (sessionId: string | undefined) => void;

interface LiveContext {
  status: LiveStatus;
  subscribe(fn: Listener): () => void;
}

const Ctx = createContext<LiveContext>({ status: "connecting", subscribe: () => () => undefined });

/** EventSource retries on its own; after this long without a connection the pill says offline. */
const OFFLINE_AFTER_MS = 4000;
/** Wait before replacing an EventSource the browser closed for good. */
const RETRY_CLOSED_MS = 3000;

export function LiveProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    // The public demo is static: there is no server to stream from.
    if (DEMO) {
      setStatus("demo");
      return;
    }
    let es: EventSource | undefined;
    let offlineTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const emit = (id: string | undefined) => {
      for (const fn of listeners.current) fn(id);
    };
    // Started once when the connection drops and not restarted by each retry
    // (EventSource fires onerror every couple of seconds while it retries).
    const armOffline = () => {
      if (offlineTimer !== undefined) return;
      offlineTimer = setTimeout(() => setStatus("offline"), OFFLINE_AFTER_MS);
    };
    const disarmOffline = () => {
      clearTimeout(offlineTimer);
      offlineTimer = undefined;
    };

    const connect = () => {
      const source = new EventSource("/api/events");
      es = source;
      source.addEventListener("ready", () => {
        disarmOffline();
        setStatus("live");
        emit(undefined);
      });
      source.addEventListener("change", (ev) => {
        try {
          emit((JSON.parse((ev as MessageEvent<string>).data) as LiveChange).session_id);
        } catch {
          // A malformed frame is ignored; the next change or reconnect refetches.
        }
      });
      source.onerror = () => {
        setStatus((s) => (s === "offline" ? s : "connecting"));
        armOffline();
        // EventSource retries network errors itself, but gives up for good on an
        // HTTP error such as the 503 connection cap. Start a fresh one then.
        if (source.readyState === EventSource.CLOSED && retryTimer === undefined) {
          retryTimer = setTimeout(() => {
            retryTimer = undefined;
            connect();
          }, RETRY_CLOSED_MS);
        }
      };
    };

    armOffline();
    connect();
    return () => {
      disarmOffline();
      clearTimeout(retryTimer);
      es?.close();
    };
  }, []);

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  return <Ctx.Provider value={{ status, subscribe }}>{children}</Ctx.Provider>;
}

export function useLiveStatus(): LiveStatus {
  return useContext(Ctx).status;
}

/**
 * A counter that goes up whenever the watched session changes (or any session,
 * when sessionId is omitted), and on every reconnect. Put it in a fetch
 * effect's dependency list to refetch live.
 */
export function useLiveVersion(sessionId?: string): number {
  const { subscribe } = useContext(Ctx);
  const [version, setVersion] = useState(0);
  useEffect(
    () =>
      subscribe((id) => {
        if (id === undefined || sessionId === undefined || id === sessionId) setVersion((v) => v + 1);
      }),
    [subscribe, sessionId],
  );
  return version;
}
