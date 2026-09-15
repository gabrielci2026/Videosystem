const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
const smokeOrigin = baseUrl;
const email = process.env.SMOKE_EMAIL ?? "admin@videosystem.local";
const password = process.env.SMOKE_PASSWORD ?? "AdminVideo2026!";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const health = await fetch(`${baseUrl}/api/health`);
  assert(health.ok, `Health failed: ${health.status}`);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: smokeOrigin },
    body: JSON.stringify({ email, password }),
  });
  const loginData = await login.json();
  assert(login.ok, `Login failed: ${login.status}`);
  assert(typeof loginData.userId === "string", "Login did not return userId");
  const smokeOtp = process.env.SMOKE_OTP;
  if (!smokeOtp) {
    console.log("Smoke test passed: health and login request; define SMOKE_OTP to verify OTP without exposing it.");
    return;
  }
  const verify = await fetch(`${baseUrl}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: smokeOrigin },
    body: JSON.stringify({ userId: loginData.userId, code: smokeOtp }),
  });
  assert(verify.ok, `OTP failed: ${verify.status}`);

  console.log("Smoke test passed: health, login and OTP verification");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
