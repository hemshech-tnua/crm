// Public links. Hash routes keep tokens out of server logs and referrers (the part after # is never sent).
export function appBase(): string {
  return `${window.location.origin}${window.location.pathname}`;
}
export const registerUrl = (eventCode: string, ref?: string | null) =>
  `${appBase()}#/r/${eventCode}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
export const allEventsUrl = (ref?: string | null) => `${appBase()}#/${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
export const checkinUrl = (checkinCode: string) => `${appBase()}#/c/${checkinCode}`;
export const feedbackUrl = (eventCode: string) => `${appBase()}#/f/${eventCode}`;
export const manageUrl = (token: string) => `${appBase()}#/m/${token}`;
export const proposeUrl = () => `${appBase()}#/join`;
/** The "join the association" page. Generic: the phone that checked in is recognised there, nothing personal in the link. */
export const memberUrl = () => `${appBase()}#/member`;
