const defaultAccessWindowHours = 24;
const maxAccessWindowHours = 168;

export type MeetingAccessState = "NOT_STARTED" | "OPEN" | "ENDED";

export function getMeetingAccessWindowHours() {
  const configured = Number(process.env.MEETING_ACCESS_WINDOW_HOURS ?? defaultAccessWindowHours);
  return Number.isFinite(configured) && configured > 0 && configured <= maxAccessWindowHours ? configured : defaultAccessWindowHours;
}

export function getMeetingAccessEnd(scheduledAt: Date) {
  return new Date(scheduledAt.getTime() + getMeetingAccessWindowHours() * 60 * 60 * 1000);
}

export function getMeetingAccessState(scheduledAt: Date, now = new Date()): MeetingAccessState {
  if (scheduledAt.getTime() > now.getTime()) return "NOT_STARTED";
  if (getMeetingAccessEnd(scheduledAt).getTime() <= now.getTime()) return "ENDED";
  return "OPEN";
}
