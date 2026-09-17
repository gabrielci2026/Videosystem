import nodemailer, { type SendMailOptions, type Transporter } from "nodemailer";
import { after } from "next/server";
import { getAppUrl } from "@/lib/app-url";

// Configuración del transporte de email usando Mailpit en local
let transporter: Transporter | null = null;

function readTimeout(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const connectionTimeout = readTimeout("SMTP_CONNECTION_TIMEOUT_MS", 4_000);
const socketTimeout = readTimeout("SMTP_SOCKET_TIMEOUT_MS", 8_000);
const operationTimeout = readTimeout("SMTP_OPERATION_TIMEOUT_MS", 5_000);

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function safeHeader(value: string) {
  return value.replace(/[\r\n]/g, " ").trim();
}

function initializeTransporter() {
  if (!transporter) {
    const isProduction = process.env.NODE_ENV === "production";
    const secure = process.env.SMTP_SECURE === "true";
    const requireTls = isProduction || process.env.SMTP_REQUIRE_TLS === "true";
    if (isProduction && !secure && process.env.SMTP_REQUIRE_TLS !== "true") {
      throw new Error("SMTP TLS es obligatorio en produccion");
    }
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "localhost",
      port: parseInt(process.env.SMTP_PORT || "1025"),
      secure,
      requireTLS: requireTls,
      tls: requireTls ? { minVersion: "TLSv1.2" } : undefined,
      auth: process.env.SMTP_USER && process.env.SMTP_HOST !== "localhost"
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        : undefined,
      connectionTimeout,
      greetingTimeout: connectionTimeout,
      socketTimeout,
    });
  }

  return transporter;
}

