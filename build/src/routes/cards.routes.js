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
const cards_controller_1 = require("../controllers/cards.controller");
const CardDetectionService_1 = require("../services/CardDetectionService");
const supabase_1 = __importStar(require("../app/supabase"));
const router = (0, express_1.Router)();
const cardService = new CardDetectionService_1.CardDetectionService();
// Get user's cards
router.get("/cards/my-cards", async (req, res) => {
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
// Automatic Gmail scanning and card detection
router.post("/cards/scan-gmail", async (req, res) => {
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
        // Get user's Google tokens
        const { data: googleTokens } = await supabase_1.supabaseAdmin
            .from("user_google_tokens")
            .select("access_token, refresh_token")
            .eq("user_id", userId)
            .single();
        if (!(googleTokens === null || googleTokens === void 0 ? void 0 : googleTokens.access_token)) {
            return res.status(400).json({
                error: "No Google access token found. Please reconnect your Gmail account.",
            });
        }
        console.log(`Starting Gmail scan for user ${userId}...`);
        // Scan Gmail for credit cards
        const scanResults = await cardService.scanGmailForCards(userId, googleTokens.access_token);
        console.log(`Gmail scan completed for user ${userId}. Found ${scanResults.length} email results.`);
        // Extract and store detected cards from scan results
        const storedCards = [];
        for (const emailResult of scanResults) {
            for (const card of emailResult.matchedCards) {
                try {
                    const success = await cardService.addManualCard(userId, {
                        cardName: card.name,
                        bankName: card.bank,
                        cardType: "Credit Card",
                        cardNetwork: card.network,
                        primaryBenefit: card.benefits,
                        annualFee: card.annualFee,
                    });
                    if (success) {
                        storedCards.push(card);
                    }
                }
                catch (error) {
                    console.error(`Failed to store card ${card.name}:`, error);
                }
            }
        }
        res.json({
            success: true,
            message: "Gmail scan completed successfully",
            cardsScanned: scanResults.length,
            cardsStored: storedCards.length,
            cards: storedCards,
        });
    }
    catch (error) {
        console.error("Gmail scan error:", error);
        res.status(500).json({
            error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to scan Gmail for cards",
        });
    }
});
// Get friends' cards
router.get("/cards/friends-cards", async (req, res) => {
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
// Add sample cards for testing
router.post("/cards/add-sample", async (req, res) => {
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
        // Sample cards data
        const sampleCards = [
            {
                user_id: userId,
                card_name: "HDFC Millennia Credit Card",
                bank_name: "HDFC Bank",
                card_type: "Credit Card",
                card_network: "Visa",
                last_four_digits: "1234",
                annual_fee: 1000,
                rewards_type: "Cashback",
                primary_benefit: "5% cashback on online shopping",
                detected_from: "manual_entry",
                visibility: "friends",
                is_active: true,
                is_verified: true,
            },
            {
                user_id: userId,
                card_name: "ICICI Amazon Pay Credit Card",
                bank_name: "ICICI Bank",
                card_type: "Credit Card",
                card_network: "Visa",
                last_four_digits: "5678",
                annual_fee: 0,
                rewards_type: "Cashback",
                primary_benefit: "5% unlimited cashback on Amazon",
                detected_from: "manual_entry",
                visibility: "friends",
                is_active: true,
                is_verified: true,
            },
            {
                user_id: userId,
                card_name: "SBI SimplyCLICK Credit Card",
                bank_name: "SBI Card",
                card_type: "Credit Card",
                card_network: "Visa",
                last_four_digits: "9012",
                annual_fee: 499,
                rewards_type: "Points",
                primary_benefit: "10X reward points on online spends",
                detected_from: "manual_entry",
                visibility: "public",
                is_active: true,
                is_verified: false,
            },
        ];
        const { error: insertError } = await supabase_1.supabaseAdmin
            .from("user_cards")
            .insert(sampleCards);
        if (insertError) {
            console.error("Error inserting sample cards:", insertError);
            return res.status(500).json({ error: insertError.message });
        }
        res.json({
            success: true,
            message: "Sample cards added successfully",
            cardsAdded: sampleCards.length,
        });
    }
    catch (error) {
        res
            .status(500)
            .json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to add sample cards" });
    }
});
router.post("/me/cards", cards_controller_1.upsertMyCards);
router.get("/friends/cards", cards_controller_1.getFriendsCards);
exports.default = router;
//# sourceMappingURL=cards.routes.js.map