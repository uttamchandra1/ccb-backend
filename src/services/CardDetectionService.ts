import { google } from "googleapis";
import { supabaseAdmin } from "../app/supabase";

interface CardMatch {
  name: string;
  bank: string;
  network: string;
  confidence: number;
  benefits?: string;
  annualFee?: number;
  cardNumber?: string;
  expiryDate?: string;
  cardHolderName?: string;
}

interface EmailScanResult {
  messageId: string;
  subject: string;
  sender: string;
  dateReceived: Date;
  matchedCards: CardMatch[];
  rawText: string;
  emailType: "statement" | "transaction" | "promotional" | "fraud" | "other";
  confidence: number;
}

interface BankConfig {
  name: string;
  domains: string[];
  emailPatterns: RegExp[];
  statementKeywords: string[];
  transactionKeywords: string[];
  cardPatterns: RegExp[];
  fraudIndicators: string[];
}

export class CardDetectionService {
  private cardDatabase: Map<string, CardMatch> = new Map();
  private bankConfigs: Map<string, BankConfig> = new Map();
  private cardCache: Map<string, { data: any; timestamp: number }> = new Map();

  constructor() {
    this.initializeCardDatabase();
    this.initializeBankConfigs();
  }

  private initializeBankConfigs() {
    const configs: BankConfig[] = [
      {
        name: "HDFC Bank",
        domains: ["hdfcbank.com", "hdfc.com", "hdfcbank.net"],
        emailPatterns: [
          /^noreply@hdfcbank\.com$/i,
          /^alerts@hdfcbank\.com$/i,
          /^statements@hdfcbank\.com$/i,
          /^ebanking@hdfcbank\.com$/i,
          /^EmailStatements\.cards@hdfcbank\.net$/i,
        ],
        statementKeywords: [
          "credit card statement",
          "monthly statement",
          "card statement",
          "billing statement",
          "statement of account",
        ],
        transactionKeywords: [
          "transaction alert",
          "card transaction",
          "purchase alert",
          "payment confirmation",
          "card usage alert",
        ],
        cardPatterns: [
          /HDFC\s+(Millennia|Regalia|Diners|Infinity|Freedom|MoneyBack|Titanium|Platinum|Gold|Silver)\s+Credit\s+Card/i,
          /HDFC\s+(Millennia|Regalia|Diners|Infinity|Freedom|MoneyBack|Titanium|Platinum|Gold|Silver)\s+Card/i,
          /(HDFC|HDFC\s+Bank)[^\n]*UPI\s+RuPay\s+Credit\s+Card/i,
        ],
        fraudIndicators: [
          "urgent action required",
          "account suspended",
          "verify immediately",
          "click here to verify",
          "account blocked",
          "suspicious activity",
        ],
      },
      {
        name: "ICICI Bank",
        domains: ["icicibank.com", "icici.com"],
        emailPatterns: [
          /^noreply@icicibank\.com$/i,
          /^alerts@icicibank\.com$/i,
          /^statements@icicibank\.com$/i,
          /^ebanking@icicibank\.com$/i,
        ],
        statementKeywords: [
          "credit card statement",
          "monthly statement",
          "card statement",
          "billing statement",
        ],
        transactionKeywords: [
          "transaction alert",
          "card transaction",
          "purchase alert",
          "payment confirmation",
        ],
        cardPatterns: [
          /ICICI\s+(Amazon\s+Pay|Sapphiro|Coral|Rubyx|Emerald|Platinum|Gold|Silver)\s+Credit\s+Card/i,
          /ICICI\s+(Amazon\s+Pay|Sapphiro|Coral|Rubyx|Emerald|Platinum|Gold|Silver)\s+Card/i,
        ],
        fraudIndicators: [
          "urgent action required",
          "account suspended",
          "verify immediately",
          "click here to verify",
        ],
      },
      {
        name: "SBI Card",
        domains: ["sbicard.com", "sbi.com"],
        emailPatterns: [
          /^noreply@sbicard\.com$/i,
          /^alerts@sbicard\.com$/i,
          /^statements@sbicard\.com$/i,
          /^ebanking@sbicard\.com$/i,
        ],
        statementKeywords: [
          "credit card statement",
          "monthly statement",
          "card statement",
          "billing statement",
        ],
        transactionKeywords: [
          "transaction alert",
          "card transaction",
          "purchase alert",
          "payment confirmation",
        ],
        cardPatterns: [
          /SBI\s+(SimplyCLICK|PRIME|Elite|Advantage|Rewards|Pulse|Unnati|Freedom)\s+Credit\s+Card/i,
          /SBI\s+(SimplyCLICK|PRIME|Elite|Advantage|Rewards|Pulse|Unnati|Freedom)\s+Card/i,
          /SBI\s+Card\s+(SimplyCLICK|PRIME|Elite|Advantage|Rewards|Pulse|Unnati|Freedom)/i,
        ],
        fraudIndicators: [
          "urgent action required",
          "account suspended",
          "verify immediately",
          "click here to verify",
        ],
      },
      {
        name: "Axis Bank",
        domains: ["axisbank.com", "axis.com"],
        emailPatterns: [
          /^noreply@axisbank\.com$/i,
          /^alerts@axisbank\.com$/i,
          /^statements@axisbank\.com$/i,
          /^ebanking@axisbank\.com$/i,
          /^cc\.statement@axisbank\.com$/i,
          /^cc\.statements@axisbank\.com$/i,
          /^creditcard\.statement@axisbank\.com$/i,
        ],
        statementKeywords: [
          "credit card statement",
          "monthly statement",
          "card statement",
          "billing statement",
          // Broad fallback
          "statement",
        ],
        transactionKeywords: [
          "transaction alert",
          "card transaction",
          "purchase alert",
          "payment confirmation",
        ],
        cardPatterns: [
          /Axis\s+(Flipkart|Magnus|Privilege|Select|My|Freedom|Neo|Ace|Burgundy)\s+Credit\s+Card/i,
          /Axis\s+(Flipkart|Magnus|Privilege|Select|My|Freedom|Neo|Ace|Burgundy)\s+Card/i,
          /(Flipkart\s+Axis\s+Bank)\s+Credit\s+Card/i,
        ],
        fraudIndicators: [
          "urgent action required",
          "account suspended",
          "verify immediately",
          "click here to verify",
        ],
      },
      {
        name: "American Express",
        domains: ["americanexpress.com", "amex.com"],
        emailPatterns: [
          /^noreply@americanexpress\.com$/i,
          /^alerts@americanexpress\.com$/i,
          /^statements@americanexpress\.com$/i,
          /^ebanking@americanexpress\.com$/i,
        ],
        statementKeywords: [
          "credit card statement",
          "monthly statement",
          "card statement",
          "billing statement",
        ],
        transactionKeywords: [
          "transaction alert",
          "card transaction",
          "purchase alert",
          "payment confirmation",
        ],
        cardPatterns: [
          /American\s+Express\s+(Platinum|Gold|Green|Blue|Delta|Hilton|Marriott)\s+Card/i,
          /AMEX\s+(Platinum|Gold|Green|Blue|Delta|Hilton|Marriott)\s+Card/i,
        ],
        fraudIndicators: [
          "urgent action required",
          "account suspended",
          "verify immediately",
          "click here to verify",
        ],
      },
    ];

    configs.forEach((config) => {
      this.bankConfigs.set(config.name.toLowerCase(), config);
    });
  }

