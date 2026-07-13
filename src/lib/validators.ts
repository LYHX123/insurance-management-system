export const KENYAN_PHONE_REGEX = /^(?:\+254\d{9}|0\d{9})$/;

export function isValidKenyanPhone(value: string): boolean {
  return KENYAN_PHONE_REGEX.test(value);
}