async function sendMail(options: SendMailOptions) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`SMTP_TIMEOUT_${operationTimeout}MS`)), operationTimeout);
    });
    return await Promise.race([initializeTransporter().sendMail(options), timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function sendEmailAfterResponse(label: string, delivery: () => Promise<boolean>) {
  after(async () => {
    const sent = await delivery();
    if (!sent) console.error(`No se pudo completar el email pendiente: ${label}`);
  });
}

export async function sendOTPEmail(
  email: string,
  displayName: string,
  otp: string
): Promise<boolean> {
  try {
    const info = await sendMail({
      from: process.env.SMTP_FROM || '"VideoSystem" <noreply@videosystem.local>',
      to: email,
      subject: "Tu código de verificación VideoSystem",
      text: `Hola ${displayName},\n\nTu código de verificación para iniciar sesión en VideoSystem es: ${otp}\n\nEste código expira en 10 minutos. Si no intentaste iniciar sesión, ignora este mensaje.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Código de Verificación VideoSystem</h2>
          <p>Hola ${escapeHtml(displayName)},</p>
          <p>Alguien intentó acceder a tu cuenta. Si fuiste tú, usa el siguiente código para completar tu inicio de sesión:</p>
          <div style="background-color: #f0f0f0; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
            <h1 style="letter-spacing: 4px; color: #333; margin: 0;">${otp}</h1>
          </div>
          <p style="color: #666; font-size: 14px;">Este código expira en 10 minutos.</p>
          <p style="color: #666; font-size: 14px;">Si no intentaste iniciar sesión, ignora este mensaje e informa a nuestro equipo de seguridad.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">VideoSystem - Sistema de Videollamadas Seguro</p>
        </div>
      `,
    });

    console.log("Email enviado:", info.response);
    return true;
  } catch (error) {
    console.error("Error enviando email:", error);
    return false;
  }
}

export async function sendWelcomeEmail(email: string, displayName: string, verificationLink?: string): Promise<boolean> {
  try {
    await sendMail({
      from: process.env.SMTP_FROM || '"VideoSystem" <noreply@videosystem.local>',
      to: email,
      subject: "¡Bienvenido a VideoSystem!",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>¡Bienvenido a VideoSystem!</h2>
          <p>Hola ${escapeHtml(displayName)},</p>
          <p>Tu cuenta fue creada. Confirma tu email y espera la aprobación de un administrador antes de iniciar sesión.</p>
          <div style="background-color: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2196F3;">
            <p style="margin: 0; color: #1976D2;"><strong>Seguridad:</strong> Por tu seguridad, cada inicio de sesión requerirá un código de verificación que recibirás por email.</p>
          </div>
          <p><a href="${escapeHtml(verificationLink || getAppUrl())}" style="background-color: #2196F3; color: white; padding: 12px 30px; text-decoration: none; border-radius: 4px; display: inline-block;">Confirmar email</a></p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">VideoSystem - Sistema de Videollamadas Seguro</p>
        </div>
      `,
    });

    return true;
  } catch (error) {
    console.error("Error enviando email de bienvenida:", error);
    return false;
  }
}

export async function sendMeetingInviteEmail(
  email: string,
  displayName: string,
  organizerName: string,
  title: string,
  scheduledAt: Date,
  roomName: string,
): Promise<boolean> {
  try {
    const appUrl = getAppUrl();
    await sendMail({
      from: process.env.SMTP_FROM || '"VideoSystem" <noreply@videosystem.local>',
      to: email,
      subject: `Invitación a reunión: ${safeHeader(title)}`,
      html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>${escapeHtml(title)}</h2>
        <p>Hola ${escapeHtml(displayName)}, ${escapeHtml(organizerName)} te invitó a una reunión.</p>
        <p>Fecha: ${scheduledAt.toLocaleString("es-AR")}</p>
        <p><a href="${escapeHtml(appUrl)}/?room=${encodeURIComponent(roomName)}">Entrar a la reunión</a></p>
        <p>Al abrir el enlace deberás iniciar sesión y verificar tu email normalmente.</p>
      </div>`,
    });
    return true;
  } catch (error) {
    console.error("Error enviando invitación de reunión:", error);
    return false;
  }
}

export async function sendGuestInviteEmail(
  email: string,
  organizerName: string,
  title: string,
  scheduledAt: Date | undefined,
  invitationLink: string,
  expiresAt: Date,
): Promise<boolean> {
  try {
    await sendMail({
      from: process.env.SMTP_FROM || '"VideoSystem" <noreply@videosystem.local>',
      to: email,
      subject: `Invitación de invitado: ${safeHeader(title)}`,
      html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(organizerName)} te invitó a una videollamada de VideoSystem.</p>
        ${scheduledAt ? `<p>Fecha: ${scheduledAt.toLocaleString("es-AR")}</p>` : ""}
        <p><a href="${escapeHtml(invitationLink)}">Registrarme como invitado</a></p>
        <p>Deberás confirmar tu email, esperar la aprobación de un administrador y completar la verificación en dos pasos.</p>
        <p>Esta invitación es personal para ${escapeHtml(email)} y vence el ${expiresAt.toLocaleString("es-AR")}.</p>
      </div>`,
    });
    return true;
  } catch (error) {
    console.error("Error enviando invitación externa:", error);
    return false;
  }
}

export async function sendGuestApprovedEmail(email: string, displayName: string, roomName: string): Promise<boolean> {
  try {
    await sendMail({
      from: process.env.SMTP_FROM || '"VideoSystem" <noreply@videosystem.local>',
      to: email,
      subject: "Tu acceso de invitado fue aprobado",
      html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Acceso aprobado</h2>
        <p>Hola ${escapeHtml(displayName)}, tu cuenta de invitado fue aprobada.</p>
        <p><a href="${escapeHtml(getAppUrl())}/?room=${encodeURIComponent(roomName)}">Ingresar a la llamada</a></p>
        <p>Al iniciar sesión recibirás el código de verificación de segundo factor por email.</p>
      </div>`,
    });
    return true;
  } catch (error) {
    console.error("Error enviando aprobación de invitado:", error);
    return false;
  }
}

export async function sendPasswordResetEmail(email: string, displayName: string, resetLink: string): Promise<boolean> {
  try {
    await sendMail({
      from: process.env.SMTP_FROM || '"VideoSystem" <noreply@videosystem.local>',
      to: email,
      subject: "Restablecer contraseña de VideoSystem",
      html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Restablecer contraseña</h2><p>Hola ${escapeHtml(displayName)}, recibimos una solicitud para cambiar tu contraseña.</p>
        <p><a href="${escapeHtml(resetLink)}">Crear una nueva contraseña</a></p>
        <p>El enlace caduca en 30 minutos. Si no lo solicitaste, ignora este correo.</p>
      </div>`,
    });
    return true;
  } catch (error) {
    console.error("Error enviando recuperación de contraseña:", error);
    return false;
  }
}
