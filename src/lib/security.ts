import crypto from "crypto";

/**
 * Valida la fortaleza de una contraseña
 * Requisitos:
 * - Mínimo 8 caracteres
 * - Al menos un número
 * - Al menos una letra mayúscula
 * - Al menos una letra minúscula
 * - Al menos un símbolo (!@#$%^&*)
 */
export function validatePasswordStrength(password: string): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push("Mínimo 8 caracteres");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("Al menos un número");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Al menos una letra mayúscula");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Al menos una letra minúscula");
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push("Al menos un símbolo (!@#$%^&*)");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Genera un código OTP alfanumérico de 8 caracteres
 */
export function generateOTP(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(crypto.randomInt(chars.length));
  }
  return code;
}

/**
 * Genera un token aleatorio seguro
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString("hex");
}

/**
 * Hash de una cadena usando SHA-256
 */
export function hashString(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}
