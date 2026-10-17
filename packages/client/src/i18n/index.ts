import { storage } from '../storage';
import { en } from './en';
import { tr, type MessageKey } from './tr';

export type Lang = 'tr' | 'en';
export type { MessageKey };

const DICTS: Record<Lang, Record<MessageKey, string>> = { tr, en };
const listeners = new Set<() => void>();

function detectLang(): Lang {
  const saved = storage.get('lang');
  if (saved === 'tr' || saved === 'en') return saved;
  return navigator.language.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

let current: Lang = detectLang();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  storage.set('lang', lang);
  document.documentElement.lang = lang;
  for (const fn of listeners) fn();
}

/** Dil değişince yeniden çalışacak bir güncelleyici kaydeder (hemen de çalıştırır). */
export function onLangChange(fn: () => void): void {
  listeners.add(fn);
  fn();
}

/** Çeviri; `{ad}` yer tutucuları `params` ile doldurulur. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let text = DICTS[current][key];
  if (params) for (const [k, v] of Object.entries(params)) text = text.replace(`{${k}}`, String(v));
  return text;
}

document.documentElement.lang = current;
