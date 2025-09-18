import { Request, Response } from "express";
import supabase, { supabaseAdmin } from "../app/supabase";

async function getUserFromToken(req: Request) {
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : undefined;
  const cookieToken = req.cookies?.["sb-access-token"] as string | undefined;
  const supabaseAccessToken = bearerToken || cookieToken;

  if (!supabaseAccessToken) {
    throw new Error("Missing Supabase access token");
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(
    supabaseAccessToken
  );
  if (userError || !userData.user) {
    throw new Error(userError?.message || "Invalid Supabase token");
  }

  return userData.user;
}

export async function upsertMyCards(req: Request, res: Response) {
  try {
    const user = await getUserFromToken(req);
    const userId = user.id;
    if (!supabaseAdmin) {
      return res.status(500).json({
        error: "Server not configured with SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const issuers = (req.body?.issuers || []) as string[];
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

    const { error } = await supabaseAdmin
      .from("user_cards")
      .upsert(rows, { onConflict: "user_id,card_name,bank_name" });

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true, upserted: rows.length });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to save cards" });
  }
}

export async function getFriendsCards(req: Request, res: Response) {
  try {
    const user = await getUserFromToken(req);
    const userId = user.id;
    if (!supabaseAdmin) {
      return res.status(500).json({
        error: "Server not configured with SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    // Get friends through invite system (primary method)
    const { data: friendships, error: friendshipError } = await supabaseAdmin
      .from("friend_relationships")
      .select("friend_id, user_id")
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
      .eq("status", "accepted");

    if (friendshipError) {
      console.error("Error fetching friendships:", friendshipError);
      return res.status(500).json({ error: friendshipError.message });
    }

    const friendIds = new Set<string>();
    for (const friendship of friendships || []) {
      if (friendship.user_id === userId) {
        friendIds.add(friendship.friend_id);
      } else {
        friendIds.add(friendship.user_id);
      }
    }

    // Fallback: Read contacts if no friends found through invite system
    if (friendIds.size === 0) {
      const { data: contacts, error: contactsError } = await supabaseAdmin
        .from("contacts")
        .select("email_addresses")
        .eq("user_id", userId)
        .limit(200);

      if (contactsError) {
        console.error("Error fetching contacts:", contactsError);
      } else {
        const emails = new Set<string>();
        for (const c of contacts || []) {
          const arr = (c?.email_addresses || []) as Array<{ value?: string }>;
          for (const e of arr) {
            const v = (e?.value || "").trim().toLowerCase();
            if (v) emails.add(v);
          }
        }

        // Map contact emails to Supabase auth user ids (best-effort)
        if (emails.size > 0) {
          const limited = Array.from(emails).slice(0, 200);
          for (const email of limited) {
            try {
              const { data } = await supabaseAdmin.auth.admin.getUserById(
                email
              );
              const friendId = data?.user?.id;
              if (friendId && friendId !== userId) friendIds.add(friendId);
            } catch {
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
    const { data: friendUsers, error: usersError } =
      await supabaseAdmin.auth.admin.listUsers();

    if (usersError) {
      console.error("Error fetching users:", usersError);
      return res.status(500).json({ error: usersError.message });
    }

    const friends = friendUsers.users
      .filter((user) => friendIdsArray.includes(user.id))
      .map((user) => ({
        id: user.id,
        name: user.user_metadata?.full_name || user.email,
        email: user.email,
        avatar: user.user_metadata?.avatar_url,
      }));

    // Get cards from friends
    const { data: cardRows, error: cardsError } = await supabaseAdmin
      .from("user_cards")
      .select(
        "id, user_id, card_name, bank_name, card_type, card_network, visibility"
      )
      .in("user_id", friendIdsArray)
      .in("visibility", ["friends", "public"]);

    if (cardsError) {
      console.error("Error fetching friend cards:", cardsError);
      return res.status(500).json({ error: cardsError.message });
    }

    // Group cards by friend
    const friendCards: any[] = [];
    for (const friend of friends) {
      const friendCardRows =
        cardRows?.filter((card) => card.user_id === friend.id) || [];
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
    const counts: Record<string, number> = {};
    for (const r of cardRows || []) {
      const k = (r.bank_name || "").trim();
      if (!k) continue;
      counts[k] = (counts[k] || 0) + 1;
    }

    const banks = Object.keys(counts).sort();

    res.json({
      banks,
      counts,
      friends,
      friendCards,
      totalFriends: friends.length,
      totalCards: cardRows?.length || 0,
    });
  } catch (error: any) {
    console.error("Error in getFriendsCards:", error);
    res
      .status(500)
      .json({ error: error?.message || "Failed to get friends' cards" });
  }
}
