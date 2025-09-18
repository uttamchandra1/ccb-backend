import { Router } from "express";
import {
  getFriendsCards,
  upsertMyCards,
} from "../controllers/cards.controller";
import { CardDetectionService } from "../services/CardDetectionService";
import supabase, { supabaseAdmin } from "../app/supabase";

const router = Router();
const cardService = new CardDetectionService();

// Toggle card activation status
router.post("/cards/:cardId/toggle-status", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
    }
    const token = authHeader.substring(7);
    const { data: userData, error } = await supabase.auth.getUser(token);
    if (error || !userData.user) {
      return res.status(401).json({ error: error?.message || "Invalid token" });
    }
    const userId = userData.user.id;

    const { cardId } = req.params;

    if (!supabaseAdmin) {
      return res.status(500).json({
        error: "Server not configured with SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    // Get current card status
    const { data: card, error: cardError } = await supabaseAdmin
      .from("user_cards")
      .select("id, is_active, card_name")
      .eq("id", cardId)
      .eq("user_id", userId)
      .single();

    if (cardError || !card) {
      return res.status(404).json({ error: "Card not found" });
    }

    // Toggle the status
    const newStatus = !card.is_active;
    const { error: updateError } = await supabaseAdmin
      .from("user_cards")
      .update({
        is_active: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cardId)
      .eq("user_id", userId);

    if (updateError) {
      console.error("Error updating card status:", updateError);
      return res.status(500).json({ error: updateError.message });
    }

    // Clear cache for this user
    cardService.clearUserCache(userId);

    res.json({
      success: true,
      message: `Card ${newStatus ? "activated" : "deactivated"} successfully`,
      cardId,
      cardName: card.card_name,
      isActive: newStatus,
    });
  } catch (error: any) {
    console.error("Toggle card status error:", error);
    res.status(500).json({
      error: error?.message || "Failed to toggle card status",
    });
  }
});

// Get user's cards (optimized) - Updated to show all cards by default
router.get("/cards/my-cards", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
    }
    const token = authHeader.substring(7);
    const { data: userData, error } = await supabase.auth.getUser(token);
    if (error || !userData.user) {
      return res.status(401).json({ error: error?.message || "Invalid token" });
    }
    const userId = userData.user.id;

    // Use optimized method with caching
    const forceRefresh = req.query.refresh === "true";
    const showAll = req.query.showAll === "true"; // New parameter to show all cards

    let cards;
    if (showAll) {
      // Show all cards including inactive ones
      cards = await cardService.getUserCardsAll(userId, forceRefresh);
    } else {
      // Show only active cards (default behavior)
      cards = await cardService.getUserCardsOptimized(userId, forceRefresh);
    }

    res.json({
      success: true,
      cards: cards,
      total: cards.length,
      cached: !forceRefresh,
      showAll: showAll,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res
      .status(500)
      .json({ error: error?.message || "Failed to get user cards" });
  }
});

