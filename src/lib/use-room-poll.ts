"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicRoom } from "./types";

export function useRoomPoll(code: string | null, intervalMs = 700) {
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const missCount = useRef(0);
  const stopped = useRef(false);

  const refresh = useCallback(async () => {
    if (!code || stopped.current) return;
    try {
      const res = await fetch(`/api/rooms/${code}`, { cache: "no-store" });
      if (res.status === 404) {
        missCount.current += 1;
        // Soft-retry a few times (storage lag), then stop the loop
        if (missCount.current >= 6) {
          stopped.current = true;
          if (alive.current) {
            setError("Комната не найдена");
            setLoading(false);
          }
        }
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "Комната не найдена");
      }
      const data = (await res.json()) as PublicRoom;
      missCount.current = 0;
      if (alive.current) {
        setRoom(data);
        setError(null);
        setLoading(false);
      }
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e.message : "Ошибка загрузки");
        setLoading(false);
      }
    }
  }, [code]);

  useEffect(() => {
    alive.current = true;
    missCount.current = 0;
    stopped.current = false;
    if (!code) return;
    void refresh();
    const id = window.setInterval(() => {
      if (!stopped.current) void refresh();
    }, intervalMs);
    return () => {
      alive.current = false;
      window.clearInterval(id);
    };
  }, [code, intervalMs, refresh]);

  return { room, error, loading, refresh };
}
