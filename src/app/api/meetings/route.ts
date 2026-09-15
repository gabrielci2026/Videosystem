import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEmailAfterResponse, sendGuestInviteEmail, sendMeetingInviteEmail } from "@/lib/email";
import { isSameOrigin } from "@/lib/request-security";
import { getAppUrl } from "@/lib/app-url";
import { guestInvitationExpiry, guestInvitationLink, normalizeGuestEmails } from "@/lib/guest-invitations";
import { generateSecureToken, hashString } from "@/lib/security";
import { readJsonBody } from "@/lib/request-body";
import { checkRateLimit, getClientAddress } from "@/lib/rate-limit";

const input = z.object({
  title: z.string().trim().min(2).max(120),
  scheduledAt: z.string().datetime(),
  userIds: z.array(z.string().min(1)).max(50).default([]),
  guestEmails: z.array(z.string().email()).max(50).default([]),
}).refine((value) => value.userIds.length + value.guestEmails.length > 0, "Selecciona usuarios o agrega emails externos")
  .refine((value) => value.userIds.length + value.guestEmails.length <= 50, "Máximo 50 invitados");

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    if (user.role === "GUEST") return NextResponse.json({ error: "Los invitados no tienen acceso a reuniones" }, { status: 403 });
    const meetings = await prisma.meeting.findMany({
      where: { status: "SCHEDULED", OR: [{ organizerId: user.id }, { invites: { some: { userId: user.id } } }] },
      include: { organizer: { select: { displayName: true } }, invites: { include: { user: { select: { id: true, displayName: true, email: true } } } } },
      orderBy: { scheduledAt: "asc" },
    });
    return NextResponse.json(meetings);
  } catch (error) {
    console.error("Error cargando reuniones:", error);
    return NextResponse.json({ error: "No se pudieron cargar las reuniones" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
    const organizer = await getCurrentUser();
    if (!organizer || organizer.status !== "ACTIVE" || organizer.role === "GUEST") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const parsed = input.safeParse(await readJsonBody(request));
    const address = getClientAddress(request);
    const rate = await checkRateLimit(`meetings:${organizer.id}:${address}`, 20, 60 * 60 * 1000);
    if (!rate.allowed) return NextResponse.json({ error: `Demasiadas invitaciones. Espera ${rate.retryAfterSeconds} segundos.` }, { status: 429 });
    const scheduledAt = parsed.success ? new Date(parsed.data.scheduledAt) : null;
    if (!parsed.success || !scheduledAt || Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "Título, fecha futura e invitados son obligatorios" }, { status: 400 });
    }

    const invitedUsers = await prisma.user.findMany({
    where: { id: { in: parsed.data.userIds }, status: "ACTIVE", role: { not: "GUEST" }, NOT: { id: organizer.id } },
    select: { id: true, email: true, displayName: true },
    });
    if (invitedUsers.length !== new Set(parsed.data.userIds).size) {
    return NextResponse.json({ error: "Todos los invitados deben tener una cuenta activa" }, { status: 400 });
    }
    const guestEmails = normalizeGuestEmails(parsed.data.guestEmails);
    const existingAccounts = guestEmails.length ? await prisma.user.findMany({
      where: { email: { in: guestEmails } },
      select: { email: true },
    }) : [];
    if (existingAccounts.length) {
      return NextResponse.json({ error: `${existingAccounts[0].email} ya tiene cuenta. Selecciónalo desde la lista de usuarios.` }, { status: 409 });
    }

    const guestInvitations = guestEmails.map((email) => ({ email, token: generateSecureToken() }));
    const invitationExpiresAt = guestInvitationExpiry(scheduledAt);

    const meeting = await prisma.$transaction(async (transaction) => {
      const created = await transaction.meeting.create({
        data: {
          title: parsed.data.title,
          scheduledAt,
          roomName: `meeting-${randomUUID()}`,
          organizerId: organizer.id,
          invites: { create: invitedUsers.map((user) => ({ userId: user.id })) },
        },
        include: { invites: { include: { user: true } } },
      });
      if (guestInvitations.length) {
        await transaction.invitation.createMany({
          data: guestInvitations.map(({ email, token }) => ({
            email,
            tokenHash: hashString(token),
            roomName: created.roomName,
            invitedById: organizer.id,
            expiresAt: invitationExpiresAt,
          })),
        });
      }
      return created;
    });

    sendEmailAfterResponse("meeting-invites", async () => {
      const emailResults = await Promise.all([
      ...invitedUsers.map((user) => sendMeetingInviteEmail(
        user.email,
        user.displayName,
        organizer.displayName,
        meeting.title,
        meeting.scheduledAt,
        meeting.roomName,
      )),
      ...guestInvitations.map(({ email, token }) => sendGuestInviteEmail(
        email,
        organizer.displayName,
        meeting.title,
        meeting.scheduledAt,
        guestInvitationLink(token),
        invitationExpiresAt,
      )),
      ]);
      return emailResults.every(Boolean);
    });

    return NextResponse.json({
    id: meeting.id,
    title: meeting.title,
    scheduledAt: meeting.scheduledAt,
    roomName: meeting.roomName,
    link: `${getAppUrl()}/?room=${encodeURIComponent(meeting.roomName)}`,
    invitedCount: invitedUsers.length + guestInvitations.length,
    externalInvitedCount: guestInvitations.length,
    emailQueued: true,
    }, { status: 201 });
  } catch (error) {
    console.error("Error creando reunión:", error);
    return NextResponse.json({ error: "No se pudo crear la reunión. Comprueba la base de datos y vuelve a intentar." }, { status: 500 });
  }
}

