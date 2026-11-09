import { useMemo } from 'react';
import { useSites, useSpeakers } from '@/lib/data';
import { feedbackUrl, memberUrl, registerUrl } from '@/lib/links';
import type { TemplateContext } from '@/lib/templates';
import type { EventRow, Site, Speaker } from '@/lib/types';

export type EventPeople = {
  speaker: Speaker | null;
  instructor: Speaker | null;
  site: Site | null;
  /** The place as participants should read it: the event's location, else the site. */
  place: string | null;
  /** Placeholders for WhatsApp templates (lib/templates). */
  ctx: TemplateContext;
};

/** Speaker, instructor, site and the message-template context of an event. */
export function useEventPeople(e: EventRow | undefined): EventPeople {
  const speakers = useSpeakers();
  const sites = useSites();
  return useMemo(() => {
    const speaker = e?.speaker_id ? speakers.data?.find((s) => s.id === e.speaker_id) ?? null : null;
    const instructor = e?.instructor_id ? speakers.data?.find((s) => s.id === e.instructor_id) ?? null : null;
    const site = e ? sites.data?.find((s) => s.id === e.site_id) ?? null : null;
    const place = e?.location?.trim() || site?.address || site?.name || null;
    const ctx: TemplateContext = e
      ? {
          eventTitle: e.title,
          startsAt: e.starts_at,
          location: place,
          activity: e.activity_name,
          speaker: speaker?.full_name ?? null,
          topic: e.lecture_topic,
          registerLink: registerUrl(e.public_code),
          feedbackLink: feedbackUrl(e.public_code),
          joinLink: memberUrl(),
        }
      : {};
    return { speaker, instructor, site, place, ctx };
  }, [e, speakers.data, sites.data]);
}

/** A data: URL (from the QR library or a canvas) as a Blob, without fetch (the CSP limits connect-src). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
