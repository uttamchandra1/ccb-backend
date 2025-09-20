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
const express_1 = require("express");
const ProfessionalInviteService_1 = require("../services/ProfessionalInviteService");
const supabase_1 = __importStar(require("../app/supabase"));
const router = (0, express_1.Router)();
let inviteService = null;
// Initialize service safely
setTimeout(() => {
    try {
        inviteService = new ProfessionalInviteService_1.ProfessionalInviteService();
        console.log("ProfessionalInviteService initialized successfully");
    }
    catch (error) {
        console.error("Error initializing ProfessionalInviteService:", error);
    }
}, 1000);
// Test route to check if the server is working
router.get("/test", (req, res) => {
    res.json({
        message: "Test route working",
        timestamp: new Date().toISOString(),
    });
});
// Test endpoint to create an invite code (for debugging)
router.post("/test/create-invite", async (req, res) => {
    try {
        if (!inviteService) {
            console.error("Invite service not initialized");
            return res.status(500).json({ error: "Invite service not initialized" });
        }
        // Create a test user ID (using a valid UUID)
        const testUserId = "00000000-0000-0000-0000-000000000001";
        const result = await inviteService.generateInviteCode(testUserId, {
            codeType: "personal",
            maxUses: 10,
            expiryHours: 24 * 30, // 30 days
            customMessage: "Test invite code",
            inviterReward: { type: "points", amount: 50 },
            inviteeReward: { type: "points", amount: 25 },
        });
        if (result.success) {
            res.json({
                success: true,
                message: "Test invite code created",
                inviteCode: result.inviteCode,
            });
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        console.error("Error creating test invite code:", error);
        res.status(500).json({
            error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to create test invite code",
        });
    }
});
// Test endpoint to process an invite code (for debugging)
router.post("/test/process-invite", async (req, res) => {
    try {
        if (!inviteService) {
            console.error("Invite service not initialized");
            return res.status(500).json({ error: "Invite service not initialized" });
        }
        const { inviteCode, invitedUserId } = req.body;
        if (!inviteCode || !invitedUserId) {
            return res.status(400).json({
                error: "inviteCode and invitedUserId are required",
            });
        }
        const result = await inviteService.processInviteCode(invitedUserId, inviteCode, {
            ipAddress: "127.0.0.1",
            userAgent: "Test Agent",
        });
        res.json(result);
    }
    catch (error) {
        console.error("Error processing test invite code:", error);
        res.status(500).json({
            error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to process test invite code",
        });
    }
});
// Generate professional invite code
router.post("/invite/create", async (req, res) => {
    try {
        if (!inviteService) {
            console.error("Invite service not initialized");
            return res.status(500).json({ error: "Invite service not initialized" });
        }
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
        console.error("Error in /invite/create:", error);
        res.status(500).json({
            error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to create invite code",
        });
    }
});
// Get user's invite codes
router.get("/invite/my-codes", async (req, res) => {
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
        // Get user's invite codes
        const { data: codes, error: codesError } = await supabase_1.supabaseAdmin
            .from("invite_codes")
            .select("*")
            .eq("inviter_user_id", userId)
            .eq("is_active", true)
            .order("created_at", { ascending: false });
        if (codesError) {
            console.error("Error fetching invite codes:", codesError);
            return res.status(500).json({ error: "Failed to fetch invite codes" });
        }
        res.json({
            success: true,
            codes: codes || [],
        });
    }
    catch (error) {
        console.error("Error getting invite codes:", error);
        res.status(500).json({
            error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to get invite codes",
        });
    }
});
// Track share analytics
router.post("/invite/track-share", async (req, res) => {
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
        const { shareType, timestamp, platform, inviteCode } = req.body;
        if (!supabase_1.supabaseAdmin) {
            return res.status(500).json({
                error: "Server not configured with SUPABASE_SERVICE_ROLE_KEY",
            });
        }
        // Store share analytics
        const { error: insertError } = await supabase_1.supabaseAdmin
            .from("invite_usage")
            .insert({
            user_id: userId,
            invite_code: inviteCode || "native_share",
            share_type: shareType || "native_share",
            platform: platform || "unknown",
            shared_at: timestamp || new Date().toISOString(),
            conversion_status: "shared",
        });
        if (insertError) {
            console.error("Error tracking share:", insertError);
            return res.status(500).json({ error: "Failed to track share" });
        }
        res.json({
            success: true,
            message: "Share tracked successfully",
        });
    }
    catch (error) {
        console.error("Error tracking share:", error);
        res.status(500).json({
            error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to track share",
        });
    }
});
// Process invite code from client (explicit endpoint)
router.post("/invite/process", async (req, res) => {
    try {
        if (!inviteService) {
            console.error("Invite service not initialized");
            return res.status(500).json({ error: "Invite service not initialized" });
        }
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
        const { inviteCode, deviceInfo } = req.body || {};
        if (!inviteCode) {
            return res.status(400).json({ error: "inviteCode is required" });
        }
        const result = await inviteService.processInviteCode(userId, inviteCode, deviceInfo || {
            userAgent: req.headers["user-agent"],
            ipAddress: req.ip,
            platform: "api",
        });
        if (!result.success) {
            return res.status(400).json({ success: false, error: result.error });
        }
        res.json(result);
    }
    catch (error) {
        console.error("Error in /invite/process:", error);
        res.status(500).json({
            error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to process invite code",
        });
    }
});
exports.default = router;
//# sourceMappingURL=invite.routes.js.map