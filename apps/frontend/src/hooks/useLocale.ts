import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { setLocale } from '../lib/api';
import { browserLocales, resolveLocale, type Locale } from '../i18n/locale';
import type { Me } from '../models/source';

export const meQueryKey = ['me'] as const;

/**
 * The language to render in, and a way to change it (ADR 0021).
 *
 * `stored` is the reader's account setting: 'en', 'nl', or empty for "follow
 * the browser". The resolved language is what the interface actually uses.
 */
export function useLocale(me: Me | undefined): {
  locale: Locale;
  stored: string;
  setLocale: (next: string) => void;
  saving: boolean;
} {
  const queryClient = useQueryClient();
  const stored = me?.locale ?? '';

  const mutation = useMutation({
    mutationFn: (next: string) => setLocale(next),
    onMutate: async (next) => {
      // Optimistic, because the whole interface changes language on this: a
      // round trip of English before the Dutch arrives would look broken.
      await queryClient.cancelQueries({ queryKey: meQueryKey });
      const previous = queryClient.getQueryData<Me>(meQueryKey);
      queryClient.setQueryData<Me>(meQueryKey, (current) =>
        current ? { ...current, locale: next } : current,
      );
      return { previous };
    },
    onError: (_error, _next, context) => {
      if (context?.previous) queryClient.setQueryData(meQueryKey, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: meQueryKey });
    },
  });

  const locale = useMemo(() => resolveLocale(stored, browserLocales()), [stored]);

  return {
    locale,
    stored,
    setLocale: (next: string) => mutation.mutate(next),
    saving: mutation.isPending,
  };
}
