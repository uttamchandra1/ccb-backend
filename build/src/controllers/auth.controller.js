"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.beginGoogleAuth = beginGoogleAuth;
exports.googleOAuthCallback = googleOAuthCallback;
const googleapis_1 = require("googleapis");
const supabase_1 = __importStar(require("../app/supabase"));
function getOAuthClient() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    return new googleapis_1.google.auth.OAuth2(clientId, clientSecret, redirectUri);
}
function beginGoogleAuth(req, res) {
    const oauth2Client = getOAuthClient();
    const isMobile = String(req.query.mobile || "") === "true";
    // Default deep link for the Expo app. Can be overridden by passing ?redirect=...
    const mobileRedirect = req.query.redirect || "frontapp://auth/success";
    // Carry context via OAuth state so the callback knows to deep-link back to the app
    const statePayload = Buffer.from(JSON.stringify({ mobile: isMobile, redirect: mobileRedirect }), "utf8").toString("base64url");
    const url = oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: true,
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
async function googleOAuthCallback(req, res) {
    var _a, _b, _c, _d, _e;
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
        const { data: signInData, error: signInError } = await supabase_1.default.auth.signInWithIdToken({
            provider: "google",
            token: tokens.id_token,
        });
        if (signInError || !signInData.session) {
            return res.status(500).json({
                error: (signInError === null || signInError === void 0 ? void 0 : signInError.message) || "Failed to create Supabase session",
            });
        }
        const userId = signInData.session.user.id;
        if (!supabase_1.supabaseAdmin) {
            return res.status(500).json({
                error: "Server not configured with SUPABASE_SERVICE_ROLE_KEY",
            });
        }
        {
            const upsertData = {
                user_id: userId,
                access_token: (_a = tokens.access_token) !== null && _a !== void 0 ? _a : null,
                scope: (_b = tokens.scope) !== null && _b !== void 0 ? _b : null,
                token_type: (_c = tokens.token_type) !== null && _c !== void 0 ? _c : null,
                expiry_date: (_d = tokens.expiry_date) !== null && _d !== void 0 ? _d : null,
                id_token: (_e = tokens.id_token) !== null && _e !== void 0 ? _e : null,
            };
            // Only update refresh_token if Google actually returned one, to avoid erasing stored token
            if (tokens.refresh_token) {
                upsertData.refresh_token = tokens.refresh_token;
            }
            await supabase_1.supabaseAdmin.from("user_google_tokens").upsert(upsertData, {
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
        if (typeof req.query.state === "string" && req.query.state.length > 0) {
            try {
                const decoded = JSON.parse(Buffer.from(req.query.state, "base64url").toString("utf8"));
                isMobileApp = Boolean(decoded === null || decoded === void 0 ? void 0 : decoded.mobile);
                if (typeof (decoded === null || decoded === void 0 ? void 0 : decoded.redirect) === "string" && decoded.redirect) {
                    mobileRedirect = decoded.redirect;
                }
            }
            catch (_) {
                // ignore malformed state
            }
        }
        if (isMobileApp) {
            // Redirect to mobile app with success data
            const userData = {
                id: userId,
                email: signInData.session.user.email,
                name: signInData.session.user.user_metadata.full_name ||
                    signInData.session.user.email,
                picture: signInData.session.user.user_metadata.avatar_url,
            };
            const redirectUrl = `${mobileRedirect}?user=${encodeURIComponent(JSON.stringify(userData))}&token=${signInData.session.access_token}`;
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
                name: signInData.session.user.user_metadata.full_name ||
                    signInData.session.user.email,
                picture: signInData.session.user.user_metadata.avatar_url,
            },
            google: {
                hasRefreshToken: Boolean(tokens.refresh_token),
                scope: tokens.scope,
            },
        });
    }
    catch (error) {
        res.status(500).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "OAuth callback failed" });
    }
}
//# sourceMappingURL=auth.controller.js.map