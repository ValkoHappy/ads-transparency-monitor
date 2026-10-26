"use server";

import { cookies } from "next/headers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma, validateWebEnv } from "@ad-monitor/db";
import { isSameOriginMutation } from "./request-guard";

const COOKIE_NAME = "adm_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const loginAttempts = new Map<string, { count: number; firstAttemptAt: number }>();

export async function isAuthenticated() {
  const jar = await cookies();
  return verifySessionCookie(jar.get(COOKIE_NAME)?.value);
}

export async function requireAuth() {
  if (!(await isAuthenticated())) redirect("/login");
}

export async function loginAction(formData: FormData) {
  await requireSameOriginAction();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (isLoginRateLimited(email)) {
    redirect("/login?error=1");
  }

  if (!(await verifyCredentials(email, password))) {
    recordFailedLogin(email);
    redirect("/login?error=1");
  }
  resetFailedLogin(email);

  const jar = await cookies();
  jar.set(COOKIE_NAME, createSessionCookie(email), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.AUTH_COOKIE_SECURE === "true",
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });
  redirect("/");
}

function isLoginRateLimited(email: string) {
  const key = email || "unknown";
  const record = loginAttempts.get(key);
  if (!record) return false;
  if (Date.now() - record.firstAttemptAt > LOGIN_ATTEMPT_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }
  return record.count >= LOGIN_MAX_ATTEMPTS;
}

function recordFailedLogin(email: string) {
  const key = email || "unknown";
  const now = Date.now();
  const record = loginAttempts.get(key);
  if (!record || now - record.firstAttemptAt > LOGIN_ATTEMPT_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAttemptAt: now });
    return;
  }
  record.count += 1;
}

function resetFailedLogin(email: string) {
  loginAttempts.delete(email || "unknown");
}

export async function logoutAction() {
  await requireSameOriginAction();
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  redirect("/login");
}

async function requireSameOriginAction() {
  if (!isSameOriginMutation(await headers())) {
    throw new Error("Invalid origin");
  }
}

async function verifyCredentials(email: string, password: string) {
  validateWebEnv();
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword && email === adminEmail && password === adminPassword) {
    return true;
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    return Boolean(user && await bcrypt.compare(password, user.passwordHash));
  } catch {
    return false;
  }
}

function createSessionCookie(email: string) {
  const payload = base64UrlEncode(JSON.stringify({
    sub: email,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  }));
  return `${payload}.${sign(payload)}`;
}

function verifySessionCookie(cookieValue?: string) {
  if (!cookieValue) return false;
  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
    return typeof session.exp === "number" && session.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function sign(payload: string) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sessionSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is required.");
  }
  return "dev-session";
}
