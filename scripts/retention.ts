import { PrismaClient } from "@prisma/client";
import { revokeLiveKitParticipant } from "@/lib/livekit-admin";

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const messages = await prisma.message.deleteMany({ where: { expiresAt: { lt: now } } });
  const callMessages = await prisma.callMessage.deleteMany({ where: { expiresAt: { lt: now } } });
  const otp = await prisma.oTPRequest.deleteMany({ where: { expiresAt: { lt: now } } });
  const sessions = await prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null, lt: now } }] } });
  const verifications = await prisma.emailVerification.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null, lt: now } }] } });
  const passwordResets = await prisma.passwordResetToken.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null, lt: now } }] } });
  const expiredGuestInvitations = await prisma.invitation.findMany({
    where: { expiresAt: { lt: now }, acceptedById: { not: null }, roomName: { not: null } },
    select: { acceptedById: true, roomName: true },
  });
  await Promise.all(expiredGuestInvitations.map((invitation) => revokeLiveKitParticipant(invitation.roomName!, invitation.acceptedById!)));
  const invitations = await prisma.invitation.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { acceptedAt: { not: null, lt: new Date(now.getTime() - 90 * 86400000) } }] } });
  const rateLimits = await prisma.rateLimitEntry.deleteMany({ where: { resetAt: { lt: now } } });
  const meetings = await prisma.meeting.deleteMany({ where: { status: "CANCELLED", scheduledAt: { lt: new Date(now.getTime() - 90 * 86400000) } } });
  console.log(`Retention complete: ${messages.count} messages, ${callMessages.count} call messages, ${otp.count} OTP requests, ${sessions.count} sessions, ${verifications.count} verifications, ${passwordResets.count} password resets, ${invitations.count} invitations, ${rateLimits.count} rate limits, ${meetings.count} meetings`);
}

main().catch((error) => {
  console.error("Retention failed:", error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