// Automatic Gmail scanning and card detection
router.post("/cards/scan-gmail", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
    }
    const token = authHeader.substring(7);
    const { data: userData, error } = await supabase.auth.getUser(token);
    if (error || !userData.user) {
      return res.status(401).json({ error: error?.message || "Invalid token" });
    }
    const userId = userData.user.id;

    if (!supabaseAdmin) {
      return res.status(500).json({
        error: "Server not configured with SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    // Get user's Google tokens
    const { data: googleTokens } = await supabaseAdmin
      .from("user_google_tokens")
      .select("access_token, refresh_token")
      .eq("user_id", userId)
      .single();

    if (!googleTokens?.access_token) {
      console.log(
        `No Google tokens found for user ${userId}. Using sample data instead.`
      );

      // Return sample cards instead of error
      return res.json({
        success: true,
        message: "No Gmail access. Using sample cards for demonstration.",
        cardsScanned: 0,
        cardsStored: 0,
        cards: [],
        fallback: true,
      });
    }

    console.log(`Starting Gmail scan for user ${userId}...`);

    // Create OAuth2 client for Google APIs
    const { OAuth2Client } = await import("google-auth-library");
    const oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    // Set credentials
    oauth2Client.setCredentials({
      access_token: googleTokens.access_token,
      refresh_token: googleTokens.refresh_token,
    });

    // Handle token refresh if needed
    oauth2Client.on("tokens", async (tokens) => {
      if (tokens.refresh_token && supabaseAdmin) {
        // Update the refresh token in database
        await supabaseAdmin
          .from("user_google_tokens")
          .update({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
          })
          .eq("user_id", userId);
      }
    });

    // Scan Gmail for credit cards with enhanced detection
    console.log(`Starting enhanced Gmail scan for user ${userId}...`);
    const scanResults = await cardService.scanGmailForCards(
      userId,
      oauth2Client
    );

    console.log(
      `Enhanced Gmail scan completed for user ${userId}. Found ${scanResults.length} email results.`
    );

    // Extract and store detected cards from scan results
    const storedCards = [];
    const skippedCards = [];
    // Deduplicate across all emails in this scan by (bank + normalized name)
    const seenKeys = new Set<string>();

    const normalizeName = (name: string) =>
      (name || "").replace(/\s+/g, " ").trim();

    for (const emailResult of scanResults) {
      console.log(
        `Processing ${emailResult.emailType} email from ${emailResult.sender} with confidence ${emailResult.confidence}`
      );

      for (const card of emailResult.matchedCards) {
        try {
          const normalizedName = normalizeName(card.name);
          const key = `${card.bank}|${normalizedName}`.toLowerCase();
          if (seenKeys.has(key)) {
            skippedCards.push({ ...card, reason: "Duplicate in this scan" });
            continue;
          }
          // Store all detected cards regardless of confidence
          const success = await cardService.addManualCard(userId, {
            cardName: normalizedName,
            bankName: card.bank,
            cardType: "Credit Card",
            cardNetwork: card.network,
            primaryBenefit: card.benefits,
            annualFee: card.annualFee,
            cardNumber: card.cardNumber,
            expiryDate: card.expiryDate,
            cardHolderName: card.cardHolderName,
          });

          if (success) {
            storedCards.push({
              ...card,
              emailType: emailResult.emailType,
              emailConfidence: emailResult.confidence,
            });
            seenKeys.add(key);
          } else {
            skippedCards.push({
              ...card,
              reason: "Storage rejected",
            });
          }
        } catch (error: any) {
          console.error(`Failed to store card ${card.name}:`, error);
          skippedCards.push({
            ...card,
            reason: "Storage error",
            error: error?.message || "Unknown error",
          });
        }
      }
    }

    res.json({
      success: true,
      message: "Enhanced Gmail scan completed successfully",
      cardsScanned: scanResults.length,
      cardsStored: storedCards.length,
      cardsSkipped: skippedCards.length,
      cards: storedCards,
      skippedCards: skippedCards,
      scanSummary: {
        highConfidenceEmails: scanResults.filter((r) => r.confidence >= 0.9)
          .length,
        mediumConfidenceEmails: scanResults.filter(
          (r) => r.confidence >= 0.7 && r.confidence < 0.9
        ).length,
        statementEmails: scanResults.filter((r) => r.emailType === "statement")
          .length,
        transactionEmails: scanResults.filter(
          (r) => r.emailType === "transaction"
        ).length,
      },
    });
  } catch (error: any) {
    console.error("Gmail scan error:", error);
    res.status(500).json({
      error: error?.message || "Failed to scan Gmail for cards",
    });
  }
});

// Get friends' cards (optimized)
router.get("/cards/friends-cards", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
    }
    const token = authHeader.substring(7);
    const { data: userData, error } = await supabase.auth.getUser(token);
    if (error || !userData.user) {
      return res.status(401).json({ error: error?.message || "Invalid token" });
    }
    const userId = userData.user.id;

    // Use optimized method with caching
    const forceRefresh = req.query.refresh === "true";
    const friendsCards = await cardService.getFriendsCardsOptimized(
      userId,
      forceRefresh
    );

    res.json({
      success: true,
      ...friendsCards,
      cached: !forceRefresh,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res
      .status(500)
      .json({ error: error?.message || "Failed to get friends' cards" });
  }
});

