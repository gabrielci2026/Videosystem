import { RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { prisma } from "@/lib/prisma";

let roomService: RoomServiceClient | null | undefined;

function getRoomService() {
  if (roomService !== undefined) return roomService;
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) {
    roomService = null;
    return roomService;
  }
  const host = url.replace(/^ws:/, "http:").replace(/^wss:/, "https:").replace(/\/$/, "");
  roomService = new RoomServiceClient(host, apiKey, apiSecret);
  return roomService;
}

const revokeTimestamp = () => BigInt(Math.floor(Date.now() / 1000));

export async function revokeLiveKitParticipant(roomName: string, identity: string) {
  const service = getRoomService();
  if (!service) return;
  try {
    await service.removeParticipant(roomName, identity, { revokeTokenTs: revokeTimestamp() });
  } catch (error: any) {
    // The participant may already have left. Keep the database revocation successful.
    if (!String(error?.message ?? error).toLowerCase().includes("not found")) {
      console.error("LiveKit participant revocation failed", { roomName, identity, error });
    }
  }
}

export async function revokeLiveKitRoom(roomName: string) {
  const service = getRoomService();
  if (!service) return;
  try {
    const participants = await service.listParticipants(roomName);
    await Promise.all(participants.map((participant) => revokeLiveKitParticipant(roomName, participant.identity)));
  } catch (error: any) {
    if (!String(error?.message ?? error).toLowerCase().includes("not found")) {
      console.error("LiveKit room revocation failed", { roomName, error });
    }
  }
}

export async function revokeLiveKitUserAccess(userId: string) {
  const [memberships, ownedRooms, meetingInvites, organizedMeetings] = await Promise.all([
    prisma.callRoomMember.findMany({ where: { userId }, select: { room: { select: { roomName: true } } } }),
    prisma.callRoom.findMany({ where: { ownerId: userId }, select: { roomName: true } }),
    prisma.meetingInvite.findMany({ where: { userId }, select: { meeting: { select: { roomName: true } } } }),
    prisma.meeting.findMany({ where: { organizerId: userId }, select: { roomName: true } }),
  ]);
  const roomNames = new Set([
    ...memberships.map((item) => item.room.roomName),
    ...ownedRooms.map((item) => item.roomName),
    ...meetingInvites.map((item) => item.meeting.roomName),
    ...organizedMeetings.map((item) => item.roomName),
  ]);
  await Promise.all([...roomNames].map((roomName) => revokeLiveKitParticipant(roomName, userId)));
}

export async function setLiveKitParticipantMuted(roomName: string, identity: string, muted: boolean) {
  const service = getRoomService();
  if (!service) return false;
  try {
    const participant = await service.getParticipant(roomName, identity);
    const microphone = participant.tracks.find((track) => track.source === TrackSource.MICROPHONE && track.sid);
    if (!microphone?.sid) return false;
    await service.mutePublishedTrack(roomName, identity, microphone.sid, muted);
    return true;
  } catch (error: any) {
    if (!String(error?.message ?? error).toLowerCase().includes("not found")) {
      console.error("LiveKit microphone moderation failed", { roomName, identity, error });
    }
    return false;
  }
}


export async function isLiveKitParticipantConnected(roomName: string, identity: string) {
  const service = getRoomService();
  if (!service) return false;
  try {
    const participants = await service.listParticipants(roomName);
    return participants.some((participant) => participant.identity === identity);
  } catch (error: any) {
    if (!String(error?.message ?? error).toLowerCase().includes("not found")) {
      console.error("LiveKit participant lookup failed", { roomName, identity, error });
    }
    return false;
  }
}
