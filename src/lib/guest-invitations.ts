import { getAppUrl } from "@/lib/app-url";

const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;

export function guestInvitationExpiry(scheduledAt?: Date) {
  const defaultExpiry = Date.now() + invitationLifetimeMs;
  const meetingExpiry = scheduledAt ? scheduledAt.getTime() + 24 * 60 * 60 * 1000 : 0;
  return new Date(Math.max(defaultExpiry, meetingExpiry));
}

export function guestInvitationLink(token: string) {
  // Keep the bearer token out of proxy logs, referrers and the URL sent to the server.
  return `${getAppUrl()}/#invite=${encodeURIComponent(token)}`;
}

export function normalizeGuestEmails(emails: string[]) {
  return [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
}