// Request to use a friend's card
router.post("/cards/request-usage", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
    }
    const token = authHeader.substring(7);
    const { data: userData, error } = await supabase.auth.getUser(token);
    if (error || !userData.user) {
      return res.status(401).json({ error: error?.message || "Invalid token" });
    }
    const userId = userData.user.id;

    const { friendId, cardId, requestMessage } = req.body;

    if (!friendId || !cardId) {
      return res.status(400).json({
        error: "friendId and cardId are required",
      });
    }

    const result = await cardService.requestCardUsage(
      userId,
      friendId,
      cardId,
      requestMessage
    );

    res.json(result);
  } catch (error: any) {
    res.status(500).json({
      error: error?.message || "Failed to request card usage",
    });
  }
});

// Get pending card requests
router.get("/cards/requests", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
    }
    const token = authHeader.substring(7);
    const { data: userData, error } = await supabase.auth.getUser(token);
    if (error || !userData.user) {
      return res.status(401).json({ error: error?.message || "Invalid token" });
    }
    const userId = userData.user.id;

    const requests = await cardService.getPendingCardRequests(userId);

    res.json({
      success: true,
      ...requests,
    });
  } catch (error: any) {
    res.status(500).json({
      error: error?.message || "Failed to get card requests",
    });
  }
});

// Respond to a card request (accept/reject)
router.post("/cards/requests/:requestId/respond", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
    }
    const token = authHeader.substring(7);
    const { data: userData, error } = await supabase.auth.getUser(token);
    if (error || !userData.user) {
      return res.status(401).json({ error: error?.message || "Invalid token" });
    }
    const userId = userData.user.id;

    const { requestId } = req.params;
    const { action, responseMessage } = req.body;

    if (!action || !["accept", "reject"].includes(action)) {
      return res.status(400).json({
        error: "action must be 'accept' or 'reject'",
      });
    }

    const result = await cardService.respondToCardRequest(
      requestId,
      userId,
      action,
      responseMessage
    );

    res.json(result);
  } catch (error: any) {
    res.status(500).json({
      error: error?.message || "Failed to respond to card request",
    });
  }
});

// Clear user's card cache
router.post("/cards/clear-cache", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
    }
    const token = authHeader.substring(7);
    const { data: userData, error } = await supabase.auth.getUser(token);
    if (error || !userData.user) {
      return res.status(401).json({ error: error?.message || "Invalid token" });
    }
    const userId = userData.user.id;

    cardService.clearUserCache(userId);

    res.json({
      success: true,
      message: "Cache cleared successfully",
    });
  } catch (error: any) {
    res.status(500).json({
      error: error?.message || "Failed to clear cache",
    });
  }
});

// Add sample cards for testing
router.post("/cards/add-sample", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
    }
    const token = authHeader.substring(7);
    const { data: userData, error } = await supabase.auth.getUser(token);
    if (error || !userData.user) {
      return res.status(401).json({ error: error?.message || "Invalid token" });
    }
    const userId = userData.user.id;

    if (!supabaseAdmin) {
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

    const { error: insertError } = await supabaseAdmin
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
  } catch (error: any) {
    res
      .status(500)
      .json({ error: error?.message || "Failed to add sample cards" });
  }
});

