// Test script to check user_cards table directly
// Run this with: node -r dotenv/config test-cards-direct.js

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

async function testCardsDirect() {
  try {
    console.log("🧪 Testing user_cards table directly...\n");

    // Get all cards from user_cards table
    const { data: allCards, error } = await supabase
      .from("user_cards")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching cards:", error);
      return;
    }

    console.log(`📊 Total cards in user_cards table: ${allCards.length}\n`);

    // Group by user_id
    const cardsByUser = {};
    allCards.forEach((card) => {
      if (!cardsByUser[card.user_id]) {
        cardsByUser[card.user_id] = [];
      }
      cardsByUser[card.user_id].push(card);
    });

    // Test each user's cards
    for (const [userId, cards] of Object.entries(cardsByUser)) {
      console.log(`👤 User ID: ${userId}`);
      console.log(`   Total cards: ${cards.length}`);

      // Test 1: All cards for this user
      console.log("\n   📋 Test 1: All cards for this user:");
      cards.forEach((card, index) => {
        console.log(`   ${index + 1}. ${card.card_name} (${card.bank_name})`);
        console.log(
          `      Active: ${card.is_active} | Verified: ${card.is_verified} | Confidence: ${card.detection_confidence}`
        );
        console.log(
          `      Source: ${card.detected_from} | Created: ${new Date(
            card.created_at
          ).toLocaleString()}`
        );
        console.log("");
      });

      // Test 2: Only active cards
      const activeCards = cards.filter((card) => card.is_active);
      console.log(`   📋 Test 2: Active cards only (${activeCards.length}):`);
      activeCards.forEach((card, index) => {
        console.log(
          `   ${index + 1}. ${card.card_name} - Confidence: ${
            card.detection_confidence
          }`
        );
      });

      // Test 3: High confidence cards (≥0.8)
      const highConfidenceCards = cards.filter(
        (card) => card.is_active && card.detection_confidence >= 0.8
      );
      console.log(
        `\n   📋 Test 3: High confidence cards (≥0.8) (${highConfidenceCards.length}):`
      );
      highConfidenceCards.forEach((card, index) => {
        console.log(
          `   ${index + 1}. ${card.card_name} - Confidence: ${
            card.detection_confidence
          }`
        );
      });

      // Test 4: Simulate the exact getUserCardsOptimized query
      console.log(`\n   📋 Test 4: Simulating getUserCardsOptimized query:`);
      const optimizedQueryCards = cards.filter((card) => card.is_active);
      console.log(
        `   Query: SELECT * FROM user_cards WHERE user_id = '${userId}' AND is_active = true`
      );
      console.log(`   Result: ${optimizedQueryCards.length} cards`);
      optimizedQueryCards.forEach((card, index) => {
        console.log(
          `   ${index + 1}. ${card.card_name} - Active: ${
            card.is_active
          } - Verified: ${card.is_verified}`
        );
      });

      console.log("\n   🔍 Analysis:");
      console.log(`   - Total cards: ${cards.length}`);
      console.log(`   - Active cards: ${activeCards.length}`);
      console.log(`   - High confidence cards: ${highConfidenceCards.length}`);
      console.log(
        `   - Optimized query should return: ${optimizedQueryCards.length}`
      );

      if (activeCards.length !== optimizedQueryCards.length) {
        console.log(
          "   ⚠️  WARNING: Active cards count differs from optimized query!"
        );
      }

      console.log("─".repeat(80));
    }

    // Check if there are any users in auth.users
    console.log("\n🔍 Checking auth.users table...");
    const { data: users, error: usersError } =
      await supabase.auth.admin.listUsers();
    if (usersError) {
      console.log("   Error accessing auth.users:", usersError.message);
    } else {
      console.log(`   Users in auth.users: ${users.data?.length || 0}`);
      if (users.data && users.data.length > 0) {
        users.data.forEach((user, index) => {
          console.log(`   ${index + 1}. ${user.id} - ${user.email}`);
        });
      }
    }

    console.log("\n✅ Direct test complete!");
  } catch (error) {
    console.error("Test error:", error);
  }
}

// Run the test
testCardsDirect();
