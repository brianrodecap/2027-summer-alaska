import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { RequestAbortedError } from '../../model/anthropicClient';
import { type AskAIConversation, AskAIError, runAskAITurn } from '../../model/askAI';
import { createLocalStorageChatStore } from '../../state/store/chatStore';
import { useLiveDays } from '../../state/useLiveDays';
import { useTripData } from '../../state/useTripData';

// Stable empties, so consumers memoized on these don't recompute while no
// conversation exists.
const NO_MESSAGES: AskAIConversation['messages'] = [];
const NO_APPLIED: readonly string[] = [];

// What's on screen while a turn runs: the question just asked, the answer streaming
// in, the lookups done so far, and the assistant's latest progress note.
export interface PendingTurn {
  question: string;
  text: string;
  lookups: string[];
  progress: string;
}

const store = createLocalStorageChatStore();

// The trip's Ask AI conversation: loaded when the trip opens, saved after every
// finished turn, cleared by New conversation. Hosted by AssistantChatProvider, so the
// panel can unmount (switching the sidebar to Map, closing the phone sheet) without
// losing a turn that's still running.
export function useAssistantChat() {
  const { slug, data, view } = useTripData();
  // Read only inside send(): the live days are built on first read.
  const live = useLiveDays();
  const [conversation, setConversation] = useState<AskAIConversation | null>(null);
  // Ids of the proposals already applied, so each stays an "Applied" chip after a
  // reload. Kept apart from the conversation (see ChatStore); the ref is the latest
  // value, since an Apply can finish while a turn is still streaming.
  const [applied, setApplied] = useState<readonly string[]>(NO_APPLIED);
  const appliedRef = useRef<readonly string[]>(NO_APPLIED);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const replaceApplied = useCallback((next: readonly string[]) => {
    appliedRef.current = next;
    setApplied(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void store.load(slug).then((loaded) => {
      if (cancelled) return;
      setConversation(loaded?.conversation ?? null);
      replaceApplied(loaded?.applied ?? NO_APPLIED);
    });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [slug, replaceApplied]);

  // Resolves true once the turn is answered and saved; false if it failed or was
  // stopped, so the caller can hand the question back for another try.
  const send = useCallback(
    async (question: string, apiKey: string, focusDate: string | null): Promise<boolean> => {
      // One turn at a time; abortRef is set for exactly as long as one runs.
      if (!data || !view || abortRef.current) return false;
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setPending({ question, text: '', lookups: [], progress: '' });
      try {
        const next = await runAskAITurn(conversation, {
          question,
          focusDate,
          data,
          tools: { data, view, byDate: live.byDate },
          apiKey,
          signal: controller.signal,
          events: {
            onText: (delta) => setPending((p) => p && { ...p, text: p.text + delta, progress: '' }),
            onProgress: (delta) => setPending((p) => p && { ...p, progress: p.progress + delta }),
            onLookup: (label) =>
              setPending((p) => p && { ...p, lookups: [...p.lookups, label], progress: '' }),
          },
        });
        setConversation(next);
        void store.save(slug, next);
        return true;
      } catch (err) {
        if (!(err instanceof RequestAbortedError)) {
          setError(err instanceof AskAIError ? err.message : 'Something went wrong asking that.');
        }
        return false;
      } finally {
        abortRef.current = null;
        setPending(null);
      }
    },
    [slug, conversation, data, view, live],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const newConversation = useCallback(() => {
    abortRef.current?.abort();
    setConversation(null);
    replaceApplied(NO_APPLIED);
    setError(null);
    void store.clear(slug);
  }, [slug, replaceApplied]);

  // `id` is the applied proposal's AskAIProposal id.
  const markApplied = useCallback(
    (id: string) => {
      if (appliedRef.current.includes(id)) return;
      const next = [...appliedRef.current, id];
      replaceApplied(next);
      void store.saveApplied(slug, next);
    },
    [slug, replaceApplied],
  );

  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({
      messages: conversation?.messages ?? NO_MESSAGES,
      applied,
      pending,
      error,
      clearError,
      send,
      stop,
      newConversation,
      markApplied,
    }),
    [conversation, applied, pending, error, clearError, send, stop, newConversation, markApplied],
  );
}

export type AssistantChat = ReturnType<typeof useAssistantChat>;
