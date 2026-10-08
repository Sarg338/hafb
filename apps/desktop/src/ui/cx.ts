/** Join class names, skipping empty values (CSS Module lookups are `string | undefined`). */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter((n): n is string => typeof n === 'string' && n !== '').join(' ');
}
