import { Router } from "express";
import {
  beginGoogleAuth,
  googleOAuthCallback,
} from "../controllers/auth.controller";
import supabase, { supabaseAdmin } from "../app/supabase";

const router = Router();

// Begin Google OAuth flow
router.get("/auth/google", beginGoogleAuth);

// OAuth callback
router.get("/auth/google/callback", googleOAuthCallback);

// Token refresh endpoint
router.post("/auth/refresh", async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({ error: "Refresh token is required" });
    }

    // Use Supabase to refresh the token
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refresh_token,
    });

    if (error) {
      console.error("Token refresh error:", error);
      return res.status(401).json({ error: error.message });
    }

    if (!data.session) {
      return res.status(401).json({ error: "Failed to refresh session" });
    }

    // Return the new tokens
    res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
      token_type: "bearer",
    });
  } catch (error: any) {
    console.error("Token refresh error:", error);
    res
      .status(500)
      .json({ error: error?.message || "Failed to refresh token" });
  }
});

export default router;
