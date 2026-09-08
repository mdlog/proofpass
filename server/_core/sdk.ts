import axios, { type AxiosInstance } from "axios";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import { AXIOS_TIMEOUT_MS, COOKIE_NAME, ONE_YEAR_MS, decodeOAuthState } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import type { users } from "../../drizzle/schema";
import { getUserByOpenId, upsertUser } from "../db";
import { ENV } from "./env";

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const EXCHANGE_TOKEN_PATH = "/webdev.v1.WebDevAuthPublicService/ExchangeToken";
const GET_USER_INFO_PATH = "/webdev.v1.WebDevAuthPublicService/GetUserInfo";
const GET_USER_INFO_WITH_JWT_PATH = "/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt";

export type TokenResponse = { accessToken: string; [key: string]: unknown };

export type UserInfo = {
  openId?: string;
  name?: string | null;
  email?: string | null;
  platform?: string | null;
  platforms?: unknown;
  loginMethod?: string | null;
  taskUid?: string | null;
};

export type SessionPayload = { openId: string; appId: string; name: string };

/** A scheduled-task caller has no database row, so it carries a synthetic one. */
export type SessionUser = typeof users.$inferSelect & { taskUid?: string; isCron?: boolean };

class OAuthService {
  constructor(private readonly client: AxiosInstance) {
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error("[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable.");
    }
  }

  decodeState(state: string) {
    return decodeOAuthState(state).redirectUri;
  }

  async getTokenByCode(code: string, state: string): Promise<TokenResponse> {
    const { data } = await this.client.post<TokenResponse>(EXCHANGE_TOKEN_PATH, {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state),
    });
    return data;
  }

  async getUserInfoByToken(token: { accessToken: string }): Promise<UserInfo> {
    const { data } = await this.client.post<UserInfo>(GET_USER_INFO_PATH, { accessToken: token.accessToken });
    return data;
  }
}

const createOAuthHttpClient = () => axios.create({ baseURL: ENV.oAuthServerUrl, timeout: AXIOS_TIMEOUT_MS });

const CRON_OPEN_ID_PREFIX = "cron_";

function buildCronUser(userInfo: UserInfo): SessionUser {
  const now = new Date();
  return {
    id: -1,
    openId: userInfo.openId ?? "",
    name: userInfo.name || "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    taskUid: userInfo.taskUid ?? undefined,
    isCron: true,
  };
}

export class SDKServer {
  private readonly oauthService: OAuthService;

  constructor(private readonly client: AxiosInstance = createOAuthHttpClient()) {
    this.oauthService = new OAuthService(this.client);
  }

  private deriveLoginMethod(platforms: unknown, fallback?: string | null) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(platforms.filter((p): p is string => typeof p === "string"));
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE")) return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }

  async exchangeCodeForToken(code: string, state: string) {
    return this.oauthService.getTokenByCode(code, state);
  }

  async getUserInfo(accessToken: string): Promise<UserInfo> {
    const data = await this.oauthService.getUserInfoByToken({ accessToken });
    const loginMethod = this.deriveLoginMethod(data?.platforms, data?.platform ?? null);
    return { ...data, platform: loginMethod, loginMethod };
  }

  async getUserInfoWithJwt(jwtToken: string): Promise<UserInfo> {
    const { data } = await this.client.post<UserInfo>(GET_USER_INFO_WITH_JWT_PATH, { jwtToken, projectId: ENV.appId });
    const loginMethod = this.deriveLoginMethod(data?.platforms, data?.platform ?? null);
    return { ...data, platform: loginMethod, loginMethod };
  }

  private parseCookies(cookieHeader?: string) {
    if (!cookieHeader) return new Map<string, string>();
    return new Map(Object.entries(parseCookieHeader(cookieHeader)));
  }

  private getSessionSecret() {
    return new TextEncoder().encode(ENV.cookieSecret);
  }

  /**
   * Sessions are self-contained HS256 JWTs. Verification is local, so a request
   * never needs a round trip to the OAuth server to be authenticated.
   */
  async createSessionToken(openId: string, options: { name?: string; expiresInMs?: number } = {}) {
    return this.signSession({ openId, appId: ENV.appId, name: options.name || "" }, options);
  }

  async signSession(payload: SessionPayload, options: { expiresInMs?: number } = {}) {
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((Date.now() + expiresInMs) / 1000);
    return new SignJWT({ openId: payload.openId, appId: payload.appId, name: payload.name })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .sign(this.getSessionSecret());
  }

  async verifySession(cookieValue?: string): Promise<SessionPayload | null> {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const { payload } = await jwtVerify(cookieValue, this.getSessionSecret(), { algorithms: ["HS256"] });
      const { openId, appId, name } = payload as Record<string, unknown>;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return { openId, appId, name };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }

  async authenticateRequest(req: Request): Promise<SessionUser> {
    const cookies = this.parseCookies(req.headers.cookie);
    let sessionToken = cookies.get(COOKIE_NAME);
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        sessionToken = authHeader.slice(7);
      }
    }

    const session = await this.verifySession(sessionToken);
    if (!session) throw ForbiddenError("Invalid session cookie");

    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
      if (!userInfo.taskUid) throw ForbiddenError("Cron session missing task_uid");
      return buildCronUser(userInfo);
    }

    const signedInAt = new Date();
    let user = await getUserByOpenId(session.openId);
    if (!user) {
      // A valid session for an unknown openId means the row was never synced;
      // the OAuth server is the only place that can fill it in.
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
        await upsertUser({
          openId: userInfo.openId!,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt,
        });
        user = await getUserByOpenId(userInfo.openId!);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) throw ForbiddenError("User not found");

    await upsertUser({ openId: user.openId, lastSignedIn: signedInAt });
    return user as SessionUser;
  }
}

export const sdk = new SDKServer();
