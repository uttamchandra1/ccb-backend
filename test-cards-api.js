// Test script to check what the cards API returns
// Run this with: node -r dotenv/config test-cards-api.js

const { createClient } = require("@supabase/supabase-js");

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_API_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(
    "Please set SUPABASE_API_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY environment variables"
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testCardsAPI() {
  try {
    console.log("🧪 Testing cards API logic...\n");

    // Get the first user
    const { data: users, error: usersError } =
      await supabase.auth.admin.listUsers();
    if (usersError || !users.data || users.data.length === 0) {
      console.error("No users found");
      return;
    }

    const userId = users.data[0].id;
    console.log(`👤 Testing with user: ${userId}\n`);

    // Test 1: Get all cards (what getUserCardsAll would return)
    console.log("📋 Test 1: All cards (including inactive):");
    const { data: allCards, error: allError } = await supabase
      .from("user_cards")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (allError) {
      console.error("Error fetching all cards:", allError);
    } else {
      console.log(`   Total cards: ${allCards.length}`);
      allCards.forEach((card, index) => {
        console.log(
          `   ${index + 1}. ${card.card_name} - Active: ${
            card.is_active
          } - Confidence: ${card.detection_confidence}`
        );
      });
    }

    // Test 2: Get only active cards (what getUserCardsOptimized would return)
    console.log("\n📋 Test 2: Only active cards:");
    const { data: activeCards, error: activeError } = await supabase
      .from("user_cards")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (activeError) {
      console.error("Error fetching active cards:", activeError);
    } else {
      console.log(`   Active cards: ${activeCards.length}`);
      activeCards.forEach((card, index) => {
        console.log(
          `   ${index + 1}. ${card.card_name} - Confidence: ${
            card.detection_confidence
          }`
        );
      });
    }

    // Test 3: Get high confidence cards only
    console.log("\n📋 Test 3: High confidence cards (≥0.8):");
    const { data: highConfidenceCards, error: highError } = await supabase
      .from("user_cards")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .gte("detection_confidence", 0.8)
      .order("created_at", { ascending: false });

    if (highError) {
      console.error("Error fetching high confidence cards:", highError);
    } else {
      console.log(`   High confidence cards: ${highConfidenceCards.length}`);
      highConfidenceCards.forEach((card, index) => {
        console.log(
          `   ${index + 1}. ${card.card_name} - Confidence: ${
            card.detection_confidence
          }`
        );
      });
    }

    // Test 4: Simulate the exact query from getUserCardsOptimized
    console.log("\n📋 Test 4: Exact getUserCardsOptimized query:");
    const { data: optimizedCards, error: optimizedError } = await supabase
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

    if (optimizedError) {
      console.error("Error fetching optimized cards:", optimizedError);
    } else {
      console.log(`   Optimized query cards: ${optimizedCards.length}`);
      optimizedCards.forEach((card, index) => {
        console.log(
          `   ${index + 1}. ${card.card_name} - Active: ${
            card.is_active
          } - Verified: ${card.is_verified}`
        );
      });
    }

    console.log("\n✅ API test complete!");
    console.log("\n🔍 Analysis:");
    console.log(`- Total cards in DB: ${allCards?.length || 0}`);
    console.log(`- Active cards: ${activeCards?.length || 0}`);
    console.log(`- High confidence cards: ${highConfidenceCards?.length || 0}`);
    console.log(`- Optimized query cards: ${optimizedCards?.length || 0}`);

    if (activeCards?.length !== optimizedCards?.length) {
      console.log(
        "\n⚠️  WARNING: Active cards count differs from optimized query count!"
      );
    }

    if (activeCards?.length === 7 && optimizedCards?.length === 3) {
      console.log(
        "\n🎯 FOUND THE ISSUE: The optimized query is missing some cards!"
      );
      console.log(
        "This suggests there might be a data transformation issue or missing fields."
      );
    }
  } catch (error) {
    console.error("Test error:", error);
  }
}

// Run the test
testCardsAPI();
