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
exports.syncEmails = syncEmails;
exports.getEmails = getEmails;
exports.syncContacts = syncContacts;
exports.testDatabase = testDatabase;
exports.getContacts = getContacts;
exports.getGmailCards = getGmailCards;
const googleapis_1 = require("googleapis");
const supabase_1 = __importStar(require("../app/supabase"));
function getOAuthClient() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    return new googleapis_1.google.auth.OAuth2(clientId, clientSecret, redirectUri);
}
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
async function getGoogleTokens(userId) {
    if (!supabase_1.supabaseAdmin) {
        throw new Error("Server not configured with SUPABASE_SERVICE_ROLE_KEY");
    }
    const { data: tokenRow, error: tokenError } = await supabase_1.supabaseAdmin
        .from("user_google_tokens")
        .select("access_token, refresh_token, expiry_date")
        .eq("user_id", userId)
        .single();
    if (tokenError || !tokenRow) {
        throw new Error("No Google tokens found for user");
    }
    // Check if token is expired and refresh if needed
    const now = Date.now();
    const expiryDate = tokenRow.expiry_date
        ? parseInt(tokenRow.expiry_date.toString())
        : 0;
    if (expiryDate < now + 60000) {
        // Refresh if expires within 1 minute
        console.log("Access token expired, refreshing...");
        return await refreshGoogleToken(userId, tokenRow.refresh_token);
    }
    return tokenRow;
}
async function refreshGoogleToken(userId, refreshToken) {
    if (!supabase_1.supabaseAdmin) {
        throw new Error("Server not configured with SUPABASE_SERVICE_ROLE_KEY");
    }
    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials({
        refresh_token: refreshToken,
    });
    try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        // Update the tokens in database
        const { error: updateError } = await supabase_1.supabaseAdmin
            .from("user_google_tokens")
            .update({
            access_token: credentials.access_token,
            expiry_date: credentials.expiry_date,
            updated_at: new Date().toISOString(),
        })
            .eq("user_id", userId);
        if (updateError) {
            console.error("Failed to update refreshed token:", updateError);
            throw new Error("Failed to update refreshed token");
        }
        return {
            access_token: credentials.access_token,
            refresh_token: credentials.refresh_token || refreshToken,
            expiry_date: credentials.expiry_date,
        };
    }
    catch (error) {
        console.error("Token refresh failed:", error);
        throw new Error("Failed to refresh access token. User needs to re-authenticate.");
    }
}
function parseEmailHeaders(headers) {
    const getHeader = (name) => {
        var _a;
        return (_a = headers.find((h) => (h.name || "").toLowerCase() === name.toLowerCase())) === null || _a === void 0 ? void 0 : _a.value;
    };
    return {
        subject: getHeader("subject"),
        from: getHeader("from"),
        to: getHeader("to"),
        cc: getHeader("cc"),
        bcc: getHeader("bcc"),
        date: getHeader("date"),
    };
}
function parseEmailAddress(emailString) {
    if (!emailString)
        return { email: "", name: "" };
    const match = emailString.match(/^(.+?)\s*<(.+)>$/) || emailString.match(/^(.+)$/);
    if (match && match[2]) {
        return { name: match[1].trim().replace(/"/g, ""), email: match[2].trim() };
    }
    return { email: emailString.trim(), name: "" };
}
function parseEmailAddresses(emailString) {
    if (!emailString)
        return [];
    return emailString
        .split(",")
        .map((e) => parseEmailAddress(e.trim()).email)
        .filter(Boolean);
}
async function syncEmails(req, res) {
    var _a, _b, _c, _d, _e;
    try {
        const user = await getUserFromToken(req);
        const userId = user.id;
        const tokenRow = await getGoogleTokens(userId);
        const oauth2Client = getOAuthClient();
        oauth2Client.setCredentials({
            access_token: tokenRow.access_token || undefined,
            refresh_token: tokenRow.refresh_token || undefined,
            expiry_date: tokenRow.expiry_date || undefined,
        });
        const gmail = googleapis_1.google.gmail({ version: "v1", auth: oauth2Client });
        // Get query parameters for pagination and filtering
        const maxResults = parseInt(req.query.maxResults) || 50;
        const pageToken = req.query.pageToken;
        const query = req.query.q || "newer_than:30d";
        let listResp;
        try {
            listResp = await gmail.users.messages.list({
                userId: "me",
                maxResults,
                pageToken,
                q: query,
            });
        }
        catch (error) {
            if (error.code === 401) {
                console.error("Gmail API authentication failed:", error.message);
                return res.status(401).json({
                    error: "Gmail authentication expired. Please re-authenticate with Google.",
                    code: "GMAIL_AUTH_EXPIRED",
                });
            }
            throw error;
        }
        const messageIds = (listResp.data.messages || [])
            .map((m) => m.id)
            .filter(Boolean);
        let syncedCount = 0;
        let skippedCount = 0;
        for (const messageId of messageIds) {
            // Check if email already exists
            const { data: existingEmail } = await supabase_1.supabaseAdmin
                .from("emails")
                .select("id")
                .eq("user_id", userId)
                .eq("gmail_message_id", messageId)
                .single();
            if (existingEmail) {
                skippedCount++;
                continue;
            }
            // Fetch full message
            const msg = await gmail.users.messages.get({
                userId: "me",
                id: messageId,
                format: "full",
            });
            const headers = ((_a = msg.data.payload) === null || _a === void 0 ? void 0 : _a.headers) || [];
            const emailHeaders = parseEmailHeaders(headers);
            const senderInfo = parseEmailAddress(emailHeaders.from || "");
            // Extract body
            let bodyText = "";
            let bodyHtml = "";
            function extractBody(part) {
                var _a, _b;
                if (part.mimeType === "text/plain" && ((_a = part.body) === null || _a === void 0 ? void 0 : _a.data)) {
                    bodyText = Buffer.from(part.body.data, "base64").toString("utf-8");
                }
                else if (part.mimeType === "text/html" && ((_b = part.body) === null || _b === void 0 ? void 0 : _b.data)) {
                    bodyHtml = Buffer.from(part.body.data, "base64").toString("utf-8");
                }
                else if (part.parts) {
                    part.parts.forEach(extractBody);
                }
            }
            if (msg.data.payload) {
                extractBody(msg.data.payload);
            }
            // Insert email into database
            const emailData = {
                user_id: userId,
                gmail_message_id: messageId,
                thread_id: msg.data.threadId,
                subject: emailHeaders.subject,
                sender_email: senderInfo.email,
                sender_name: senderInfo.name,
                recipient_emails: parseEmailAddresses(emailHeaders.to || ""),
                cc_emails: parseEmailAddresses(emailHeaders.cc || ""),
                bcc_emails: parseEmailAddresses(emailHeaders.bcc || ""),
                body_text: bodyText,
                body_html: bodyHtml,
                snippet: msg.data.snippet,
                labels: msg.data.labelIds || [],
                date_received: emailHeaders.date
                    ? new Date(emailHeaders.date).toISOString()
                    : new Date().toISOString(),
                date_sent: emailHeaders.date
                    ? new Date(emailHeaders.date).toISOString()
                    : new Date().toISOString(),
                is_read: !((_b = msg.data.labelIds) === null || _b === void 0 ? void 0 : _b.includes("UNREAD")),
                is_important: ((_c = msg.data.labelIds) === null || _c === void 0 ? void 0 : _c.includes("IMPORTANT")) || false,
                has_attachments: ((_e = (_d = msg.data.payload) === null || _d === void 0 ? void 0 : _d.parts) === null || _e === void 0 ? void 0 : _e.some((part) => part.filename)) || false,
                size_estimate: msg.data.sizeEstimate || 0,
            };
            const { error: emailInsertError } = await supabase_1.supabaseAdmin
                .from("emails")
                .insert(emailData);
            if (emailInsertError) {
                console.error("Email insert error:", emailInsertError);
            }
            else {
                syncedCount++;
            }
        }
        res.json({
            success: true,
            synced: syncedCount,
            skipped: skippedCount,
            total: messageIds.length,
            nextPageToken: listResp.data.nextPageToken,
        });
    }
    catch (error) {
        res.status(500).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to sync emails" });
    }
}
async function getEmails(req, res) {
    try {
        const user = await getUserFromToken(req);
        const userId = user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search;
        const offset = (page - 1) * limit;
        let query = supabase_1.supabaseAdmin
            .from("emails")
            .select("*", { count: "exact" })
            .eq("user_id", userId)
            .order("date_received", { ascending: false });
        if (search) {
            query = query.or(`subject.ilike.%${search}%,sender_email.ilike.%${search}%,sender_name.ilike.%${search}%`);
        }
        const { data: emails, error, count, } = await query.range(offset, offset + limit - 1);
        if (error)
            throw error;
        res.json({
            emails: emails || [],
            pagination: {
                page,
                limit,
                total: count || 0,
                totalPages: Math.ceil((count || 0) / limit),
            },
        });
    }
    catch (error) {
        res.status(500).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to get emails" });
    }
}
async function syncContacts(req, res) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    try {
        const user = await getUserFromToken(req);
        const userId = user.id;
        const tokenRow = await getGoogleTokens(userId);
        const oauth2Client = getOAuthClient();
        oauth2Client.setCredentials({
            access_token: tokenRow.access_token || undefined,
            refresh_token: tokenRow.refresh_token || undefined,
            expiry_date: tokenRow.expiry_date || undefined,
        });
        const people = googleapis_1.google.people({ version: "v1", auth: oauth2Client });
        const pageSize = parseInt(req.query.pageSize) || 100;
        const pageToken = req.query.pageToken;
        const response = await people.people.connections.list({
            resourceName: "people/me",
            pageSize,
            pageToken,
            personFields: "names,emailAddresses,phoneNumbers,addresses,organizations,photos,birthdays,biographies,metadata",
        });
        const connections = response.data.connections || [];
        let syncedCount = 0;
        let skippedCount = 0;
        for (const contact of connections) {
            const googleContactId = ((_a = contact.resourceName) === null || _a === void 0 ? void 0 : _a.replace("people/", "")) || "";
            if (!googleContactId)
                continue;
            // Check if contact already exists
            const { data: existingContact } = await supabase_1.supabaseAdmin
                .from("contacts")
                .select("id")
                .eq("user_id", userId)
                .eq("google_contact_id", googleContactId)
                .single();
            const contactData = {
                user_id: userId,
                google_contact_id: googleContactId,
                display_name: (_c = (_b = contact.names) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.displayName,
                given_name: (_e = (_d = contact.names) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.givenName,
                family_name: (_g = (_f = contact.names) === null || _f === void 0 ? void 0 : _f[0]) === null || _g === void 0 ? void 0 : _g.familyName,
                middle_name: (_j = (_h = contact.names) === null || _h === void 0 ? void 0 : _h[0]) === null || _j === void 0 ? void 0 : _j.middleName,
                nickname: (_l = (_k = contact.nicknames) === null || _k === void 0 ? void 0 : _k[0]) === null || _l === void 0 ? void 0 : _l.value,
                email_addresses: contact.emailAddresses || [],
                phone_numbers: contact.phoneNumbers || [],
                addresses: contact.addresses || [],
                organizations: contact.organizations || [],
                photo_url: (_o = (_m = contact.photos) === null || _m === void 0 ? void 0 : _m[0]) === null || _o === void 0 ? void 0 : _o.url,
            };
            if (existingContact) {
                const { error: updateError } = await supabase_1.supabaseAdmin
                    .from("contacts")
                    .update(contactData)
                    .eq("id", existingContact.id);
                if (updateError) {
                    console.error("Contact update error:", updateError);
                }
            }
            else {
                const { error: insertError } = await supabase_1.supabaseAdmin
                    .from("contacts")
                    .insert(contactData);
                if (insertError) {
                    console.error("Contact insert error:", insertError);
                }
                else {
                    syncedCount++;
                }
            }
        }
        res.json({
            success: true,
            synced: syncedCount,
            skipped: skippedCount,
            total: connections.length,
            nextPageToken: response.data.nextPageToken,
        });
    }
    catch (error) {
        res
            .status(500)
            .json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to sync contacts" });
    }
}
async function testDatabase(req, res) {
    var _a, _b;
    try {
        const user = await getUserFromToken(req);
        const userId = user.id;
        if (!supabase_1.supabaseAdmin) {
            return res.status(500).json({ error: "Supabase admin not configured" });
        }
        // Test if tables exist and are accessible
        const emailsTest = await supabase_1.supabaseAdmin
            .from("emails")
            .select("count(*)", { count: "exact" })
            .eq("user_id", userId);
        const contactsTest = await supabase_1.supabaseAdmin
            .from("contacts")
            .select("count(*)", { count: "exact" })
            .eq("user_id", userId);
        res.json({
            tablesAccessible: true,
            emailsCount: emailsTest.count || 0,
            contactsCount: contactsTest.count || 0,
            emailsError: (_a = emailsTest.error) === null || _a === void 0 ? void 0 : _a.message,
            contactsError: (_b = contactsTest.error) === null || _b === void 0 ? void 0 : _b.message,
            userId: userId,
        });
    }
    catch (error) {
        res.status(500).json({
            error: (error === null || error === void 0 ? void 0 : error.message) || "Database test failed",
            tablesAccessible: false,
        });
    }
}
async function getContacts(req, res) {
    try {
        const user = await getUserFromToken(req);
        const userId = user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search;
        const offset = (page - 1) * limit;
        let query = supabase_1.supabaseAdmin
            .from("contacts")
            .select("*", { count: "exact" })
            .eq("user_id", userId)
            .order("display_name", { ascending: true });
        if (search) {
            query = query.or(`display_name.ilike.%${search}%,given_name.ilike.%${search}%,family_name.ilike.%${search}%`);
        }
        const { data: contacts, error, count, } = await query.range(offset, offset + limit - 1);
        if (error)
            throw error;
        res.json({
            contacts: contacts || [],
            pagination: {
                page,
                limit,
                total: count || 0,
                totalPages: Math.ceil((count || 0) / limit),
            },
        });
    }
    catch (error) {
        res.status(500).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to get contacts" });
    }
}
async function getGmailCards(req, res) {
    var _a, _b, _c, _d, _e;
    try {
        const user = await getUserFromToken(req);
        const userId = user.id;
        const tokenRow = await getGoogleTokens(userId);
        const oauth2Client = getOAuthClient();
        oauth2Client.setCredentials({
            access_token: tokenRow.access_token || undefined,
            refresh_token: tokenRow.refresh_token || undefined,
            expiry_date: tokenRow.expiry_date || undefined,
        });
        const gmail = googleapis_1.google.gmail({ version: "v1", auth: oauth2Client });
        let listResp;
        try {
            listResp = await gmail.users.messages.list({
                userId: "me",
                maxResults: 25,
                q: "category:primary newer_than:365d",
            });
        }
        catch (error) {
            if (error.code === 401) {
                console.error("Gmail API authentication failed:", error.message);
                return res.status(401).json({
                    error: "Gmail authentication expired. Please re-authenticate with Google.",
                    code: "GMAIL_AUTH_EXPIRED",
                });
            }
            throw error;
        }
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
            const headers = ((_a = msg.data.payload) === null || _a === void 0 ? void 0 : _a.headers) || [];
            const subject = ((_c = (_b = headers.find((h) => (h.name || "").toLowerCase() === "subject")) === null || _b === void 0 ? void 0 : _b.value) !== null && _c !== void 0 ? _c : undefined);
            const from = ((_e = (_d = headers.find((h) => (h.name || "").toLowerCase() === "from")) === null || _d === void 0 ? void 0 : _d.value) !== null && _e !== void 0 ? _e : undefined);
            const textForMatch = `${subject || ""} ${from || ""}`;
            const matchedCards = cardMatchers
                .filter((c) => c.pattern.test(textForMatch))
                .map((c) => c.name);
            results.push({ id, subject, from, matchedCards });
        }
        const distinctCards = Array.from(new Set(results.flatMap((r) => r.matchedCards))).sort();
        res.json({ userId, cards: distinctCards, samples: results.slice(0, 10) });
    }
    catch (error) {
        res.status(500).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Failed to read Gmail" });
    }
}
//# sourceMappingURL=gmail.controller.js.map