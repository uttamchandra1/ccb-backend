import { Request, Response } from "express";
import { google } from "googleapis";
import supabase, { supabaseAdmin } from "../app/supabase";

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI!;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function beginGoogleAuth(req: Request, res: Response) {
  const oauth2Client = getOAuthClient();

  const isMobile = String(req.query.mobile || "") === "true";
  // Default deep link for the Expo app. Can be overridden by passing ?redirect=...
  const mobileRedirect =
    (req.query.redirect as string) || "frontapp://auth/success";
  const inviteCode = (req.query.inviteCode as string) || null;

  // Carry context via OAuth state so the callback knows to deep-link back to the app
  const statePayload = Buffer.from(
    JSON.stringify({
      mobile: isMobile,
      redirect: mobileRedirect,
      inviteCode: inviteCode,
    }),
    "utf8"
  ).toString("base64url");

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true as any,
    scope: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/contacts.readonly",
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
    state: statePayload,
  });
  res.redirect(url);
}

export async function googleOAuthCallback(req: Request, res: Response) {
  try {
    const code = String(req.query.code || "");
    if (!code) {
      return res.status(400).json({ error: "Missing code" });
    }

    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.id_token) {
      return res.status(400).json({ error: "No id_token returned by Google" });
    }

    const { data: signInData, error: signInError } =
      await supabase.auth.signInWithIdToken({
        provider: "google",
        token: tokens.id_token,
      });
    if (signInError || !signInData.session) {
      return res.status(500).json({
        error: signInError?.message || "Failed to create Supabase session",
      });
    }

    const userId = signInData.session.user.id;

    if (!supabaseAdmin) {
      return res.status(500).json({
        error: "Server not configured with SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    {
      const upsertData: any = {
        user_id: userId,
        access_token: tokens.access_token ?? null,
        scope: tokens.scope ?? null,
        token_type: tokens.token_type ?? null,
        expiry_date: tokens.expiry_date ?? null,
        id_token: tokens.id_token ?? null,
      };
      // Only update refresh_token if Google actually returned one, to avoid erasing stored token
      if (tokens.refresh_token) {
        upsertData.refresh_token = tokens.refresh_token;
      }
      await supabaseAdmin.from("user_google_tokens").upsert(upsertData, {
        onConflict: "user_id",
      });
    }

    const isProd = process.env.NODE_ENV === "production";
    res.cookie("sb-access-token", signInData.session.access_token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7 * 1000,
    });
    res.cookie("sb-refresh-token", signInData.session.refresh_token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30 * 1000,
    });

    // Determine client context from OAuth state
    let isMobileApp = false;
    let mobileRedirect = "frontapp://auth/success";
    let inviteCode = null as string | null;
    if (typeof req.query.state === "string" && req.query.state.length > 0) {
      try {
        const decoded = JSON.parse(
          Buffer.from(req.query.state, "base64url").toString("utf8")
        );
        isMobileApp = Boolean(decoded?.mobile);
        if (typeof decoded?.redirect === "string" && decoded.redirect) {
          mobileRedirect = decoded.redirect;
        }
        inviteCode = decoded?.inviteCode || null;
      } catch (_) {
        // ignore malformed state
      }
    }

    // Process invite code if present
    if (inviteCode) {
      try {
        const { ProfessionalInviteService } = await import(
          "../services/ProfessionalInviteService"
        );
        const inviteService = new ProfessionalInviteService();

        const result = await inviteService.processInviteCode(
          userId,
          inviteCode,
          {
            userAgent: req.headers["user-agent"],
            ipAddress: req.ip,
            platform: isMobileApp ? "mobile" : "web",
          }
        );

        if (result.success) {
          console.log(
            `Invite code ${inviteCode} processed successfully for user ${userId}`
          );
        } else {
          console.warn(
            `Failed to process invite code ${inviteCode}:`,
            result.error
          );
        }
      } catch (error) {
        console.error("Error processing invite code:", error);
      }
    }

    if (isMobileApp) {
      // Redirect to mobile app with success data
      const userData = {
        id: userId,
        email: signInData.session.user.email,
        name:
          signInData.session.user.user_metadata.full_name ||
          signInData.session.user.email,
        picture: signInData.session.user.user_metadata.avatar_url,
      };

      const redirectUrl = `${mobileRedirect}?user=${encodeURIComponent(
        JSON.stringify(userData)
      )}&token=${signInData.session.access_token}`;
      return res.redirect(encodeURI(redirectUrl));
    }

    // For web requests, return JSON

    res.json({
      auth: {
        userId,
        accessToken: signInData.session.access_token,
        refreshToken: signInData.session.refresh_token,
        expiresAt: signInData.session.expires_at,
      },
      user: {
        id: userId,
        email: signInData.session.user.email,
        name:
          signInData.session.user.user_metadata.full_name ||
          signInData.session.user.email,
        picture: signInData.session.user.user_metadata.avatar_url,
      },
      google: {
        hasRefreshToken: Boolean(tokens.refresh_token),
        scope: tokens.scope,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "OAuth callback failed" });
  }
}
