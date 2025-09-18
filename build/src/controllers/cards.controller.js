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
            return res
                .status(500)
                .json({
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
            issuer,
            brand: issuer,
            visibility: "friends",
        }));
        const { error } = await supabase_1.supabaseAdmin
            .from("user_cards")
            .upsert(rows, { onConflict: "user_id,issuer" });
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
            return res
                .status(500)
                .json({
                error: "Server not configured with SUPABASE_SERVICE_ROLE_KEY",
            });
        }
        // 1) Read your contacts' emails
        const { data: contacts, error: contactsError } = await supabase_1.supabaseAdmin
            .from("contacts")
            .select("email_addresses")
            .eq("user_id", userId)
            .limit(200);
        if (contactsError)
            return res.status(500).json({ error: contactsError.message });
        const emails = new Set();
        for (const c of contacts || []) {
            const arr = ((c === null || c === void 0 ? void 0 : c.email_addresses) || []);
            for (const e of arr) {
                const v = ((e === null || e === void 0 ? void 0 : e.value) || "").trim().toLowerCase();
                if (v)
                    emails.add(v);
            }
        }
        // 2) Map contact emails to Supabase auth user ids (best-effort)
        const friendIds = new Set();
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
        if (friendIds.size === 0) {
            return res.json({ issuers: [], counts: {} });
        }
        // 3) Aggregate issuers shared by friends
        const { data: cardRows, error: cardsError } = await supabase_1.supabaseAdmin
            .from("user_cards")
            .select("issuer")
            .in("user_id", Array.from(friendIds))
            .in("visibility", ["friends", "public"]);
        if (cardsError)
            return res.status(500).json({ error: cardsError.message });
        const counts = {};
        for (const r of cardRows || []) {
            const k = (r.issuer || "").trim();
            if (!k)
                continue;
            counts[k] = (counts[k] || 0) + 1;
        }
        const issuers = Object.keys(counts).sort();
        res.json({ issuers, counts });
    }
    catch (error) {
        res
            .status(500)
            .json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to get friends' cards" });
    }
}
//# sourceMappingURL=cards.controller.js.map