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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const googleapis_1 = require("googleapis");
const supabase_1 = __importStar(require("./app/supabase"));
const CardDetectionService_1 = require("./services/CardDetectionService");
const ProfessionalInviteService_1 = require("./services/ProfessionalInviteService");
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
// Basic health check
app.get("/api", (_req, res) => {
    res.json({ message: "Hello from API" });
});
// Helpers
function getOAuthClient() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    return new googleapis_1.google.auth.OAuth2(clientId, clientSecret, redirectUri);
}
// 1) Begin Google OAuth flow
app.get("/auth/google", (_req, res) => {
    const oauth2Client = getOAuthClient();
    const url = oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/gmail.readonly",
        ],
    });
    res.redirect(url);
});
// Same as above but under '/api' prefix
app.get("/api/auth/google", (_req, res) => {
    const oauth2Client = getOAuthClient();
    const url = oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/gmail.readonly",
        ],
    });
    res.redirect(url);
});
// 2) OAuth callback: exchange code for tokens, create Supabase session via id_token, store Google tokens
app.get("/auth/google/callback", async (req, res) => {
    var _a, _b, _c, _d, _e, _f;
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
        // Create a Supabase session from Google id_token
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
        // Store Google tokens server-side (requires a table `user_google_tokens` with unique user_id)
        if (!supabase_1.supabaseAdmin) {
            return res.status(500).json({
                error: "Server not configured with SUPABASE_SERVICE_ROLE_KEY",
            });
        }
        await supabase_1.supabaseAdmin.from("user_google_tokens").upsert({
            user_id: userId,
            access_token: (_a = tokens.access_token) !== null && _a !== void 0 ? _a : null,
            refresh_token: (_b = tokens.refresh_token) !== null && _b !== void 0 ? _b : null,
            scope: (_c = tokens.scope) !== null && _c !== void 0 ? _c : null,
            token_type: (_d = tokens.token_type) !== null && _d !== void 0 ? _d : null,
            expiry_date: (_e = tokens.expiry_date) !== null && _e !== void 0 ? _e : null,
            id_token: (_f = tokens.id_token) !== null && _f !== void 0 ? _f : null,
        }, { onConflict: "user_id" });
        // Optionally set Supabase auth cookies for frontend use
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
        // Return a minimal JSON payload useful for clients
        res.json({
            auth: {
                userId,
                accessToken: signInData.session.access_token,
                refreshToken: signInData.session.refresh_token,
                expiresAt: signInData.session.expires_at,
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
});
// Same as above but under '/api' prefix
app.get("/api/auth/google/callback", async (req, res) => {
    var _a, _b, _c, _d, _e, _f;
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
        // Create a Supabase session from Google id_token
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
        // Store Google tokens server-side (requires a table `user_google_tokens` with unique user_id)
        if (!supabase_1.supabaseAdmin) {
            return res.status(500).json({
                error: "Server not configured with SUPABASE_SERVICE_ROLE_KEY",
            });
        }
        await supabase_1.supabaseAdmin.from("user_google_tokens").upsert({
            user_id: userId,
            access_token: (_a = tokens.access_token) !== null && _a !== void 0 ? _a : null,
            refresh_token: (_b = tokens.refresh_token) !== null && _b !== void 0 ? _b : null,
            scope: (_c = tokens.scope) !== null && _c !== void 0 ? _c : null,
            token_type: (_d = tokens.token_type) !== null && _d !== void 0 ? _d : null,
            expiry_date: (_e = tokens.expiry_date) !== null && _e !== void 0 ? _e : null,
            id_token: (_f = tokens.id_token) !== null && _f !== void 0 ? _f : null,
        }, { onConflict: "user_id" });
        // Optionally set Supabase auth cookies for frontend use
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
        // Return a minimal JSON payload useful for clients
        res.json({
            auth: {
                userId,
                accessToken: signInData.session.access_token,
                refreshToken: signInData.session.refresh_token,
                expiresAt: signInData.session.expires_at,
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
});
// 3) Read Gmail using stored server-side Google tokens
app.get("/gmail/cards", async (req, res) => {
    var _a, _b, _c, _d, _e, _f;
    try {
        // Accept Supabase access token from Authorization header or cookie
        const authHeader = req.headers.authorization || "";
        const bearerToken = authHeader.startsWith("Bearer ")
            ? authHeader.slice(7)
            : undefined;
        const cookieToken = (_a = req.cookies) === null || _a === void 0 ? void 0 : _a["sb-access-token"];
        const supabaseAccessToken = bearerToken || cookieToken;
        if (!supabaseAccessToken) {
            return res.status(401).json({ error: "Missing Supabase access token" });
        }
        const { data: userData, error: userError } = await supabase_1.default.auth.getUser(supabaseAccessToken);
        if (userError || !userData.user) {
            return res
                .status(401)
                .json({ error: (userError === null || userError === void 0 ? void 0 : userError.message) || "Invalid Supabase token" });
        }
        const userId = userData.user.id;
        if (!supabase_1.supabaseAdmin) {
            return res.status(500).json({
                error: "Server not configured with SUPABASE_SERVICE_ROLE_KEY",
            });
        }
        const { data: tokenRow, error: tokenError } = await supabase_1.supabaseAdmin
            .from("user_google_tokens")
            .select("access_token, refresh_token, expiry_date")
            .eq("user_id", userId)
            .single();
        if (tokenError || !tokenRow) {
            return res.status(400).json({ error: "No Google tokens found for user" });
        }
        // Configure OAuth client with stored tokens (supports refresh if refresh_token exists)
        const oauth2Client = getOAuthClient();
        oauth2Client.setCredentials({
            access_token: tokenRow.access_token || undefined,
            refresh_token: tokenRow.refresh_token || undefined,
            expiry_date: tokenRow.expiry_date || undefined,
        });
        const gmail = googleapis_1.google.gmail({ version: "v1", auth: oauth2Client });
        // Fetch latest messages from Primary inbox
        const listResp = await gmail.users.messages.list({
            userId: "me",
            maxResults: 25,
            q: "category:primary newer_than:365d",
        });
        const messageIds = (listResp.data.messages || [])
            .map((m) => m.id)
            .filter(Boolean);
        const results = [];
        const cardMatchers = [
            { name: "Visa", pattern: /\bvisa\b/i },
            { name: "Mastercard", pattern: /\bmaster\s?card\b/i },
            { name: "American Express", pattern: /\bamerican\s*express\b|\bamex\b/i },
            { name: "Discover", pattern: /\bdiscover\b/i },
            { name: "RuPay", pattern: /\brupay\b/i },
            { name: "HDFC", pattern: /\bhdfc\b/i },
            { name: "ICICI", pattern: /\bicici\b/i },
            { name: "SBI", pattern: /\bsbi\b/i },
            { name: "Axis", pattern: /\baxis\b/i },
            { name: "Kotak", pattern: /\bkotak\b/i },
            { name: "Citi", pattern: /\bciti\b|\bcitibank\b/i },
            { name: "Barclays", pattern: /\bbarclays\b/i },
            { name: "Capital One", pattern: /\bcapital\s*one\b/i },
            { name: "Chase", pattern: /\bchase\b/i },
        ];
        for (const id of messageIds) {
            const msg = await gmail.users.messages.get({
                userId: "me",
                id,
                format: "metadata",
                metadataHeaders: ["subject", "from"],
            });
            const headers = ((_b = msg.data.payload) === null || _b === void 0 ? void 0 : _b.headers) || [];
            const subject = ((_d = (_c = headers.find((h) => (h.name || "").toLowerCase() === "subject")) === null || _c === void 0 ? void 0 : _c.value) !== null && _d !== void 0 ? _d : undefined);
            const from = ((_f = (_e = headers.find((h) => (h.name || "").toLowerCase() === "from")) === null || _e === void 0 ? void 0 : _e.value) !== null && _f !== void 0 ? _f : undefined);
            const textForMatch = `${subject || ""} ${from || ""}`;
            const matchedCards = cardMatchers
                .filter((c) => c.pattern.test(textForMatch))
                .map((c) => c.name);
            results.push({ id, subject, from, matchedCards });
        }
        // Aggregate distinct card names
        const distinctCards = Array.from(new Set(results.flatMap((r) => r.matchedCards))).sort();
        res.json({ userId, cards: distinctCards, samples: results.slice(0, 10) });
    }
    catch (error) {
        res.status(500).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to read Gmail" });
    }
});
// Same as above but under '/api' prefix
app.get("/api/gmail/cards", async (req, res) => {
    var _a, _b, _c, _d, _e, _f;
    try {
        // Accept Supabase access token from Authorization header or cookie
        const authHeader = req.headers.authorization || "";
        const bearerToken = authHeader.startsWith("Bearer ")
            ? authHeader.slice(7)
            : undefined;
        const cookieToken = (_a = req.cookies) === null || _a === void 0 ? void 0 : _a["sb-access-token"];
        const supabaseAccessToken = bearerToken || cookieToken;
        if (!supabaseAccessToken) {
            return res.status(401).json({ error: "Missing Supabase access token" });
        }
        const { data: userData, error: userError } = await supabase_1.default.auth.getUser(supabaseAccessToken);
        if (userError || !userData.user) {
            return res
                .status(401)
                .json({ error: (userError === null || userError === void 0 ? void 0 : userError.message) || "Invalid Supabase token" });
        }
        const userId = userData.user.id;
        if (!supabase_1.supabaseAdmin) {
            return res.status(500).json({
                error: "Server not configured with SUPABASE_SERVICE_ROLE_KEY",
            });
        }
        const { data: tokenRow, error: tokenError } = await supabase_1.supabaseAdmin
            .from("user_google_tokens")
            .select("access_token, refresh_token, expiry_date")
            .eq("user_id", userId)
            .single();
        if (tokenError || !tokenRow) {
            return res.status(400).json({ error: "No Google tokens found for user" });
        }
        // Configure OAuth client with stored tokens (supports refresh if refresh_token exists)
        const oauth2Client = getOAuthClient();
        oauth2Client.setCredentials({
            access_token: tokenRow.access_token || undefined,
            refresh_token: tokenRow.refresh_token || undefined,
            expiry_date: tokenRow.expiry_date || undefined,
        });
        const gmail = googleapis_1.google.gmail({ version: "v1", auth: oauth2Client });
        // Fetch latest messages from Primary inbox
        const listResp = await gmail.users.messages.list({
            userId: "me",
            maxResults: 25,
            q: "category:primary newer_than:365d",
        });
        const messageIds = (listResp.data.messages || [])
            .map((m) => m.id)
            .filter(Boolean);
        const results = [];
        const cardMatchers = [
            { name: "Visa", pattern: /\bvisa\b/i },
            { name: "Mastercard", pattern: /\bmaster\s?card\b/i },
            { name: "American Express", pattern: /\bamerican\s*express\b|\bamex\b/i },
            { name: "Discover", pattern: /\bdiscover\b/i },
            { name: "RuPay", pattern: /\brupay\b/i },
            { name: "HDFC", pattern: /\bhdfc\b/i },
            { name: "ICICI", pattern: /\bicici\b/i },
            { name: "SBI", pattern: /\bsbi\b/i },
            { name: "Axis", pattern: /\baxis\b/i },
            { name: "Kotak", pattern: /\bkotak\b/i },
            { name: "Citi", pattern: /\bciti\b|\bcitibank\b/i },
            { name: "Barclays", pattern: /\bbarclays\b/i },
            { name: "Capital One", pattern: /\bcapital\s*one\b/i },
            { name: "Chase", pattern: /\bchase\b/i },
        ];
        for (const id of messageIds) {
            const msg = await gmail.users.messages.get({
                userId: "me",
                id,
                format: "metadata",
                metadataHeaders: ["subject", "from"],
            });
            const headers = ((_b = msg.data.payload) === null || _b === void 0 ? void 0 : _b.headers) || [];
            const subject = ((_d = (_c = headers.find((h) => (h.name || "").toLowerCase() === "subject")) === null || _c === void 0 ? void 0 : _c.value) !== null && _d !== void 0 ? _d : undefined);
            const from = ((_f = (_e = headers.find((h) => (h.name || "").toLowerCase() === "from")) === null || _e === void 0 ? void 0 : _e.value) !== null && _f !== void 0 ? _f : undefined);
            const textForMatch = `${subject || ""} ${from || ""}`;
            const matchedCards = cardMatchers
                .filter((c) => c.pattern.test(textForMatch))
                .map((c) => c.name);
            results.push({ id, subject, from, matchedCards });
        }
        // Aggregate distinct card names
        const distinctCards = Array.from(new Set(results.flatMap((r) => r.matchedCards))).sort();
        res.json({ userId, cards: distinctCards, samples: results.slice(0, 10) });
    }
    catch (error) {
        res.status(500).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to read Gmail" });
    }
});
// ============================================================================
// ENHANCED CARD MANAGEMENT API
// ============================================================================
const cardService = new CardDetectionService_1.CardDetectionService();
// Scan user's Gmail for credit cards
app.post("/cards/scan", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer "))) {
            return res
                .status(401)
                .json({ error: "Missing or invalid authorization header" });
        }
        const token = authHeader.substring(7);
        const { data: userData, error } = await supabase_1.default.auth.getUser(token);
        if (error || !userData.user) {
            return res.status(401).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Invalid token" });
        }
        const userId = userData.user.id;
        if (!supabase_1.supabaseAdmin) {
            return res.status(500).json({
                error: "Server not configured with SUPABASE_SERVICE_ROLE_KEY",
            });
        }
        // Get Google tokens
        const { data: tokenRow } = await supabase_1.supabaseAdmin
            .from("user_google_tokens")
            .select("*")
            .eq("user_id", userId)
            .single();
        if (!tokenRow) {
            return res
                .status(400)
                .json({ error: "No Google tokens found. Please re-authenticate." });
        }
        const oauth2Client = getOAuthClient();
        oauth2Client.setCredentials({
            access_token: tokenRow.access_token || undefined,
            refresh_token: tokenRow.refresh_token || undefined,
            expiry_date: tokenRow.expiry_date || undefined,
        });
        // Scan Gmail for cards
        const scanResults = await cardService.scanGmailForCards(userId, oauth2Client);
        const userCards = await cardService.getUserCards(userId);
        res.json({
            success: true,
            scannedEmails: scanResults.length,
            detectedCards: userCards.length,
            cards: userCards,
            scanSummary: scanResults.slice(0, 5), // Return first 5 scan results as examples
        });
    }
    catch (error) {
        res
            .status(500)
            .json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to scan for cards" });
    }
});
// Get user's cards
app.get("/cards/my-cards", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer "))) {
            return res
                .status(401)
                .json({ error: "Missing or invalid authorization header" });
        }
        const token = authHeader.substring(7);
        const { data: userData, error } = await supabase_1.default.auth.getUser(token);
        if (error || !userData.user) {
            return res.status(401).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Invalid token" });
        }
        const userId = userData.user.id;
        const cards = await cardService.getUserCards(userId);
        res.json({
            success: true,
            cards: cards,
            total: cards.length,
        });
    }
    catch (error) {
        res
            .status(500)
            .json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to get user cards" });
    }
});
// Get friends' cards
app.get("/cards/friends-cards", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer "))) {
            return res
                .status(401)
                .json({ error: "Missing or invalid authorization header" });
        }
        const token = authHeader.substring(7);
        const { data: userData, error } = await supabase_1.default.auth.getUser(token);
        if (error || !userData.user) {
            return res.status(401).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Invalid token" });
        }
        const userId = userData.user.id;
        const friendsCards = await cardService.getFriendsCards(userId);
        // Group cards by friend
        const groupedCards = friendsCards.reduce((acc, card) => {
            var _a, _b, _c, _d;
            const friendId = card.user_id;
            if (!acc[friendId]) {
                acc[friendId] = {
                    friend: {
                        id: friendId,
                        email: (_a = card.user) === null || _a === void 0 ? void 0 : _a.email,
                        name: ((_c = (_b = card.user) === null || _b === void 0 ? void 0 : _b.raw_user_meta_data) === null || _c === void 0 ? void 0 : _c.full_name) || ((_d = card.user) === null || _d === void 0 ? void 0 : _d.email),
                    },
                    cards: [],
                };
            }
            acc[friendId].cards.push(card);
            return acc;
        }, {});
        res.json({
            success: true,
            friendsCards: Object.values(groupedCards),
            totalFriends: Object.keys(groupedCards).length,
            totalCards: friendsCards.length,
        });
    }
    catch (error) {
        res
            .status(500)
            .json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to get friends' cards" });
    }
});
// Add manual card
app.post("/cards/add-manual", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer "))) {
            return res
                .status(401)
                .json({ error: "Missing or invalid authorization header" });
        }
        const token = authHeader.substring(7);
        const { data: userData, error } = await supabase_1.default.auth.getUser(token);
        if (error || !userData.user) {
            return res.status(401).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Invalid token" });
        }
        const userId = userData.user.id;
        const { cardName, bankName, cardType, cardNetwork, primaryBenefit, annualFee, visibility, } = req.body;
        if (!cardName || !bankName || !cardType) {
            return res
                .status(400)
                .json({ error: "Card name, bank name, and card type are required" });
        }
        const success = await cardService.addManualCard(userId, {
            cardName,
            bankName,
            cardType,
            cardNetwork,
            primaryBenefit,
            annualFee: annualFee ? parseFloat(annualFee) : undefined,
            visibility,
        });
        if (success) {
            res.json({ success: true, message: "Card added successfully" });
        }
        else {
            res.status(500).json({ error: "Failed to add card" });
        }
    }
    catch (error) {
        res
            .status(500)
            .json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to add manual card" });
    }
});
// Update card visibility
app.put("/cards/:cardId/visibility", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer "))) {
            return res
                .status(401)
                .json({ error: "Missing or invalid authorization header" });
        }
        const token = authHeader.substring(7);
        const { data: userData, error } = await supabase_1.default.auth.getUser(token);
        if (error || !userData.user) {
            return res.status(401).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Invalid token" });
        }
        const userId = userData.user.id;
        const { cardId } = req.params;
        const { visibility } = req.body;
        if (!["private", "friends", "public"].includes(visibility)) {
            return res.status(400).json({ error: "Invalid visibility option" });
        }
        const success = await cardService.updateCardVisibility(userId, cardId, visibility);
        if (success) {
            res.json({ success: true, message: "Card visibility updated" });
        }
        else {
            res.status(500).json({ error: "Failed to update card visibility" });
        }
    }
    catch (error) {
        res
            .status(500)
            .json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to update card visibility" });
    }
});
// Verify card
app.put("/cards/:cardId/verify", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer "))) {
            return res
                .status(401)
                .json({ error: "Missing or invalid authorization header" });
        }
        const token = authHeader.substring(7);
        const { data: userData, error } = await supabase_1.default.auth.getUser(token);
        if (error || !userData.user) {
            return res.status(401).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Invalid token" });
        }
        const userId = userData.user.id;
        const { cardId } = req.params;
        const { isVerified } = req.body;
        const success = await cardService.verifyUserCard(userId, cardId, Boolean(isVerified));
        if (success) {
            res.json({ success: true, message: "Card verification status updated" });
        }
        else {
            res.status(500).json({ error: "Failed to update card verification" });
        }
    }
    catch (error) {
        res.status(500).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to verify card" });
    }
});
// Get card statistics
app.get("/cards/stats", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer "))) {
            return res
                .status(401)
                .json({ error: "Missing or invalid authorization header" });
        }
        const token = authHeader.substring(7);
        const { data: userData, error } = await supabase_1.default.auth.getUser(token);
        if (error || !userData.user) {
            return res.status(401).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Invalid token" });
        }
        const userId = userData.user.id;
        if (!supabase_1.supabaseAdmin) {
            return res.status(500).json({
                error: "Server not configured with SUPABASE_SERVICE_ROLE_KEY",
            });
        }
        // Get user's card statistics
        const { data: userStats } = await supabase_1.supabaseAdmin
            .from("user_cards")
            .select("bank_name, card_type, visibility, is_verified")
            .eq("user_id", userId)
            .eq("is_active", true);
        // Get friends count
        const { count: friendsCount } = await supabase_1.supabaseAdmin
            .from("friend_relationships")
            .select("*", { count: "exact", head: true })
            .eq("user_id", userId)
            .eq("status", "accepted");
        const stats = {
            totalCards: (userStats === null || userStats === void 0 ? void 0 : userStats.length) || 0,
            verifiedCards: (userStats === null || userStats === void 0 ? void 0 : userStats.filter((c) => c.is_verified).length) || 0,
            cardsByBank: (userStats === null || userStats === void 0 ? void 0 : userStats.reduce((acc, card) => {
                acc[card.bank_name] = (acc[card.bank_name] || 0) + 1;
                return acc;
            }, {})) || {},
            cardsByType: (userStats === null || userStats === void 0 ? void 0 : userStats.reduce((acc, card) => {
                acc[card.card_type] = (acc[card.card_type] || 0) + 1;
                return acc;
            }, {})) || {},
            visibilityBreakdown: (userStats === null || userStats === void 0 ? void 0 : userStats.reduce((acc, card) => {
                acc[card.visibility] = (acc[card.visibility] || 0) + 1;
                return acc;
            }, {})) || {},
            friendsCount: friendsCount || 0,
        };
        res.json({
            success: true,
            stats,
        });
    }
    catch (error) {
        res
            .status(500)
            .json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to get card statistics" });
    }
});
// ============================================================================
// PROFESSIONAL INVITE SYSTEM
// ============================================================================
const inviteService = new ProfessionalInviteService_1.ProfessionalInviteService();
// Generate professional invite code
app.post("/invite/create", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer "))) {
            return res
                .status(401)
                .json({ error: "Missing or invalid authorization header" });
        }
        const token = authHeader.substring(7);
        const { data: userData, error } = await supabase_1.default.auth.getUser(token);
        if (error || !userData.user) {
            return res.status(401).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Invalid token" });
        }
        const userId = userData.user.id;
        const { codeType = "personal", maxUses = 25, expiryHours = 24 * 30, customMessage, } = req.body;
        const result = await inviteService.generateInviteCode(userId, {
            codeType,
            maxUses,
            expiryHours,
            customMessage,
            inviterReward: { type: "points", amount: 50 },
            inviteeReward: { type: "points", amount: 25 },
        });
        if (result.success) {
            res.json(result);
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        res.status(500).json({
            error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to create invite code",
        });
    }
});
// Generate WhatsApp share link with professional invite code
app.get("/invite/whatsapp", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer "))) {
            return res
                .status(401)
                .json({ error: "Missing or invalid authorization header" });
        }
        const token = authHeader.substring(7);
        const { data: userData, error } = await supabase_1.default.auth.getUser(token);
        if (error || !userData.user) {
            return res.status(401).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Invalid token" });
        }
        const userId = userData.user.id;
        const { contactName, customMessage } = req.query;
        const result = await inviteService.generateWhatsAppInvite(userId, {
            contactName: contactName,
            customMessage: customMessage,
        });
        if (result.success) {
            res.json(result);
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        res.status(500).json({
            error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to generate WhatsApp link",
        });
    }
});
// Process invite code during login/signup
app.post("/invite/process", async (req, res) => {
    try {
        const { inviteCode, deviceInfo = {} } = req.body;
        const authHeader = req.headers.authorization;
        if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer "))) {
            return res
                .status(401)
                .json({ error: "Missing or invalid authorization header" });
        }
        const token = authHeader.substring(7);
        const { data: userData, error } = await supabase_1.default.auth.getUser(token);
        if (error || !userData.user) {
            return res.status(401).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Invalid token" });
        }
        const invitedUserId = userData.user.id;
        if (!inviteCode || typeof inviteCode !== "string") {
            return res.status(400).json({ error: "Invite code is required" });
        }
        const result = await inviteService.processInviteCode(invitedUserId, inviteCode, deviceInfo);
        if (result.success) {
            res.json(result);
        }
        else {
            res.status(400).json({ error: result.error });
        }
    }
    catch (error) {
        res.status(500).json({
            error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to process invite code",
        });
    }
});
// Get professional friend network
app.get("/friends", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer "))) {
            return res
                .status(401)
                .json({ error: "Missing or invalid authorization header" });
        }
        const token = authHeader.substring(7);
        const { data: userData, error } = await supabase_1.default.auth.getUser(token);
        if (error || !userData.user) {
            return res.status(401).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Invalid token" });
        }
        const userId = userData.user.id;
        const result = await inviteService.getFriendNetwork(userId);
        res.json({
            success: true,
            ...result,
        });
    }
    catch (error) {
        res.status(500).json({
            error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to get friends",
        });
    }
});
// Get invite analytics
app.get("/invite/analytics", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer "))) {
            return res
                .status(401)
                .json({ error: "Missing or invalid authorization header" });
        }
        const token = authHeader.substring(7);
        const { data: userData, error } = await supabase_1.default.auth.getUser(token);
        if (error || !userData.user) {
            return res.status(401).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Invalid token" });
        }
        const userId = userData.user.id;
        const analytics = await inviteService.getInviteAnalytics(userId);
        res.json({
            success: true,
            analytics,
        });
    }
    catch (error) {
        res.status(500).json({
            error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to get invite analytics",
        });
    }
});
// Manage friend requests
app.post("/friends/:friendId/manage", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer "))) {
            return res
                .status(401)
                .json({ error: "Missing or invalid authorization header" });
        }
        const token = authHeader.substring(7);
        const { data: userData, error } = await supabase_1.default.auth.getUser(token);
        if (error || !userData.user) {
            return res.status(401).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Invalid token" });
        }
        const userId = userData.user.id;
        const { friendId } = req.params;
        const { action, settings = {} } = req.body;
        if (!["accept", "decline", "block"].includes(action)) {
            return res.status(400).json({ error: "Invalid action" });
        }
        const result = await inviteService.manageFriendRequest(userId, friendId, action, settings);
        if (result.success) {
            res.json(result);
        }
        else {
            res.status(400).json({ error: result.error });
        }
    }
    catch (error) {
        res.status(500).json({
            error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to manage friend request",
        });
    }
});
// Get user notifications
app.get("/notifications", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer "))) {
            return res
                .status(401)
                .json({ error: "Missing or invalid authorization header" });
        }
        const token = authHeader.substring(7);
        const { data: userData, error } = await supabase_1.default.auth.getUser(token);
        if (error || !userData.user) {
            return res.status(401).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Invalid token" });
        }
        const userId = userData.user.id;
        if (!supabase_1.supabaseAdmin) {
            return res.status(500).json({
                error: "Server not configured with SUPABASE_SERVICE_ROLE_KEY",
            });
        }
        const { data: notifications } = await supabase_1.supabaseAdmin
            .from("notifications")
            .select("*")
            .eq("user_id", userId)
            .eq("is_dismissed", false)
            .order("created_at", { ascending: false })
            .limit(50);
        res.json({
            success: true,
            notifications: notifications || [],
        });
    }
    catch (error) {
        res.status(500).json({
            error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to get notifications",
        });
    }
});
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Server running on port ${PORT}`);
});
//# sourceMappingURL=index.js.map