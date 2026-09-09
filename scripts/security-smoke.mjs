const baseUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, options);
}

function expectStatus(label, response, accepted) {
  if (!accepted.includes(response.status)) throw new Error(`${label}: se esperaba ${accepted.join("/")}, se recibió ${response.status}`);
  console.log(`OK ${label} (${response.status})`);
}

try {
  expectStatus("health", await request("/api/health"), [200]);
  expectStatus("auth/me sin sesión", await request("/api/auth/me"), [401]);
  expectStatus("users sin sesión", await request("/api/users"), [401]);
  expectStatus("messages sin sesión", await request("/api/messages"), [401]);
  expectStatus("meetings sin sesión", await request("/api/meetings"), [401]);
  expectStatus("JSON malformado", await request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{malformed",
  }), [400]);
  expectStatus("origen cruzado bloqueado", await request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ email: "test@example.com", password: "not-a-real-password" }),
  }), [403]);
  console.log("Security smoke tests passed.");
} catch (error) {
  console.error("Security smoke tests failed:", error.message);
  process.exitCode = 1;
}
