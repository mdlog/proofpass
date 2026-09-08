import { TRPCError } from "@trpc/server";
import { ENV } from "./env";

const TITLE_MAX_LENGTH = 1200;
const CONTENT_MAX_LENGTH = 20000;

export type NotifyOwnerInput = { title: string; content: string };

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const buildEndpointUrl = (baseUrl: string) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL("webdevtoken.v1.WebDevService/SendNotification", normalizedBase).toString();
};

function validatePayload(input: NotifyOwnerInput) {
  if (!isNonEmptyString(input.title)) throw new TRPCError({ code: "BAD_REQUEST", message: "Notification title is required." });
  if (!isNonEmptyString(input.content)) throw new TRPCError({ code: "BAD_REQUEST", message: "Notification content is required." });
  const title = input.title.trim();
  const content = input.content.trim();
  if (title.length > TITLE_MAX_LENGTH) throw new TRPCError({ code: "BAD_REQUEST", message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.` });
  if (content.length > CONTENT_MAX_LENGTH) throw new TRPCError({ code: "BAD_REQUEST", message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.` });
  return { title, content };
}

/** Returns false rather than throwing when delivery fails: a dropped notification must not fail the mutation that triggered it. */
export async function notifyOwner(payload: NotifyOwnerInput): Promise<boolean> {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Notification service URL is not configured." });
  if (!ENV.forgeApiKey) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Notification service API key is not configured." });

  try {
    const response = await fetch(buildEndpointUrl(ENV.forgeApiUrl), {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1",
      },
      body: JSON.stringify({ title, content }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(`[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}
