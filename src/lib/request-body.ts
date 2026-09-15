const maxJsonBodyBytes = 64 * 1024;

export async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxJsonBodyBytes) return undefined;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > maxJsonBodyBytes) return undefined;
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
