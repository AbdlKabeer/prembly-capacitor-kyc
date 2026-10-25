/** The origin of a link (scheme, host and port only), or '' when it is not an http(s) URL. */
export function originOf(link: string): string {
  const match = /^(https?):\/\/([^/?#]+)/i.exec(link);
  return match && match[1] && match[2] ? `${match[1].toLowerCase()}://${match[2].toLowerCase()}` : '';
}

/** `<hostedUrl>?session=<id>`, the same shape the web SDK builds. */
export function withSession(hostedUrl: string, sessionId: string): string {
  const [beforeHash = '', hash] = hostedUrl.split('#');
  const [path = '', query = ''] = beforeHash.split('?');
  const rest = query.split('&').filter((p) => p && !p.startsWith('session='));
  rest.push(`session=${encodeURIComponent(sessionId)}`);
  return `${path}?${rest.join('&')}${hash !== undefined ? `#${hash}` : ''}`;
}
