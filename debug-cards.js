// Debug script to check card status in database
// Run this with: node debug-cards.js

const { createClient } = require("@supabase/supabase-js");

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_API_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(
    "Please set SUPABASE_API_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY environment variables"
  );
  console.error(
    "Available env vars:",
    Object.keys(process.env).filter((key) => key.includes("SUPABASE"))
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function debugCards() {
  try {
    console.log("🔍 Debugging card status in database...\n");

    // Get all cards from the database
    const { data: allCards, error } = await supabase
      .from("user_cards")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching cards:", error);
      return;
    }

    console.log(`📊 Total cards in database: ${allCards.length}\n`);

    // Group cards by user
    const cardsByUser = {};
    allCards.forEach((card) => {
      if (!cardsByUser[card.user_id]) {
        cardsByUser[card.user_id] = [];
      }
      cardsByUser[card.user_id].push(card);
    });

    // Analyze each user's cards
    for (const [userId, cards] of Object.entries(cardsByUser)) {
      console.log(`👤 User: ${userId}`);
      console.log(`   Total cards: ${cards.length}`);

      const activeCards = cards.filter((card) => card.is_active);
      const inactiveCards = cards.filter((card) => !card.is_active);
      const verifiedCards = cards.filter((card) => card.is_verified);
      const unverifiedCards = cards.filter((card) => !card.is_verified);
      const highConfidenceCards = cards.filter(
        (card) => card.detection_confidence >= 0.8
      );
      const lowConfidenceCards = cards.filter(
        (card) => card.detection_confidence < 0.8
      );

      console.log(`   Active cards: ${activeCards.length}`);
      console.log(`   Inactive cards: ${inactiveCards.length}`);
      console.log(`   Verified cards: ${verifiedCards.length}`);
      console.log(`   Unverified cards: ${unverifiedCards.length}`);
      console.log(`   High confidence (≥0.8): ${highConfidenceCards.length}`);
      console.log(`   Low confidence (<0.8): ${lowConfidenceCards.length}`);

      console.log("\n   📋 Card Details:");
      cards.forEach((card, index) => {
        console.log(`   ${index + 1}. ${card.card_name} (${card.bank_name})`);
        console.log(
          `      Status: ${card.is_active ? "✅ Active" : "❌ Inactive"}`
        );
        console.log(`      Verified: ${card.is_verified ? "✅ Yes" : "❌ No"}`);
        console.log(`      Confidence: ${card.detection_confidence}`);
        console.log(`      Source: ${card.detected_from}`);
        console.log(
          `      Created: ${new Date(card.created_at).toLocaleString()}`
        );
        console.log("");
      });

      console.log("─".repeat(80));
    }

    // Summary statistics
    console.log("\n📈 SUMMARY STATISTICS:");
    console.log(`Total cards: ${allCards.length}`);
    console.log(
      `Active cards: ${allCards.filter((card) => card.is_active).length}`
    );
    console.log(
      `Inactive cards: ${allCards.filter((card) => !card.is_active).length}`
    );
    console.log(
      `Verified cards: ${allCards.filter((card) => card.is_verified).length}`
    );
    console.log(
      `Unverified cards: ${allCards.filter((card) => !card.is_verified).length}`
    );
    console.log(
      `High confidence cards: ${
        allCards.filter((card) => card.detection_confidence >= 0.8).length
      }`
    );
    console.log(
      `Low confidence cards: ${
        allCards.filter((card) => card.detection_confidence < 0.8).length
      }`
    );
    console.log(
      `Gmail scanned cards: ${
        allCards.filter((card) => card.detected_from === "gmail_scan").length
      }`
    );
    console.log(
      `Manual entry cards: ${
        allCards.filter((card) => card.detected_from === "manual_entry").length
      }`
    );

    // Identify potential issues
    console.log("\n🔍 POTENTIAL ISSUES:");
    const inactiveCards = allCards.filter((card) => !card.is_active);
    if (inactiveCards.length > 0) {
      console.log(
        `❌ Found ${inactiveCards.length} inactive cards that won't show in frontend:`
      );
      inactiveCards.forEach((card) => {
        console.log(
          `   - ${card.card_name} (${card.bank_name}) - Confidence: ${card.detection_confidence}`
        );
      });
    }

    const lowConfidenceCards = allCards.filter(
      (card) => card.detection_confidence < 0.8
    );
    if (lowConfidenceCards.length > 0) {
      console.log(
        `⚠️  Found ${lowConfidenceCards.length} low confidence cards:`
      );
      lowConfidenceCards.forEach((card) => {
        console.log(
          `   - ${card.card_name} (${card.bank_name}) - Confidence: ${card.detection_confidence}`
        );
      });
    }

    console.log("\n✅ Debug complete!");
  } catch (error) {
    console.error("Debug error:", error);
  }
}

// Run the debug function
debugCards();
