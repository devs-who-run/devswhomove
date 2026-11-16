export function conferenceLink(value?: string | null): string | null {
  if (
    !value ||
    value.length > 2048 ||
    !/^https:\/\/[^/?#]+/i.test(value) ||
    /^https:\/\/[^/?#]*@/i.test(value) ||
    /[\s\\\u0000-\u001f\u007f]/.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password
      ? value
      : null;
  } catch {
    return null;
  }
}
