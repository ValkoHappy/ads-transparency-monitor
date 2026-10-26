export interface RuntimeEnv {
  databaseUrl: string;
  authSecret?: string;
  adminEmail?: string;
  adminPassword?: string;
  workerPollIntervalMs?: number;
  workerConcurrency?: number;
}

export function readRuntimeEnv(source: NodeJS.ProcessEnv = process.env): RuntimeEnv {
  const databaseUrl = required(source.DATABASE_URL, "DATABASE_URL");
  const workerPollIntervalMs = optionalPositiveInt(source.WORKER_POLL_INTERVAL_MS, "WORKER_POLL_INTERVAL_MS");
  const workerConcurrency = optionalPositiveInt(source.WORKER_CONCURRENCY, "WORKER_CONCURRENCY");

  return {
    databaseUrl,
    authSecret: source.AUTH_SECRET,
    adminEmail: source.ADMIN_EMAIL,
    adminPassword: source.ADMIN_PASSWORD,
    workerPollIntervalMs,
    workerConcurrency
  };
}

export function validateWebEnv(source: NodeJS.ProcessEnv = process.env) {
  const env = readRuntimeEnv(source);
  if (source.NODE_ENV === "production" && source.ALLOW_INSECURE_TEST_SECRETS !== "true") {
    required(source.AUTH_SECRET, "AUTH_SECRET");
    required(source.ADMIN_EMAIL, "ADMIN_EMAIL");
    required(source.ADMIN_PASSWORD, "ADMIN_PASSWORD");
    if (source.AUTH_COOKIE_SECURE !== "true" && source.AUTH_COOKIE_SECURE !== "false") {
      throw new Error("AUTH_COOKIE_SECURE must be explicitly set in production.");
    }
    if (isWeakSecret(source.AUTH_SECRET) || isWeakPassword(source.ADMIN_PASSWORD)) {
      throw new Error("Production secrets must be changed from defaults.");
    }
  }
  return env;
}

export function validateWorkerEnv(source: NodeJS.ProcessEnv = process.env) {
  return readRuntimeEnv(source);
}

function required(value: string | undefined, name: string) {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value;
}

function optionalPositiveInt(value: string | undefined, name: string) {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function isWeakSecret(value: string | undefined) {
  if (!value) return true;
  return value.length < 32 || [
    "change-me-in-production",
    "replace-with-a-long-random-secret",
    "generate-a-64-char-random-secret",
    "local-dev-session-secret",
    "test-secret"
  ].includes(value);
}

function isWeakPassword(value: string | undefined) {
  if (!value) return true;
  return value.length < 16 || [
    "change-me",
    "Admin@2026!",
    "generate-a-long-unique-password"
  ].includes(value);
}
