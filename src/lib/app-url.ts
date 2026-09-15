export function getAppUrl() {
  const value = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  if (process.env.NODE_ENV === "production" && !value.startsWith("https://")) {
    throw new Error("APP_URL debe usar https:// en produccion");
  }
  return value;
}
