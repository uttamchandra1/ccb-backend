"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CardDetectionService = void 0;
const googleapis_1 = require("googleapis");
const supabase_1 = require("../app/supabase");
class CardDetectionService {
    constructor() {
        this.cardDatabase = new Map();
        this.initializeCardDatabase();
    }
    initializeCardDatabase() {
        // Enhanced card database with detailed information
        const cards = [
            // HDFC Bank Cards
            {
                name: "HDFC Millennia Credit Card",
                bank: "HDFC Bank",
                network: "Visa",
                confidence: 0.95,
                benefits: "5% cashback on online shopping, 2.5% on dining",
                annualFee: 1000,
            },
            {
                name: "HDFC Regalia Gold Credit Card",
                bank: "HDFC Bank",
                network: "Visa",
                confidence: 0.95,
                benefits: "4 reward points per ₹150 spent",
                annualFee: 2500,
            },
            {
                name: "HDFC Diners Club Black Credit Card",
                bank: "HDFC Bank",
                network: "Diners Club",
                confidence: 0.98,
                benefits: "Premium travel benefits, airport lounge access",
                annualFee: 10000,
            },
            // ICICI Bank Cards
            {
                name: "ICICI Amazon Pay Credit Card",
                bank: "ICICI Bank",
                network: "Visa",
                confidence: 0.95,
                benefits: "5% unlimited cashback on Amazon, 2% on bill payments",
                annualFee: 0,
            },
            {
                name: "ICICI Sapphiro Credit Card",
                bank: "ICICI Bank",
                network: "Mastercard",
                confidence: 0.93,
                benefits: "Premium lifestyle benefits, travel insurance",
                annualFee: 3500,
            },
            // SBI Cards
            {
                name: "SBI SimplyCLICK Credit Card",
                bank: "SBI Card",
                network: "Visa",
                confidence: 0.92,
                benefits: "10X reward points on online spends",
                annualFee: 499,
            },
            {
                name: "SBI Card PRIME",
                bank: "SBI Card",
                network: "Visa",
                confidence: 0.94,
                benefits: "5X reward points on dining, movies, grocery",
                annualFee: 2999,
            },
            // Axis Bank Cards
            {
                name: "Axis Bank Flipkart Credit Card",
                bank: "Axis Bank",
                network: "Mastercard",
                confidence: 0.96,
                benefits: "4% unlimited cashback on Flipkart",
                annualFee: 500,
            },
            {
                name: "Axis Bank Magnus Credit Card",
                bank: "Axis Bank",
                network: "Mastercard",
                confidence: 0.97,
                benefits: "Premium travel rewards, milestone benefits",
                annualFee: 12500,
            },
            // American Express Cards
            {
                name: "American Express Gold Card",
                bank: "American Express",
                network: "American Express",
                confidence: 0.98,
                benefits: "4X membership rewards on dining, travel",
                annualFee: 4500,
            },
            {
                name: "American Express Platinum Card",
                bank: "American Express",
                network: "American Express",
                confidence: 0.99,
                benefits: "Premium travel benefits, concierge services",
                annualFee: 60000,
            },
        ];
        cards.forEach((card) => {
            const key = this.generateCardKey(card.name, card.bank);
            this.cardDatabase.set(key, card);
        });
    }
    generateCardKey(name, bank) {
        return `${bank.toLowerCase().trim()}_${name.toLowerCase().trim()}`.replace(/\s+/g, "_");
    }
    async scanGmailForCards(userId, oauth2Client) {
        const gmail = googleapis_1.google.gmail({ version: "v1", auth: oauth2Client });
        // Enhanced search query for better card detection
        const searchQueries = [
            "from:noreply category:primary newer_than:365d",
            "from:alerts category:primary newer_than:365d",
            "from:statements category:primary newer_than:365d",
            "subject:(credit card OR statement OR bill) newer_than:365d",
            "from:(hdfc OR icici OR sbi OR axis OR amex) newer_than:365d",
        ];
        const allResults = [];
        for (const query of searchQueries) {
            try {
                const listResp = await gmail.users.messages.list({
                    userId: "me",
                    maxResults: 50,
                    q: query,
                });
                const messageIds = (listResp.data.messages || [])
                    .map((m) => m.id)
                    .filter(Boolean);
                for (const messageId of messageIds) {
                    try {
                        const result = await this.analyzeEmail(messageId, gmail);
                        if (result && result.matchedCards.length > 0) {
                            allResults.push(result);
                        }
                    }
                    catch (error) {
                        console.warn(`Failed to analyze email ${messageId}:`, error);
                    }
                }
            }
            catch (error) {
                console.warn(`Failed to search with query "${query}":`, error);
            }
        }
        // Store results in database
        await this.storeEmailScanResults(userId, allResults);
        return allResults;
    }
    async analyzeEmail(messageId, gmail) {
        var _a;
        const msg = await gmail.users.messages.get({
            userId: "me",
            id: messageId,
            format: "full",
        });
        const headers = ((_a = msg.data.payload) === null || _a === void 0 ? void 0 : _a.headers) || [];
        const subject = this.getHeaderValue(headers, "subject") || "";
        const sender = this.getHeaderValue(headers, "from") || "";
        const dateHeader = this.getHeaderValue(headers, "date");
        const dateReceived = dateHeader ? new Date(dateHeader) : new Date();
        // Extract email body text
        const rawText = this.extractEmailText(msg.data.payload);
        // Detect cards using advanced pattern matching
        const matchedCards = this.detectCardsInText(subject, sender, rawText);
        if (matchedCards.length === 0) {
            return null;
        }
        return {
            messageId,
            subject,
            sender,
            dateReceived,
            matchedCards,
            rawText: rawText.substring(0, 2000), // Limit text storage
        };
    }
    getHeaderValue(headers, name) {
        var _a;
        return (_a = headers.find((h) => { var _a; return ((_a = h.name) === null || _a === void 0 ? void 0 : _a.toLowerCase()) === name.toLowerCase(); })) === null || _a === void 0 ? void 0 : _a.value;
    }
    extractEmailText(payload) {
        var _a, _b;
        let text = "";
        if ((_a = payload.body) === null || _a === void 0 ? void 0 : _a.data) {
            text += Buffer.from(payload.body.data, "base64").toString("utf-8");
        }
        if (payload.parts) {
            for (const part of payload.parts) {
                if (part.mimeType === "text/plain" && ((_b = part.body) === null || _b === void 0 ? void 0 : _b.data)) {
                    text += Buffer.from(part.body.data, "base64").toString("utf-8");
                }
                else if (part.parts) {
                    text += this.extractEmailText(part);
                }
            }
        }
        return text;
    }
    detectCardsInText(subject, sender, text) {
        const content = `${subject} ${sender} ${text}`.toLowerCase();
        const matches = [];
        // Enhanced pattern matching
        const patterns = [
            // HDFC patterns
            {
                regex: /hdfc.*millennia/i,
                cardKey: "hdfc bank_hdfc millennia credit card",
            },
            {
                regex: /hdfc.*regalia/i,
                cardKey: "hdfc bank_hdfc regalia gold credit card",
            },
            {
                regex: /hdfc.*diners.*black/i,
                cardKey: "hdfc bank_hdfc diners club black credit card",
            },
            // ICICI patterns
            {
                regex: /icici.*amazon.*pay/i,
                cardKey: "icici bank_icici amazon pay credit card",
            },
            {
                regex: /icici.*sapphiro/i,
                cardKey: "icici bank_icici sapphiro credit card",
            },
            // SBI patterns
            {
                regex: /sbi.*simplyclick/i,
                cardKey: "sbi card_sbi simplyclick credit card",
            },
            { regex: /sbi.*prime/i, cardKey: "sbi card_sbi card prime" },
            // Axis patterns
            {
                regex: /axis.*flipkart/i,
                cardKey: "axis bank_axis bank flipkart credit card",
            },
            {
                regex: /axis.*magnus/i,
                cardKey: "axis bank_axis bank magnus credit card",
            },
            // AMEX patterns
            {
                regex: /american express.*gold/i,
                cardKey: "american express_american express gold card",
            },
            {
                regex: /amex.*gold/i,
                cardKey: "american express_american express gold card",
            },
            {
                regex: /american express.*platinum/i,
                cardKey: "american express_american express platinum card",
            },
            {
                regex: /amex.*platinum/i,
                cardKey: "american express_american express platinum card",
            },
        ];
        for (const pattern of patterns) {
            if (pattern.regex.test(content)) {
                const card = this.cardDatabase.get(pattern.cardKey);
                if (card && !matches.find((m) => m.name === card.name)) {
                    matches.push({ ...card });
                }
            }
        }
        // Generic bank detection for unknown cards
        if (matches.length === 0) {
            const bankPatterns = [
                { name: "HDFC Bank", regex: /hdfc/i },
                { name: "ICICI Bank", regex: /icici/i },
                { name: "SBI Card", regex: /sbi/i },
                { name: "Axis Bank", regex: /axis/i },
                { name: "American Express", regex: /american express|amex/i },
                { name: "Kotak Bank", regex: /kotak/i },
                { name: "Citi Bank", regex: /citi/i },
            ];
            for (const bank of bankPatterns) {
                if (bank.regex.test(content) &&
                    /credit card|statement|bill/i.test(content)) {
                    matches.push({
                        name: `${bank.name} Credit Card`,
                        bank: bank.name,
                        network: "Unknown",
                        confidence: 0.7,
                    });
                    break;
                }
            }
        }
        return matches;
    }
    async storeEmailScanResults(userId, results) {
        if (!supabase_1.supabaseAdmin)
            return;
        for (const result of results) {
            // Store email scan result
            await supabase_1.supabaseAdmin.from("emails").upsert({
                user_id: userId,
                message_id: result.messageId,
                subject: result.subject,
                sender: result.sender,
                date_received: result.dateReceived.toISOString(),
                matched_cards: result.matchedCards.map((c) => c.name),
                raw_text: result.rawText,
            }, { onConflict: "user_id,message_id" });
            // Store detected cards
            for (const card of result.matchedCards) {
                await supabase_1.supabaseAdmin.from("user_cards").upsert({
                    user_id: userId,
                    card_name: card.name,
                    bank_name: card.bank,
                    card_type: "Credit Card",
                    card_network: card.network,
                    primary_benefit: card.benefits,
                    annual_fee: card.annualFee,
                    detected_from: "gmail_scan",
                    detection_confidence: card.confidence,
                    visibility: "friends",
                    is_active: true,
                    is_verified: false,
                }, { onConflict: "user_id,card_name,bank_name" });
            }
        }
    }
    async getUserCards(userId) {
        if (!supabase_1.supabaseAdmin)
            return [];
        const { data: cards, error } = await supabase_1.supabaseAdmin
            .from("user_cards")
            .select("*")
            .eq("user_id", userId)
            .eq("is_active", true)
            .order("created_at", { ascending: false });
        if (error) {
            console.error("Error fetching user cards:", error);
            return [];
        }
        return cards || [];
    }
    async getFriendsCards(userId) {
        if (!supabase_1.supabaseAdmin)
            return [];
        // Get user's friends
        const { data: friendships } = await supabase_1.supabaseAdmin
            .from("friend_relationships")
            .select("friend_id")
            .eq("user_id", userId)
            .eq("status", "accepted");
        if (!friendships || friendships.length === 0) {
            return [];
        }
        const friendIds = friendships.map((f) => f.friend_id);
        // Get friends' cards that are visible
        const { data: friendsCards, error } = await supabase_1.supabaseAdmin
            .from("user_cards")
            .select(`
        *,
        user:user_id (
          email,
          raw_user_meta_data
        )
      `)
            .in("user_id", friendIds)
            .in("visibility", ["friends", "public"])
            .eq("is_active", true)
            .order("created_at", { ascending: false });
        if (error) {
            console.error("Error fetching friends' cards:", error);
            return [];
        }
        return friendsCards || [];
    }
    async verifyUserCard(userId, cardId, isVerified) {
        if (!supabase_1.supabaseAdmin)
            return false;
        const { error } = await supabase_1.supabaseAdmin
            .from("user_cards")
            .update({ is_verified: isVerified, updated_at: new Date().toISOString() })
            .eq("id", cardId)
            .eq("user_id", userId);
        return !error;
    }
    async updateCardVisibility(userId, cardId, visibility) {
        if (!supabase_1.supabaseAdmin)
            return false;
        const { error } = await supabase_1.supabaseAdmin
            .from("user_cards")
            .update({ visibility, updated_at: new Date().toISOString() })
            .eq("id", cardId)
            .eq("user_id", userId);
        return !error;
    }
    async addManualCard(userId, cardData) {
        if (!supabase_1.supabaseAdmin)
            return false;
        const { error } = await supabase_1.supabaseAdmin.from("user_cards").insert({
            user_id: userId,
            card_name: cardData.cardName,
            bank_name: cardData.bankName,
            card_type: cardData.cardType,
            card_network: cardData.cardNetwork || "Unknown",
            primary_benefit: cardData.primaryBenefit,
            annual_fee: cardData.annualFee,
            detected_from: "manual_entry",
            detection_confidence: 1.0,
            visibility: cardData.visibility || "friends",
            is_active: true,
            is_verified: true,
        });
        return !error;
    }
}
exports.CardDetectionService = CardDetectionService;
//# sourceMappingURL=CardDetectionService.js.map