// Debug endpoint to see all cards for a user (including inactive ones)
router.get("/cards/debug-all", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
    }
    const token = authHeader.substring(7);
    const { data: userData, error } = await supabase.auth.getUser(token);
    if (error || !userData.user) {
      return res.status(401).json({ error: error?.message || "Invalid token" });
    }
    const userId = userData.user.id;

    if (!supabaseAdmin) {
      return res.status(500).json({
        error: "Server not configured with SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    // Get ALL cards for the user (including inactive ones)
    const { data: allCards, error: cardsError } = await supabaseAdmin
      .from("user_cards")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (cardsError) {
      console.error("Error fetching all user cards:", cardsError);
      return res.status(500).json({ error: cardsError.message });
    }

    // Get only active cards (what the frontend sees)
    const { data: activeCards, error: activeError } = await supabaseAdmin
      .from("user_cards")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (activeError) {
      console.error("Error fetching active user cards:", activeError);
      return res.status(500).json({ error: activeError.message });
    }

    // Get cards with high confidence
    const { data: highConfidenceCards, error: confidenceError } =
      await supabaseAdmin
        .from("user_cards")
        .select("*")
        .eq("user_id", userId)
        .gte("detection_confidence", 0.8)
        .order("created_at", { ascending: false });

    if (confidenceError) {
      console.error("Error fetching high confidence cards:", confidenceError);
      return res.status(500).json({ error: confidenceError.message });
    }

    res.json({
      success: true,
      debug: {
        totalCards: allCards?.length || 0,
        activeCards: activeCards?.length || 0,
        highConfidenceCards: highConfidenceCards?.length || 0,
        allCards:
          allCards?.map((card) => ({
            id: card.id,
            cardName: card.card_name,
            bankName: card.bank_name,
            isActive: card.is_active,
            isVerified: card.is_verified,
            detectionConfidence: card.detection_confidence,
            detectedFrom: card.detected_from,
            visibility: card.visibility,
            createdAt: card.created_at,
            updatedAt: card.updated_at,
          })) || [],
        activeCardsList:
          activeCards?.map((card) => ({
            id: card.id,
            cardName: card.card_name,
            bankName: card.bank_name,
            isActive: card.is_active,
            isVerified: card.is_verified,
            detectionConfidence: card.detection_confidence,
            detectedFrom: card.detected_from,
            visibility: card.visibility,
            createdAt: card.created_at,
            updatedAt: card.updated_at,
          })) || [],
        summary: {
          inactiveCards: (allCards?.length || 0) - (activeCards?.length || 0),
          lowConfidenceCards:
            (allCards?.length || 0) - (highConfidenceCards?.length || 0),
          unverifiedCards:
            allCards?.filter((card) => !card.is_verified).length || 0,
          gmailScannedCards:
            allCards?.filter((card) => card.detected_from === "gmail_scan")
              .length || 0,
          manualEntryCards:
            allCards?.filter((card) => card.detected_from === "manual_entry")
              .length || 0,
        },
      },
    });
  } catch (error: any) {
    console.error("Debug endpoint error:", error);
    res.status(500).json({
      error: error?.message || "Failed to get debug information",
    });
  }
});

// Simple endpoint to show all cards without any filtering
router.get("/cards/all-cards", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
    }
    const token = authHeader.substring(7);
    const { data: userData, error } = await supabase.auth.getUser(token);
    if (error || !userData.user) {
      return res.status(401).json({ error: error?.message || "Invalid token" });
    }
    const userId = userData.user.id;

    if (!supabaseAdmin) {
      return res.status(500).json({
        error: "Server not configured with SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    // Get ALL cards for the user without any filtering
    const { data: allCards, error: cardsError } = await supabaseAdmin
      .from("user_cards")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (cardsError) {
      console.error("Error fetching all cards:", cardsError);
      return res.status(500).json({ error: cardsError.message });
    }

    // Transform the data
    const transformedCards = (allCards || []).map((card) => ({
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

    res.json({
      success: true,
      message: "All cards retrieved successfully",
      cards: transformedCards,
      total: transformedCards.length,
      activeCards: transformedCards.filter((card) => card.isActive).length,
      inactiveCards: transformedCards.filter((card) => !card.isActive).length,
      highConfidenceCards: transformedCards.filter(
        (card) => card.detectionConfidence >= 0.8
      ).length,
      lowConfidenceCards: transformedCards.filter(
        (card) => card.detectionConfidence < 0.8
      ).length,
      verifiedCards: transformedCards.filter((card) => card.isVerified).length,
      unverifiedCards: transformedCards.filter((card) => !card.isVerified)
        .length,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("All cards endpoint error:", error);
    res.status(500).json({
      error: error?.message || "Failed to get all cards",
    });
  }
});

router.post("/me/cards", upsertMyCards);
router.get("/friends/cards", getFriendsCards);

export default router;
