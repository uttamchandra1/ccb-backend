"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = require("../controllers/auth.controller");
const supabase_1 = __importDefault(require("../app/supabase"));
const router = (0, express_1.Router)();
// Begin Google OAuth flow
router.get("/auth/google", auth_controller_1.beginGoogleAuth);
// OAuth callback
router.get("/auth/google/callback", auth_controller_1.googleOAuthCallback);
// Token refresh endpoint
router.post("/auth/refresh", async (req, res) => {
    try {
        const { refresh_token } = req.body;
        if (!refresh_token) {
            return res.status(400).json({ error: "Refresh token is required" });
        }
        // Use Supabase to refresh the token
        const { data, error } = await supabase_1.default.auth.refreshSession({
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
    }
    catch (error) {
        console.error("Token refresh error:", error);
        res
            .status(500)
            .json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to refresh token" });
    }
});
exports.default = router;
//# sourceMappingURL=auth.routes.js.map