  private initializeCardDatabase() {
    // Enhanced card database with detailed information
    const cards: CardMatch[] = [
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

  private generateCardKey(name: string, bank: string): string {
    return `${bank.toLowerCase().trim()}_${name.toLowerCase().trim()}`.replace(
      /\s+/g,
      "_"
    );
  }

  async scanGmailForCards(
    userId: string,
    oauth2Client: any
  ): Promise<EmailScanResult[]> {
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    // Narrowed search: Only fetch credit card statements/bills (faster)
    const searchQueries = [
      // Common statement/bill subjects from major issuers
      'category:primary subject:(statement OR "credit card statement" OR "monthly statement" OR bill OR "bill summary" OR "e-statement") from:(hdfcbank.com OR hdfcbank.net OR icicibank.com OR sbicard.com OR axisbank.com OR americanexpress.com OR citi.com OR rblbank.com OR kotak.com) newer_than:120d',

      // Fallback with typical sender mailboxes for statements
      "category:primary subject:(statement OR e-statement OR bill) from:(noreply@hdfcbank.com OR EmailStatements.cards@hdfcbank.net OR alerts@icicibank.com OR noreply@sbicard.com OR notifications@axisbank.com OR cc.statements@axisbank.com OR cc.statement@axisbank.com OR statements@axisbank.com OR americanexpress.com) newer_than:120d",

      // Axis Flipkart explicit subject match without category filter
      'subject:("Flipkart Axis Bank Credit Card Statement") from:(axisbank.com OR cc.statements@axisbank.com) newer_than:365d',

      // HDFC explicit subject match without category filter
      'subject:(HDFC Bank UPI RuPay Credit Card Statement OR "HDFC Bank" (Millennia OR Regalia OR Diners OR MoneyBack) Statement) from:(hdfcbank.com OR hdfcbank.net OR EmailStatements.cards@hdfcbank.net) newer_than:365d',
    ];

    const allResults: EmailScanResult[] = [];

    for (const query of searchQueries) {
      try {
        const listResp = await gmail.users.messages.list({
          userId: "me",
          // Reduced results for faster scans since we only need statements
          maxResults: 50,
          q: query,
        });

        console.log(
          `[GMAIL] Query: ${query} → messages: ${
            listResp.data.resultSizeEstimate ||
            (listResp.data.messages || []).length ||
            0
          }`
        );

        const messageIds = (listResp.data.messages || [])
          .map((m) => m.id!)
          .filter(Boolean);

        // Process emails in batches for better performance
        const batchSize = 10;
        for (let i = 0; i < messageIds.length; i += batchSize) {
          const batch = messageIds.slice(i, i + batchSize);
          const batchPromises = batch.map(async (messageId) => {
            try {
              const result = await this.analyzeEmailWithAdvancedFiltering(
                messageId,
                gmail
              );
              return result;
            } catch (error) {
              console.warn(`Failed to analyze email ${messageId}:`, error);
              return null;
            }
          });

          const batchResults = await Promise.all(batchPromises);
          const validResults = batchResults.filter(
            (result): result is EmailScanResult =>
              result !== null && result.matchedCards.length > 0
          );
          allResults.push(...validResults);
        }
      } catch (error) {
        console.warn(`Failed to search with query "${query}":`, error);
      }
    }

    // Store all valid results (no confidence threshold)
    await this.storeEmailScanResults(userId, allResults);

    return allResults;
  }

  private async analyzeEmailWithAdvancedFiltering(
    messageId: string,
    gmail: any
  ): Promise<EmailScanResult | null> {
    const msg = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      // Only fetch metadata (no body) for performance and privacy
      format: "metadata",
      metadataHeaders: ["Subject", "From", "Date"],
    });

    const headers = msg.data.payload?.headers || [];
    const subject = this.getHeaderValue(headers, "subject") || "";
    const sender = this.getHeaderValue(headers, "from") || "";
    const dateHeader = this.getHeaderValue(headers, "date");
    const dateReceived = dateHeader ? new Date(dateHeader) : new Date();

    // Debug: log subjects being analyzed
    try {
      console.log(
        `[GMAIL] Analyzing email → subject: "${subject}" | from: "${sender}" | id: ${messageId}`
      );
    } catch (_) {}

    // We are not reading the body; operate on subject + sender only
    const rawText = "";

    // Advanced email classification and fraud detection
    const emailAnalysis = this.classifyEmailType(subject, sender, rawText);
    try {
      console.log(
        `[GMAIL] Classified → type: ${emailAnalysis.type} bank: ${emailAnalysis.bank} subject: "${subject}"`
      );
    } catch (_) {}

    // Skip promotional and fraudulent emails
    if (
      emailAnalysis.type === "promotional" ||
      emailAnalysis.type === "fraud"
    ) {
      return null;
    }

    // Only process statement and transaction emails
    if (
      emailAnalysis.type !== "statement" &&
      emailAnalysis.type !== "transaction"
    ) {
      return null;
    }

    // Detect cards using advanced pattern matching
    const matchedCards = this.detectCardsWithAdvancedLogic(
      subject,
      sender,
      "",
      emailAnalysis
    );
    try {
      console.log(
        `[GMAIL] Detected cards → count: ${matchedCards.length} subject: "${subject}"`
      );
    } catch (_) {}

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
      emailType: emailAnalysis.type,
      confidence: emailAnalysis.confidence,
    };
  }

  private classifyEmailType(
    subject: string,
    sender: string,
    text: string
  ): {
    type: "statement" | "transaction" | "promotional" | "fraud" | "other";
    confidence: number;
    bank?: string;
  } {
    // Only use subject and sender to comply with requirement
    const content = `${subject} ${sender}`.toLowerCase();

    // Fraud detection - highest priority
    for (const [bankName, config] of this.bankConfigs) {
      for (const indicator of config.fraudIndicators) {
        if (content.includes(indicator.toLowerCase())) {
          return { type: "fraud", confidence: 0.9, bank: config.name };
        }
      }
    }

    // Extract plain email from sender (e.g., "Axis Bank <cc.statements@axisbank.com>")
    const senderEmail =
      this.extractEmailAddress(sender)?.toLowerCase() || sender.toLowerCase();

    // Check if sender is from a legitimate bank
    let detectedBank: string | undefined;
    for (const [bankName, config] of this.bankConfigs) {
      const emailMatches = config.emailPatterns.some(
        (pattern) => pattern.test(sender) || pattern.test(senderEmail)
      );
      const domainMatches = (config.domains || []).some(
        (domain) =>
          senderEmail.endsWith(`@${domain.toLowerCase()}`) ||
          senderEmail.includes(domain.toLowerCase())
      );
      if (emailMatches || domainMatches) {
        detectedBank = config.name;
        break;
      }
    }

    if (!detectedBank) {
      // Infer bank from subject/body if sender didn't match
      detectedBank = this.detectBankFromSubject(subject, text);
    }

    if (!detectedBank) {
      return { type: "other", confidence: 0.1 };
    }

    const config = this.bankConfigs.get(detectedBank.toLowerCase())!;

    // Statement detection (subject weighted higher)
    const subjectLower = subject.toLowerCase();
    const statementScore = config.statementKeywords.reduce((score, keyword) => {
      const k = keyword.toLowerCase();
      return (
        score +
        (subjectLower.includes(k) ? 2 : 0) +
        (content.includes(k) ? 1 : 0)
      );
    }, 0);

    if (statementScore >= 2) {
      return { type: "statement", confidence: 0.9, bank: detectedBank };
    }

    // Transaction detection
    const transactionScore = config.transactionKeywords.reduce(
      (score, keyword) => {
        return score + (content.includes(keyword.toLowerCase()) ? 1 : 0);
      },
      0
    );

    if (transactionScore >= 1) {
      return { type: "transaction", confidence: 0.8, bank: detectedBank };
    }

    // Promotional detection
    const promotionalKeywords = [
      "offer",
      "discount",
      "cashback",
      "reward",
      "bonus",
      "limited time",
      "special offer",
      "exclusive deal",
      "save money",
      "get more",
    ];

    const promotionalScore = promotionalKeywords.reduce((score, keyword) => {
      return score + (content.includes(keyword.toLowerCase()) ? 1 : 0);
    }, 0);

    if (promotionalScore >= 3) {
      return { type: "promotional", confidence: 0.7, bank: detectedBank };
    }

    return { type: "other", confidence: 0.3, bank: detectedBank };
  }

  private detectBankFromSubject(
    subject: string,
    text: string
  ): string | undefined {
    const hay = subject.toLowerCase();
    const patterns: Array<{ bank: string; regex: RegExp }> = [
      { bank: "HDFC Bank", regex: /(\bhdfc\b|hdfc\s+bank)/i },
      { bank: "ICICI Bank", regex: /(\bicici\b|icici\s+bank)/i },
      {
        bank: "SBI Card",
        regex: /(\bsbi\b|sbi\s+card|state\s+bank\s+of\s+india)/i,
      },
      {
        bank: "Axis Bank",
        regex: /(axis\s+bank|flipkart\s+axis\s+bank|\baxis\b)/i,
      },
      { bank: "American Express", regex: /(american\s+express|\bamex\b)/i },
      { bank: "Citi", regex: /(citibank|citi\s+bank|\bciti\b)/i },
      { bank: "RBL Bank", regex: /(rbl\s+bank|\brbl\b)/i },
      { bank: "Kotak", regex: /(kotak\s+mahindra|\bkotak\b)/i },
    ];

    for (const p of patterns) {
      if (p.regex.test(hay)) return p.bank;
    }
    return undefined;
  }

  private extractEmailAddress(input: string): string | undefined {
    // Try to capture address inside angle brackets first
    const angleMatch = input.match(/<([^>]+)>/);
    if (angleMatch && angleMatch[1]) {
      return angleMatch[1].trim();
    }
    // Fallback: find something that looks like an email
    const bareMatch = input.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (bareMatch && bareMatch[0]) {
      return bareMatch[0].trim();
    }
    return undefined;
  }

  private detectCardsWithAdvancedLogic(
    subject: string,
    sender: string,
    text: string,
    emailAnalysis: { type: string; confidence: number; bank?: string }
  ): CardMatch[] {
    // Only use subject and sender
    const content = `${subject} ${sender}`.toLowerCase();
    const matches: CardMatch[] = [];

    // Only proceed if we have a detected bank
    if (!emailAnalysis.bank) {
      return matches;
    }

    const config = this.bankConfigs.get(emailAnalysis.bank.toLowerCase());
    if (!config) {
      return matches;
    }

    // Use bank-specific card patterns for higher accuracy
    for (const pattern of config.cardPatterns) {
      const match = content.match(pattern);
      if (match) {
        let cardName = match[0];
        // Normalize common alternate phrasings
        if (
          config.name === "Axis Bank" &&
          /Flipkart\s+Axis\s+Bank/i.test(cardName)
        ) {
          cardName = "Axis Bank Flipkart Credit Card";
        }
        const cardKey = this.generateCardKey(cardName, config.name);
        const card = this.cardDatabase.get(cardKey);

        if (card) {
          // Boost confidence for statement emails
          const confidence =
            emailAnalysis.type === "statement"
              ? Math.min(card.confidence + 0.1, 1.0)
              : card.confidence;

          matches.push({
            ...card,
            confidence,
            cardNumber: this.extractCardNumber(content),
            expiryDate: this.extractExpiryDate(content),
            cardHolderName: this.extractCardHolderName(content),
          });
        }
      }
    }

    // Subject-only extraction for known Axis phrasing
    if (config.name === "Axis Bank") {
      const subj = subject.toLowerCase();
      if (/flipkart\s+axis\s+bank\s+credit\s+card\s+statement/.test(subj)) {
        const cardKey = this.generateCardKey(
          "Axis Bank Flipkart Credit Card",
          config.name
        );
        const card = this.cardDatabase.get(cardKey);
        if (card) {
          matches.push({
            ...card,
            confidence: card.confidence,
            cardNumber: undefined,
            expiryDate: undefined,
            cardHolderName: undefined,
          });
        } else {
          // Fallback generic entry if not present in database
          matches.push({
            name: "Axis Bank Flipkart Credit Card",
            bank: config.name,
            network: "Visa",
            confidence: 0.9,
            benefits: "Statement detected via subject",
            annualFee: 0,
            cardNumber: undefined,
            expiryDate: undefined,
            cardHolderName: undefined,
          });
        }
      }
    }

    // Subject-only extraction for HDFC UPI RuPay Credit Card statements
    if (config.name === "HDFC Bank") {
      const subj = subject.toLowerCase();
      if (
        /hdfc\s+bank[^\n]*upi\s+rupay\s+credit\s+card\s+statement/.test(subj)
      ) {
        const canonical = "HDFC Bank UPI RuPay Credit Card";
        const tryNames = [canonical, "HDFC UPI RuPay Credit Card"];
        let dbCard: CardMatch | undefined;
        for (const n of tryNames) {
          const key = this.generateCardKey(n, config.name);
          const found = this.cardDatabase.get(key);
          if (found) {
            dbCard = found;
            break;
          }
        }
        if (dbCard) {
          matches.push({ ...dbCard, confidence: dbCard.confidence });
        } else {
          matches.push({
            name: canonical,
            bank: config.name,
            network: "RuPay",
            confidence: 0.9,
            benefits: "Statement detected via subject",
            annualFee: 0,
          });
        }
      }

      // Generic HDFC subject product extraction (Millennia, Regalia, Diners, MoneyBack, etc.)
      const productMatch = subj.match(
        /(millennia|regalia|diners|diners\s+club|moneyback|freedom|titanium|platinum|gold|silver|rupay)/i
      );
      if (productMatch) {
        const token = productMatch[1].toLowerCase();
        const canonicalMap: Record<string, string> = {
          millennia: "HDFC Millennia Credit Card",
          regalia: "HDFC Regalia Gold Credit Card",
          diners: "HDFC Diners Club Black Credit Card",
          "diners club": "HDFC Diners Club Black Credit Card",
          moneyback: "HDFC MoneyBack Credit Card",
          freedom: "HDFC Freedom Credit Card",
          titanium: "HDFC Titanium Credit Card",
          platinum: "HDFC Platinum Credit Card",
          gold: "HDFC Gold Credit Card",
          silver: "HDFC Silver Credit Card",
          rupay: "HDFC Bank UPI RuPay Credit Card",
        };
        const canonical =
          canonicalMap[token] ||
          `HDFC ${token[0].toUpperCase()}${token.slice(1)} Credit Card`;
        const tryNames = [
          canonical,
          `HDFC Bank ${canonical.replace(/^HDFC\s+/i, "").trim()}`,
        ];
        let dbCard: CardMatch | undefined;
        for (const n of tryNames) {
          const key = this.generateCardKey(n, config.name);
          const found = this.cardDatabase.get(key);
          if (found) {
            dbCard = found;
            break;
          }
        }
        if (dbCard) {
          matches.push({ ...dbCard, confidence: dbCard.confidence });
        } else {
          matches.push({
            name: canonical,
            bank: config.name,
            network: canonical.includes("RuPay") ? "RuPay" : "Visa",
            confidence: 0.9,
            benefits: "Statement detected via subject",
            annualFee: 0,
          });
        }
      }
    }

    // Subject-only extraction for SBI statements like:
    // "Your Reliance SBI Card PRIME Monthly Statement - Jun 2025"
    if (config.name === "SBI Card") {
      const subj = subject.toLowerCase();
      if (
        /sbi\s+card\s+prime/.test(subj) ||
        /reliance\s+sbi\s+card\s+prime/.test(subj)
      ) {
        const cardKey = this.generateCardKey("SBI Card PRIME", config.name);
        const card = this.cardDatabase.get(cardKey);
        if (card) {
          matches.push({
            ...card,
            confidence: card.confidence,
            cardNumber: undefined,
            expiryDate: undefined,
            cardHolderName: undefined,
          });
        } else {
          matches.push({
            name: "SBI Card PRIME",
            bank: config.name,
            network: "Visa",
            confidence: 0.9,
            benefits: "Statement detected via subject",
            annualFee: 0,
            cardNumber: undefined,
            expiryDate: undefined,
            cardHolderName: undefined,
          });
        }
      }

      // Generic SBI Card <Product>
      const generic = subj.match(
        /sbi\s+card\s+(simplyclick|elite|advantage|rewards|pulse|unnati|freedom)/i
      );
      if (generic) {
        const product = generic[1].toUpperCase();
        const canonical =
          product === "SIMPLYCLICK"
            ? "SBI SimplyCLICK Credit Card"
            : `SBI Card ${product}`;
        const tryNames = [
          canonical,
          `SBI ${product} Credit Card`,
          `SBI ${product}`,
        ];
        let dbCard: CardMatch | undefined;
        for (const n of tryNames) {
          const key = this.generateCardKey(n, config.name);
          const found = this.cardDatabase.get(key);
          if (found) {
            dbCard = found;
            break;
          }
        }
        if (dbCard) {
          matches.push({ ...dbCard, confidence: dbCard.confidence });
        } else {
          matches.push({
            name: canonical,
            bank: config.name,
            network: "Visa",
            confidence: 0.9,
            benefits: "Statement detected via subject",
            annualFee: 0,
          });
        }
      }
    }

    // Remove duplicates and sort by confidence
    const uniqueMatches = matches.filter(
      (match, index, self) =>
        index === self.findIndex((m) => m.name === match.name)
    );

    // Sort by confidence but allow all
    return uniqueMatches.sort(
      (a, b) => (b.confidence || 0) - (a.confidence || 0)
    );
  }

  private extractCardNumber(text: string): string | undefined {
    // Look for patterns like "Card ending in 1234" or "****1234"
    const patterns = [
      /card\s+ending\s+in\s+(\d{4})/i,
      /\*{4}(\d{4})/,
      /ending\s+(\d{4})/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return undefined;
  }

  private extractExpiryDate(text: string): string | undefined {
    // Look for expiry date patterns
    const patterns = [
      /expiry\s*:\s*(\d{2}\/\d{2})/i,
      /expires\s*:\s*(\d{2}\/\d{2})/i,
      /valid\s+until\s*:\s*(\d{2}\/\d{2})/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return undefined;
  }

  private extractCardHolderName(text: string): string | undefined {
    // Look for cardholder name patterns
    const patterns = [
      /cardholder\s*:\s*([A-Za-z\s]+)/i,
      /name\s*:\s*([A-Za-z\s]+)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return undefined;
  }

  private getHeaderValue(headers: any[], name: string): string | undefined {
    return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
      ?.value;
  }

  private extractEmailText(payload: any): string {
    let text = "";

    if (payload.body?.data) {
      text += Buffer.from(payload.body.data, "base64").toString("utf-8");
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === "text/plain" && part.body?.data) {
          text += Buffer.from(part.body.data, "base64").toString("utf-8");
        } else if (part.mimeType === "text/html" && part.body?.data) {
          // Strip HTML tags to plain text
          const html = Buffer.from(part.body.data, "base64").toString("utf-8");
          const noTags = html
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&");
          text += ` ${noTags} `;
        } else if (part.parts) {
          text += this.extractEmailText(part);
        }
      }
    }

    return text;
  }

  private async storeEmailScanResults(
    userId: string,
    results: EmailScanResult[]
  ): Promise<void> {
    if (!supabaseAdmin) return;

    for (const result of results) {
      // Store email scan result
      await supabaseAdmin.from("emails").upsert(
        {
          user_id: userId,
          message_id: result.messageId,
          subject: result.subject,
          sender: result.sender,
          date_received: result.dateReceived.toISOString(),
          matched_cards: result.matchedCards.map((c) => c.name),
          raw_text: result.rawText,
          email_type: result.emailType,
          confidence: result.confidence,
        },
        { onConflict: "user_id,message_id" }
      );

      // Store detected cards
      for (const card of result.matchedCards) {
        await supabaseAdmin.from("user_cards").upsert(
          {
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
            card_number: card.cardNumber,
            expiry_date: card.expiryDate,
            card_holder_name: card.cardHolderName,
          },
          { onConflict: "user_id,card_name,bank_name" }
        );
      }
    }
  }

  async getUserCards(userId: string): Promise<any[]> {
    if (!supabaseAdmin) return [];

    const { data: cards, error } = await supabaseAdmin
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

  async getFriendsCards(userId: string): Promise<any[]> {
    if (!supabaseAdmin) return [];

    // Get user's friends
    const { data: friendships } = await supabaseAdmin
      .from("friend_relationships")
      .select("friend_id")
      .eq("user_id", userId)
      .eq("status", "accepted");

    if (!friendships || friendships.length === 0) {
      return [];
    }

    const friendIds = friendships.map((f) => f.friend_id);

    // Get friends' cards that are visible
    const { data: friendsCards, error } = await supabaseAdmin
      .from("user_cards")
      .select(
        `
        *,
        user:user_id (
          email,
          raw_user_meta_data
        )
      `
      )
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

  async verifyUserCard(
    userId: string,
    cardId: string,
    isVerified: boolean
  ): Promise<boolean> {
    if (!supabaseAdmin) return false;

    const { error } = await supabaseAdmin
      .from("user_cards")
      .update({ is_verified: isVerified, updated_at: new Date().toISOString() })
      .eq("id", cardId)
      .eq("user_id", userId);

    return !error;
  }

  async updateCardVisibility(
    userId: string,
    cardId: string,
    visibility: "private" | "friends" | "public"
  ): Promise<boolean> {
    if (!supabaseAdmin) return false;

    const { error } = await supabaseAdmin
      .from("user_cards")
      .update({ visibility, updated_at: new Date().toISOString() })
      .eq("id", cardId)
      .eq("user_id", userId);

    return !error;
  }

  async addManualCard(
    userId: string,
    cardData: {
      cardName: string;
      bankName: string;
      cardType: string;
      cardNetwork?: string;
      primaryBenefit?: string;
      annualFee?: number;
      visibility?: "private" | "friends" | "public";
      cardNumber?: string;
      expiryDate?: string;
      cardHolderName?: string;
    }
  ): Promise<boolean> {
    if (!supabaseAdmin) return false;

    const { error } = await supabaseAdmin.from("user_cards").upsert(
      {
        user_id: userId,
        card_name: cardData.cardName,
        bank_name: cardData.bankName,
        card_type: cardData.cardType,
        card_network: cardData.cardNetwork || "Unknown",
        primary_benefit: cardData.primaryBenefit,
        annual_fee: cardData.annualFee,
        card_number: cardData.cardNumber,
        expiry_date: cardData.expiryDate,
        card_holder_name: cardData.cardHolderName,
        detected_from: "gmail_scan",
        detection_confidence: 1.0,
        visibility: cardData.visibility || "friends",
        is_active: true,
        is_verified: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,card_name,bank_name" }
    );

    return !error;
  }

  // Method to get ALL user cards (including inactive ones)
  async getUserCardsAll(userId: string, forceRefresh: boolean = false) {
    try {
      if (!supabaseAdmin) {
        throw new Error("Supabase admin not configured");
      }

      // Check cache first
      const cacheKey = `user_cards_all_${userId}`;
      if (!forceRefresh && this.cardCache.has(cacheKey)) {
        const cached = this.cardCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
          // 5 minutes cache
          return cached.data;
        }
      }

      // Fetch ALL cards from database (including inactive ones)
      const { data: cards, error } = await supabaseAdmin
        .from("user_cards")
        .select(
          `
          id,
          card_name,
          bank_name,
          card_type,
          card_network,
          last_four_digits,
          annual_fee,
          rewards_type,
          primary_benefit,
          visibility,
          is_active,
          is_verified,
          detection_confidence,
          detected_from,
          created_at,
          updated_at
        `
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching all user cards:", error);
        throw error;
      }

      // Transform and cache the data
      const transformedCards = (cards || []).map((card) => ({
        id: card.id,
        cardName: card.card_name || "Unknown Card",
        bankName: card.bank_name || "Unknown Bank",
        cardType: card.card_type || "Credit Card",
        cardNetwork: card.card_network || "Unknown",
        lastFourDigits: card.last_four_digits || "****",
        annualFee: card.annual_fee || 0,
        rewardsType: card.rewards_type || "Points",
        primaryBenefit: card.primary_benefit || "Standard benefits",
        visibility: card.visibility || "friends",
        isActive: card.is_active || false,
        isVerified: card.is_verified || false,
        detectionConfidence: card.detection_confidence || 0,
        detectedFrom: card.detected_from || "unknown",
        createdAt: card.created_at,
        updatedAt: card.updated_at,
      }));

      // Cache the result
      this.cardCache.set(cacheKey, {
        data: transformedCards,
        timestamp: Date.now(),
      });

      return transformedCards;
    } catch (error) {
      console.error("Error in getUserCardsAll:", error);
      throw error;
    }
  }

  // Optimized method to get user cards with caching
  async getUserCardsOptimized(userId: string, forceRefresh: boolean = false) {
    try {
      if (!supabaseAdmin) {
        throw new Error("Supabase admin not configured");
      }

      // Check cache first (implemented as a simple in-memory cache for now)
      const cacheKey = `user_cards_${userId}`;
      if (!forceRefresh && this.cardCache.has(cacheKey)) {
        const cached = this.cardCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
          // 5 minutes cache
          return cached.data;
        }
      }

      // Fetch from database with optimized query
      const { data: cards, error } = await supabaseAdmin
        .from("user_cards")
        .select(
          `
          id,
          card_name,
          bank_name,
          card_type,
          card_network,
          last_four_digits,
          annual_fee,
          rewards_type,
          primary_benefit,
          visibility,
          is_active,
          is_verified,
          created_at,
          updated_at
        `
        )
        .eq("user_id", userId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching user cards:", error);
        throw error;
      }

      // Transform and cache the data
      const transformedCards = (cards || []).map((card) => ({
        id: card.id,
        cardName: card.card_name || "Unknown Card",
        bankName: card.bank_name || "Unknown Bank",
        cardType: card.card_type || "Credit Card",
        cardNetwork: card.card_network || "Unknown",
        lastFourDigits: card.last_four_digits || "****",
        annualFee: card.annual_fee || 0,
        rewardsType: card.rewards_type || "Points",
        primaryBenefit: card.primary_benefit || "Standard benefits",
        visibility: card.visibility || "friends",
        isActive: card.is_active || true,
        isVerified: card.is_verified || false,
        createdAt: card.created_at,
        updatedAt: card.updated_at,
      }));

      // Cache the result
      this.cardCache.set(cacheKey, {
        data: transformedCards,
        timestamp: Date.now(),
      });

      return transformedCards;
    } catch (error) {
      console.error("Error in getUserCardsOptimized:", error);
      throw error;
    }
  }

  // Optimized method to get friends' cards with smart discovery
  async getFriendsCardsOptimized(
    userId: string,
    forceRefresh: boolean = false
  ) {
    try {
      if (!supabaseAdmin) {
        throw new Error("Supabase admin not configured");
      }

      const cacheKey = `friends_cards_${userId}`;
      if (!forceRefresh && this.cardCache.has(cacheKey)) {
        const cached = this.cardCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
          // 10 minutes cache
          return cached.data;
        }
      }

      // Get friends through invite system (optimized query)
      const { data: friendships, error: friendshipError } = await supabaseAdmin
        .from("friend_relationships")
        .select("friend_id, user_id, created_at")
        .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
        .eq("status", "accepted")
        .order("created_at", { ascending: false });

      if (friendshipError) {
        console.error("Error fetching friendships:", friendshipError);
        throw friendshipError;
      }

      const friendIds = new Set<string>();
      for (const friendship of friendships || []) {
        if (friendship.user_id === userId) {
          friendIds.add(friendship.friend_id);
        } else {
          friendIds.add(friendship.user_id);
        }
      }

      if (friendIds.size === 0) {
        return {
          friends: [],
          friendCards: [],
          totalFriends: 0,
          totalCards: 0,
          message: "No friends found. Invite friends to see their cards!",
        };
      }

      // Get friend details and their cards in a single optimized query
      const friendIdsArray = Array.from(friendIds);

      // Get all users in one query
      const { data: allUsers, error: usersError } =
        await supabaseAdmin.auth.admin.listUsers();
      if (usersError) {
        console.error("Error fetching users:", usersError);
        throw usersError;
      }

      const friends = allUsers.users
        .filter((user) => friendIdsArray.includes(user.id))
        .map((user) => ({
          id: user.id,
          name:
            user.user_metadata?.full_name ||
            user.email?.split("@")[0] ||
            "Unknown",
          email: user.email,
          avatar: user.user_metadata?.avatar_url,
          joinedAt: user.created_at,
        }));

      // Get all cards from friends in one query
      const { data: allCards, error: cardsError } = await supabaseAdmin
        .from("user_cards")
        .select(
          `
          id,
          user_id,
          card_name,
          bank_name,
          card_type,
          card_network,
          last_four_digits,
          annual_fee,
          rewards_type,
          primary_benefit,
          visibility,
          is_active,
          is_verified,
          created_at
        `
        )
        .in("user_id", friendIdsArray)
        .in("visibility", ["friends", "public"])
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (cardsError) {
        console.error("Error fetching friend cards:", cardsError);
        throw cardsError;
      }

      // Group cards by friend with optimized data structure
      const friendCardsMap = new Map();

      for (const friend of friends) {
        friendCardsMap.set(friend.id, {
          friend,
          cards: [],
          totalCards: 0,
          cardTypes: new Set(),
          banks: new Set(),
        });
      }

      // Process cards and group them
      for (const card of allCards || []) {
        const friendData = friendCardsMap.get(card.user_id);
        if (friendData) {
          const transformedCard = {
            id: card.id,
            cardName: card.card_name || "Unknown Card",
            bankName: card.bank_name || "Unknown Bank",
            cardType: card.card_type || "Credit Card",
            cardNetwork: card.card_network || "Unknown",
            lastFourDigits: card.last_four_digits || "****",
            annualFee: card.annual_fee || 0,
            rewardsType: card.rewards_type || "Points",
            primaryBenefit: card.primary_benefit || "Standard benefits",
            visibility: card.visibility || "friends",
            isVerified: card.is_verified || false,
            createdAt: card.created_at,
          };

          friendData.cards.push(transformedCard);
          friendData.totalCards++;
          friendData.cardTypes.add(card.card_type || "Credit Card");
          friendData.banks.add(card.bank_name || "Unknown Bank");
        }
      }

      // Convert to array and add analytics
      const friendCards = Array.from(friendCardsMap.values())
        .filter((friendData) => friendData.cards.length > 0)
        .map((friendData) => ({
          ...friendData,
          cardTypes: Array.from(friendData.cardTypes),
          banks: Array.from(friendData.banks),
        }));

      const result = {
        friends,
        friendCards,
        totalFriends: friends.length,
        totalCards: allCards?.length || 0,
        analytics: {
          totalFriendsWithCards: friendCards.length,
          averageCardsPerFriend:
            friendCards.length > 0
              ? (allCards?.length || 0) / friendCards.length
              : 0,
          mostCommonCardType: this.getMostCommon(
            allCards?.map((c) => c.card_type) || []
          ),
          mostCommonBank: this.getMostCommon(
            allCards?.map((c) => c.bank_name) || []
          ),
        },
      };

      // Cache the result
      this.cardCache.set(cacheKey, {
        data: result,
        timestamp: Date.now(),
      });

      return result;
    } catch (error) {
      console.error("Error in getFriendsCardsOptimized:", error);
      throw error;
    }
  }

  // Helper method to get most common item
  private getMostCommon<T>(items: T[]): T | null {
    if (items.length === 0) return null;

    const counts = new Map<T, number>();
    for (const item of items) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }

    let maxCount = 0;
    let mostCommon: T | null = null;

    for (const [item, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = item;
      }
    }

    return mostCommon;
  }

  // Clear cache for a specific user
  clearUserCache(userId: string) {
    this.cardCache.delete(`user_cards_${userId}`);
    this.cardCache.delete(`user_cards_all_${userId}`);
    this.cardCache.delete(`friends_cards_${userId}`);
  }

  // Clear all cache
  clearAllCache() {
    this.cardCache.clear();
  }

  // Add card request functionality
  async requestCardUsage(
    userId: string,
    friendId: string,
    cardId: string,
    requestMessage?: string
  ) {
    try {
      if (!supabaseAdmin) {
        throw new Error("Supabase admin not configured");
      }

      // Verify the card exists and belongs to the friend
      const { data: card, error: cardError } = await supabaseAdmin
        .from("user_cards")
        .select("id, user_id, card_name, visibility")
        .eq("id", cardId)
        .eq("user_id", friendId)
        .single();

      if (cardError || !card) {
        throw new Error("Card not found or access denied");
      }

      if (card.visibility === "private") {
        throw new Error("This card is private and cannot be requested");
      }

      // Check if there's already a pending request
      const { data: existingRequest } = await supabaseAdmin
        .from("card_requests")
        .select("id, status")
        .eq("requester_id", userId)
        .eq("card_id", cardId)
        .eq("status", "pending")
        .single();

      if (existingRequest) {
        throw new Error("You already have a pending request for this card");
      }

      // Create the card request
      const { data: request, error: requestError } = await supabaseAdmin
        .from("card_requests")
        .insert({
          requester_id: userId,
          card_owner_id: friendId,
          card_id: cardId,
          request_message: requestMessage || `Request to use ${card.card_name}`,
          status: "pending",
          requested_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (requestError) {
        console.error("Error creating card request:", requestError);
        throw requestError;
      }

      return {
        success: true,
        requestId: request.id,
        message: "Card request sent successfully",
        card: {
          id: card.id,
          cardName: card.card_name,
        },
      };
    } catch (error) {
      console.error("Error in requestCardUsage:", error);
      throw error;
    }
  }

  // Get pending card requests for a user
  async getPendingCardRequests(userId: string) {
    try {
      if (!supabaseAdmin) {
        throw new Error("Supabase admin not configured");
      }

      // Get requests where user is the card owner
      const { data: receivedRequests, error: receivedError } =
        await supabaseAdmin
          .from("card_requests")
          .select(
            `
          id,
          requester_id,
          card_id,
          request_message,
          status,
          requested_at,
          user_cards!inner(
            card_name,
            bank_name,
            card_type
          )
        `
          )
          .eq("card_owner_id", userId)
          .eq("status", "pending")
          .order("requested_at", { ascending: false });

      if (receivedError) {
        console.error("Error fetching received requests:", receivedError);
        throw receivedError;
      }

      // Get requests where user is the requester
      const { data: sentRequests, error: sentError } = await supabaseAdmin
        .from("card_requests")
        .select(
          `
          id,
          card_owner_id,
          card_id,
          request_message,
          status,
          requested_at,
          user_cards!inner(
            card_name,
            bank_name,
            card_type
          )
        `
        )
        .eq("requester_id", userId)
        .order("requested_at", { ascending: false });

      if (sentError) {
        console.error("Error fetching sent requests:", sentError);
        throw sentError;
      }

      return {
        receivedRequests: receivedRequests || [],
        sentRequests: sentRequests || [],
        totalReceived: receivedRequests?.length || 0,
        totalSent: sentRequests?.length || 0,
      };
    } catch (error) {
      console.error("Error in getPendingCardRequests:", error);
      throw error;
    }
  }

  // Accept or reject a card request
  async respondToCardRequest(
    requestId: string,
    userId: string,
    action: "accept" | "reject",
    responseMessage?: string
  ) {
    try {
      if (!supabaseAdmin) {
        throw new Error("Supabase admin not configured");
      }

      // Verify the request exists and user owns the card
      const { data: request, error: requestError } = await supabaseAdmin
        .from("card_requests")
        .select("id, card_owner_id, requester_id, card_id, status")
        .eq("id", requestId)
        .eq("card_owner_id", userId)
        .eq("status", "pending")
        .single();

      if (requestError || !request) {
        throw new Error("Request not found or already processed");
      }

      // Update the request status
      const { error: updateError } = await supabaseAdmin
        .from("card_requests")
        .update({
          status: action,
          response_message: responseMessage,
          responded_at: new Date().toISOString(),
        })
        .eq("id", requestId);

      if (updateError) {
        console.error("Error updating card request:", updateError);
        throw updateError;
      }

      return {
        success: true,
        message: `Card request ${action}ed successfully`,
        requestId,
        action,
      };
    } catch (error) {
      console.error("Error in respondToCardRequest:", error);
      throw error;
    }
  }
}
