import en, { type Dictionary } from "./dictionaries/en";
import zh from "./dictionaries/zh";

export const locales = ["en", "zh"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const dictionaries: Record<Locale, Dictionary> = { en, zh };

export const LOCALE_COOKIE = "locale";

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}
