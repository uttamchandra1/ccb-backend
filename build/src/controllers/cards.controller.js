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
exports.upsertMyCards = upsertMyCards;
exports.getFriendsCards = getFriendsCards;
const supabase_1 = __importStar(require("../app/supabase"));
async function getUserFromToken(req) {
    var _a;
    const authHeader = req.headers.authorization || "";
    const bearerToken = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : undefined;
    const cookieToken = (_a = req.cookies) === null || _a === void 0 ? void 0 : _a["sb-access-token"];
    const supabaseAccessToken = bearerToken || cookieToken;
    if (!supabaseAccessToken) {
        throw new Error("Missing Supabase access token");
    }
    const { data: userData, error: userError } = await supabase_1.default.auth.getUser(supabaseAccessToken);
    if (userError || !userData.user) {
        throw new Error((userError === null || userError === void 0 ? void 0 : userError.message) || "Invalid Supabase token");
    }
    return userData.user;
}
async function upsertMyCards(req, res) {
    var _a;
    try {
        const user = await getUserFromToken(req);
        const userId = user.id;
        if (!supabase_1.supabaseAdmin) {
            return res.status(500).json({
                error: "Server not configured with SUPABASE_SERVICE_ROLE_KEY",
            });
        }
        const issuers = (((_a = req.body) === null || _a === void 0 ? void 0 : _a.issuers) || []);
        if (!Array.isArray(issuers) || issuers.length === 0) {
            return res.status(400).json({ error: "issuers array is required" });
        }
        const rows = issuers
            .filter((s) => typeof s === "string" && s.trim().length > 0)
            .map((issuer) => ({
            user_id: userId,
            card_name: issuer,
            bank_name: issuer,
            card_type: "Credit Card",
            card_network: "Unknown",
            visibility: "friends",
        }));
        const { error } = await supabase_1.supabaseAdmin
            .from("user_cards")
            .upsert(rows, { onConflict: "user_id,card_name,bank_name" });
        if (error)
            return res.status(500).json({ error: error.message });
        res.json({ success: true, upserted: rows.length });
    }
    catch (error) {
        res.status(500).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to save cards" });
    }
}
async function getFriendsCards(req, res) {
    var _a;
    try {
        const user = await getUserFromToken(req);
        const userId = user.id;
        if (!supabase_1.supabaseAdmin) {
            return res.status(500).json({
                error: "Server not configured with SUPABASE_SERVICE_ROLE_KEY",
            });
        }
        // Get friends through invite system (primary method)
        const { data: friendships, error: friendshipError } = await supabase_1.supabaseAdmin
            .from("friend_relationships")
            .select("friend_id, user_id")
            .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
            .eq("status", "accepted");
        if (friendshipError) {
            console.error("Error fetching friendships:", friendshipError);
            return res.status(500).json({ error: friendshipError.message });
        }
        const friendIds = new Set();
        for (const friendship of friendships || []) {
            if (friendship.user_id === userId) {
                friendIds.add(friendship.friend_id);
            }
            else {
                friendIds.add(friendship.user_id);
            }
        }
        // Fallback: Read contacts if no friends found through invite system
        if (friendIds.size === 0) {
            const { data: contacts, error: contactsError } = await supabase_1.supabaseAdmin
                .from("contacts")
                .select("email_addresses")
                .eq("user_id", userId)
                .limit(200);
            if (contactsError) {
                console.error("Error fetching contacts:", contactsError);
            }
            else {
                const emails = new Set();
                for (const c of contacts || []) {
                    const arr = ((c === null || c === void 0 ? void 0 : c.email_addresses) || []);
                    for (const e of arr) {
                        const v = ((e === null || e === void 0 ? void 0 : e.value) || "").trim().toLowerCase();
                        if (v)
                            emails.add(v);
                    }
                }
                // Map contact emails to Supabase auth user ids (best-effort)
                if (emails.size > 0) {
                    const limited = Array.from(emails).slice(0, 200);
                    for (const email of limited) {
                        try {
                            const { data } = await supabase_1.supabaseAdmin.auth.admin.getUserById(email);
                            const friendId = (_a = data === null || data === void 0 ? void 0 : data.user) === null || _a === void 0 ? void 0 : _a.id;
                            if (friendId && friendId !== userId)
                                friendIds.add(friendId);
                        }
                        catch (_b) {
                            // ignore lookup failures
                        }
                    }
                }
            }
        }
        if (friendIds.size === 0) {
            return res.json({
                issuers: [],
                counts: {},
                friends: [],
                message: "No friends found. Invite friends to see their cards!",
            });
        }
        // Get friend details and their cards
        const friendIdsArray = Array.from(friendIds);
        const { data: friendUsers, error: usersError } = await supabase_1.supabaseAdmin.auth.admin.listUsers();
        if (usersError) {
            console.error("Error fetching users:", usersError);
            return res.status(500).json({ error: usersError.message });
        }
        const friends = friendUsers.users
            .filter((user) => friendIdsArray.includes(user.id))
            .map((user) => {
            var _a, _b;
            return ({
                id: user.id,
                name: ((_a = user.user_metadata) === null || _a === void 0 ? void 0 : _a.full_name) || user.email,
                email: user.email,
                avatar: (_b = user.user_metadata) === null || _b === void 0 ? void 0 : _b.avatar_url,
            });
        });
        // Get cards from friends
        const { data: cardRows, error: cardsError } = await supabase_1.supabaseAdmin
            .from("user_cards")
            .select("id, user_id, card_name, bank_name, card_type, card_network, visibility")
            .in("user_id", friendIdsArray)
            .in("visibility", ["friends", "public"]);
        if (cardsError) {
            console.error("Error fetching friend cards:", cardsError);
            return res.status(500).json({ error: cardsError.message });
        }
        // Group cards by friend
        const friendCards = [];
        for (const friend of friends) {
            const friendCardRows = (cardRows === null || cardRows === void 0 ? void 0 : cardRows.filter((card) => card.user_id === friend.id)) || [];
            if (friendCardRows.length > 0) {
                friendCards.push({
                    friend,
                    cards: friendCardRows.map((card) => ({
                        id: card.id,
                        cardName: card.card_name || "Unknown Card",
                        bankName: card.bank_name || "Unknown Bank",
                        cardType: card.card_type || "Credit Card",
                        cardNetwork: card.card_network || "Unknown",
                        visibility: card.visibility,
                    })),
                });
            }
        }
        // Aggregate banks for backward compatibility
        const counts = {};
        for (const r of cardRows || []) {
            const k = (r.bank_name || "").trim();
            if (!k)
                continue;
            counts[k] = (counts[k] || 0) + 1;
        }
        const banks = Object.keys(counts).sort();
        res.json({
            banks,
            counts,
            friends,
            friendCards,
            totalFriends: friends.length,
            totalCards: (cardRows === null || cardRows === void 0 ? void 0 : cardRows.length) || 0,
        });
    }
    catch (error) {
        console.error("Error in getFriendsCards:", error);
        res
            .status(500)
            .json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to get friends' cards" });
    }
}
//# sourceMappingURL=cards.controller.js.map