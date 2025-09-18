import { supabaseAdmin } from "../app/supabase";
import * as crypto from "crypto";

interface InviteCode {
  id: string;
  invite_code: string;
  inviter_user_id: string;
  code_type: "personal" | "group" | "event" | "promotional";
  max_uses: number;
  current_uses: number;
  expires_at: string;
  is_active: boolean;
  inviter_reward_type?: string;
  inviter_reward_amount?: number;
  invitee_reward_type?: string;
  invitee_reward_amount?: number;
  conversion_rate: number;
  total_clicks: number;
  total_registrations: number;
}

interface FriendRequest {
  id: string;
  user_id: string;
  friend_id: string;
  status: "pending" | "accepted" | "blocked" | "unfriended";
  relationship_type: "friend" | "family" | "colleague" | "acquaintance";
  connection_source: string;
  can_see_cards: boolean;
  can_see_activity: boolean;
  interaction_count: number;
}

interface InviteAnalytics {
  totalInvitesSent: number;
  totalInvitesUsed: number;
  totalNewUsers: number;
  totalFriendshipsCreated: number;
  conversionRate: number;
  topPerformingCodes: any[];
  recentActivity: any[];
}

export class ProfessionalInviteService {
  private normalizeInviteCode(input: string): string {
    if (!input) return input;
    const raw = String(input)
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/[^A-Z0-9]/g, "");
    // Expect formats:
    // - CCB-XXXX-XXXX
    // - CCBXXXXXXXX (no dashes)
    if (/^CCB-[A-F0-9]{4}-[A-F0-9]{4}$/.test(input.toUpperCase())) {
      return input.toUpperCase();
    }
    const compactMatch = raw.match(/^CCB([A-F0-9]{8})$/);
    if (compactMatch) {
      const hex = compactMatch[1];
      return `CCB-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
    }
    return raw; // fallback to normalized raw for any future formats
  }
  /**
   * Generate a professional invite code with advanced features
   */
  async generateInviteCode(
    userId: string,
    options: {
      codeType?: "personal" | "group" | "event" | "promotional";
      maxUses?: number;
      expiryHours?: number;
      customMessage?: string;
      inviterReward?: { type: string; amount: number };
      inviteeReward?: { type: string; amount: number };
      geoRestrictions?: string[];
    } = {}
  ): Promise<{ success: boolean; inviteCode?: InviteCode; error?: string }> {
    if (!supabaseAdmin) {
      return { success: false, error: "Database not configured" };
    }

    try {
      // Generate professional invite code format: CCB-XXXX-XXXX
      const code = await this.generateUniqueCode();

      // Set defaults
      const {
        codeType = "personal",
        maxUses = 10,
        expiryHours = 24 * 30, // 30 days
        customMessage = null,
        inviterReward = { type: "points", amount: 50 },
        inviteeReward = { type: "points", amount: 25 },
        geoRestrictions = [],
      } = options;

      const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

      const { data: inviteData, error } = await supabaseAdmin
        .from("invite_codes")
        .insert({
          invite_code: code,
          inviter_user_id: userId,
          code_type: codeType,
          max_uses: maxUses,
          current_uses: 0,
          expires_at: expiresAt.toISOString(),
          is_active: true,
          inviter_reward_type: inviterReward.type,
          inviter_reward_amount: inviterReward.amount,
          invitee_reward_type: inviteeReward.type,
          invitee_reward_amount: inviteeReward.amount,
          geo_restrictions: JSON.stringify(geoRestrictions),
          custom_message: customMessage,
          source_platform: "app",
        })
        .select()
        .single();

      if (error) {
        return { success: false, error: error.message };
      }

      // Track activity
      await this.trackActivity(userId, "invite_created", {
        invite_code: code,
        code_type: codeType,
        max_uses: maxUses,
      });

      return { success: true, inviteCode: inviteData as InviteCode };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate WhatsApp invite link with professional messaging
   */
  async generateWhatsAppInvite(
    userId: string,
    options: {
      contactName?: string;
      customMessage?: string;
    } = {}
  ): Promise<{
    success: boolean;
    whatsappLink?: string;
    inviteCode?: string;
    message?: string;
    error?: string;
  }> {
    try {
      // Get or create an active invite code
      let inviteCode = await this.getActiveInviteCode(userId);

      if (!inviteCode) {
        const result = await this.generateInviteCode(userId, {
          codeType: "personal",
          maxUses: 25,
          expiryHours: 24 * 30,
        });

        if (!result.success || !result.inviteCode) {
          return { success: false, error: "Failed to generate invite code" };
        }

        inviteCode = result.inviteCode;
      }

      // Get user info for personalization
      const { data: userData } = await supabaseAdmin!.auth.admin.getUserById(
        userId
      );
      const userName =
        userData?.user?.user_metadata?.full_name ||
        userData?.user?.email?.split("@")[0] ||
        "Your friend";

      // Create professional message
      const { contactName, customMessage } = options;
      const personalGreeting = contactName ? `Hi ${contactName}! ` : "Hey! ";

      const message =
        customMessage ||
        `${personalGreeting}${userName} invited you to join CCB - Credit Card Buddy! 🎯

💳 Get personalized card recommendations from friends
🤝 Share your credit card experiences securely  
📊 Track rewards and optimize your spending
🎁 Join with code *${inviteCode.invite_code}* and get 25 bonus points!

Download: [App Store Link] | [Play Store Link]

Your invite code: *${inviteCode.invite_code}*
Valid until: ${new Date(inviteCode.expires_at).toLocaleDateString()}

Join the smart way to discover credit cards! 🚀`;

      // Generate WhatsApp link
      const whatsappLink = `https://wa.me/?text=${encodeURIComponent(message)}`;

      // Track click
      await this.trackInviteClick(inviteCode.id);

      return {
        success: true,
        whatsappLink,
        inviteCode: inviteCode.invite_code,
        message,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Process invite code with professional validation and rewards
   */
  async processInviteCode(
    invitedUserId: string,
    inviteCode: string,
    deviceInfo: any = {}
  ): Promise<{
    success: boolean;
    friendship?: any;
    rewards?: any;
    error?: string;
  }> {
    if (!supabaseAdmin) {
      return { success: false, error: "Database not configured" };
    }

    try {
      console.log(
        `Processing invite code: ${inviteCode} for user: ${invitedUserId}`
      );

      const normalizedCode = this.normalizeInviteCode(inviteCode);

      // Validate invite code
      const { data: invite, error: inviteError } = await supabaseAdmin
        .from("invite_codes")
        .select("*")
        .eq("invite_code", normalizedCode)
        .eq("is_active", true)
        .single();

      console.log("Invite lookup result:", { invite, inviteError });

      if (inviteError || !invite) {
        console.log("Invite code not found or error:", inviteError);
        return { success: false, error: "Invalid or expired invite code" };
      }

      console.log("Found invite:", {
        id: invite.id,
        code: invite.invite_code,
        expires_at: invite.expires_at,
        current_uses: invite.current_uses,
        max_uses: invite.max_uses,
        is_active: invite.is_active,
      });

      // Professional validations
      const validationResult = await this.validateInviteCode(
        invite,
        invitedUserId
      );

      console.log("Validation result:", validationResult);

      if (!validationResult.valid) {
        return { success: false, error: validationResult.error };
      }

      // Check if user already used this code
      const { data: existingUsage } = await supabaseAdmin
        .from("invite_usage")
        .select("id")
        .eq("invite_code_id", invite.id)
        .eq("invited_user_id", invitedUserId)
        .single();

      if (existingUsage) {
        console.log("User already used this invite code");
        return {
          success: false,
          error: "You have already used this invite code",
        };
      }

      console.log("Processing invite code successfully...");

      // Record invite usage with detailed tracking
      const { data: usageData, error: usageError } = await supabaseAdmin
        .from("invite_usage")
        .insert({
          invite_code_id: invite.id,
          invited_user_id: invitedUserId,
          device_info: JSON.stringify(deviceInfo),
          ip_address: deviceInfo.ipAddress || null,
          user_agent: deviceInfo.userAgent || null,
          conversion_step: "registered",
        })
        .select()
        .single();

      if (usageError) {
        console.error("Error recording invite usage:", usageError);
        return { success: false, error: "Failed to process invite" };
      }

      // Update invite code usage
      await supabaseAdmin
        .from("invite_codes")
        .update({
          current_uses: invite.current_uses + 1,
          total_registrations: (invite.total_registrations || 0) + 1,
          conversion_rate:
            (invite.total_registrations + 1) / Math.max(invite.total_clicks, 1),
        })
        .eq("id", invite.id);

      // Process rewards
      const rewardsResult = await this.processInviteRewards(
        invite,
        invitedUserId
      );

      // Track activities
      await this.trackActivity(invitedUserId, "invite_used", {
        invite_code: inviteCode,
        inviter_id: invite.inviter_user_id,
      });

      await this.trackActivity(invite.inviter_user_id, "friend_invited", {
        invited_user_id: invitedUserId,
        invite_code: inviteCode,
      });

      // Get friendship data (created by trigger)
      const { data: friendship } = await supabaseAdmin
        .from("friend_relationships")
        .select("*")
        .eq("user_id", invite.inviter_user_id)
        .eq("friend_id", invitedUserId)
        .single();

      console.log("Invite code processed successfully");

      return {
        success: true,
        friendship,
        rewards: rewardsResult,
      };
    } catch (error: any) {
      console.error("Error in processInviteCode:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get user's professional friend network with analytics
   */
  async getFriendNetwork(userId: string): Promise<{
    friends: FriendRequest[];
    analytics: {
      totalFriends: number;
      pendingRequests: number;
      friendsFromInvites: number;
      avgInteractions: number;
    };
  }> {
    if (!supabaseAdmin) {
      return {
        friends: [],
        analytics: {
          totalFriends: 0,
          pendingRequests: 0,
          friendsFromInvites: 0,
          avgInteractions: 0,
        },
      };
    }

    const { data: friendships, error } = await supabaseAdmin
      .from("friend_relationships")
      .select(
        `
        *,
        friend:friend_id (
          id,
          email,
          raw_user_meta_data
        )
      `
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching friend network:", error);
      return {
        friends: [],
        analytics: {
          totalFriends: 0,
          pendingRequests: 0,
          friendsFromInvites: 0,
          avgInteractions: 0,
        },
      };
    }

    // Calculate analytics
    const analytics = {
      totalFriends:
        friendships?.filter((f) => f.status === "accepted").length || 0,
      pendingRequests:
        friendships?.filter((f) => f.status === "pending").length || 0,
      friendsFromInvites:
        friendships?.filter((f) => f.connection_source === "invite").length ||
        0,
      avgInteractions: friendships?.length
        ? friendships.reduce((sum, f) => sum + (f.interaction_count || 0), 0) /
          friendships.length
        : 0,
    };

    return {
      friends: friendships || [],
      analytics,
    };
  }

  /**
   * Get comprehensive invite analytics
   */
  async getInviteAnalytics(userId: string): Promise<InviteAnalytics> {
    if (!supabaseAdmin) {
      return {
        totalInvitesSent: 0,
        totalInvitesUsed: 0,
        totalNewUsers: 0,
        totalFriendshipsCreated: 0,
        conversionRate: 0,
        topPerformingCodes: [],
        recentActivity: [],
      };
    }

    // Get user's invite codes with usage stats
    const { data: inviteCodes } = await supabaseAdmin
      .from("invite_codes")
      .select(
        `
        *,
        invite_usage (
          id,
          invited_user_id,
          registered_at,
          conversion_step
        )
      `
      )
      .eq("inviter_user_id", userId)
      .order("created_at", { ascending: false });

    if (!inviteCodes) {
      return {
        totalInvitesSent: 0,
        totalInvitesUsed: 0,
        totalNewUsers: 0,
        totalFriendshipsCreated: 0,
        conversionRate: 0,
        topPerformingCodes: [],
        recentActivity: [],
      };
    }

    // Calculate metrics
    const totalInvitesSent = inviteCodes.length;
    const totalInvitesUsed = inviteCodes.reduce(
      (sum, code) => sum + (code.current_uses || 0),
      0
    );
    const totalNewUsers = inviteCodes.reduce((sum, code) => {
      return sum + (code.invite_usage?.length || 0);
    }, 0);

    // Get friendship count
    const { count: friendshipsCount } = await supabaseAdmin
      .from("friend_relationships")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("connection_source", "invite")
      .eq("status", "accepted");

    const conversionRate =
      totalInvitesSent > 0 ? (totalNewUsers / totalInvitesSent) * 100 : 0;

    // Top performing codes
    const topPerformingCodes = inviteCodes
      .filter((code) => code.current_uses > 0)
      .sort((a, b) => (b.current_uses || 0) - (a.current_uses || 0))
      .slice(0, 5)
      .map((code) => ({
        code: code.invite_code,
        uses: code.current_uses,
        clicks: code.total_clicks,
        conversions: code.total_registrations,
        conversionRate: code.conversion_rate || 0,
      }));

    // Recent activity
    const { data: recentActivity } = await supabaseAdmin
      .from("user_activities")
      .select("*")
      .eq("user_id", userId)
      .in("activity_type", [
        "invite_created",
        "friend_invited",
        "friend_accepted",
      ])
      .order("created_at", { ascending: false })
      .limit(10);

    return {
      totalInvitesSent,
      totalInvitesUsed,
      totalNewUsers,
      totalFriendshipsCreated: friendshipsCount || 0,
      conversionRate,
      topPerformingCodes,
      recentActivity: recentActivity || [],
    };
  }

  /**
   * Manage friend request with professional controls
   */
  async manageFriendRequest(
    userId: string,
    friendId: string,
    action: "accept" | "decline" | "block",
    settings: {
      canSeeCards?: boolean;
      canSeeActivity?: boolean;
      relationshipType?: "friend" | "family" | "colleague" | "acquaintance";
    } = {}
  ): Promise<{ success: boolean; error?: string }> {
    if (!supabaseAdmin) {
      return { success: false, error: "Database not configured" };
    }

    try {
      const {
        canSeeCards = true,
        canSeeActivity = false,
        relationshipType = "friend",
      } = settings;

      let status: string;
      let acceptedAt: string | null = null;

      switch (action) {
        case "accept":
          status = "accepted";
          acceptedAt = new Date().toISOString();
          break;
        case "decline":
          // Simply delete the relationship
          await supabaseAdmin
            .from("friend_relationships")
            .delete()
            .eq("user_id", friendId)
            .eq("friend_id", userId);
          return { success: true };
        case "block":
          status = "blocked";
          break;
        default:
          return { success: false, error: "Invalid action" };
      }

      // Update the relationship
      const { error } = await supabaseAdmin
        .from("friend_relationships")
        .update({
          status,
          accepted_at: acceptedAt,
          relationship_type: relationshipType,
          can_see_cards: canSeeCards,
          can_see_activity: canSeeActivity,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", friendId)
        .eq("friend_id", userId);

      if (error) {
        return { success: false, error: error.message };
      }

      // If accepted, create/update reverse relationship
      if (action === "accept") {
        await supabaseAdmin.from("friend_relationships").upsert(
          {
            user_id: userId,
            friend_id: friendId,
            status: "accepted",
            accepted_at: acceptedAt,
            relationship_type: relationshipType,
            can_see_cards: canSeeCards,
            can_see_activity: canSeeActivity,
            connection_source: "mutual",
          },
          { onConflict: "user_id,friend_id" }
        );

        // Track activity
        await this.trackActivity(userId, "friend_accepted", {
          friend_id: friendId,
          relationship_type: relationshipType,
        });

        // Create notification
        await this.createNotification(friendId, {
          type: "friend_accepted",
          title: "Friend request accepted! 🎉",
          message: "You are now connected and can share card experiences!",
          relatedUserId: userId,
        });
      }

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ===================================================================
  // PRIVATE HELPER METHODS
  // ===================================================================

  private async generateUniqueCode(): Promise<string> {
    let code: string;
    let attempts = 0;
    const maxAttempts = 10;

    do {
      code =
        "CCB-" +
        crypto.randomBytes(2).toString("hex").toUpperCase() +
        "-" +
        crypto.randomBytes(2).toString("hex").toUpperCase();

      attempts++;

      const { data: existing } = await supabaseAdmin!
        .from("invite_codes")
        .select("id")
        .eq("invite_code", code)
        .single();

      if (!existing) break;

      if (attempts >= maxAttempts) {
        throw new Error("Unable to generate unique invite code");
      }
    } while (true);

    return code;
  }

  private async getActiveInviteCode(
    userId: string
  ): Promise<InviteCode | null> {
    const { data: codes } = await supabaseAdmin!
      .from("invite_codes")
      .select("*")
      .eq("inviter_user_id", userId)
      .eq("is_active", true)
      .gt("expires_at", new Date().toISOString())
      .lt("current_uses", 10)
      .order("created_at", { ascending: false })
      .limit(1);

    return codes && codes.length > 0 ? (codes[0] as InviteCode) : null;
  }

  private async validateInviteCode(
    invite: any,
    invitedUserId: string
  ): Promise<{ valid: boolean; error?: string }> {
    // Check expiry
    if (new Date(invite.expires_at) < new Date()) {
      return { valid: false, error: "Invite code has expired" };
    }

    // Check usage limit
    if (invite.current_uses >= invite.max_uses) {
      return { valid: false, error: "Invite code has reached maximum usage" };
    }

    // Check self-invitation
    if (invite.inviter_user_id === invitedUserId) {
      return { valid: false, error: "You cannot use your own invite code" };
    }

    // Check if already friends
    const { data: existingFriendship } = await supabaseAdmin!
      .from("friend_relationships")
      .select("id")
      .or(
        `
        and(user_id.eq.${invitedUserId},friend_id.eq.${invite.inviter_user_id}),
        and(user_id.eq.${invite.inviter_user_id},friend_id.eq.${invitedUserId})
      `
      )
      .single();

    if (existingFriendship) {
      return { valid: false, error: "You are already friends with this user" };
    }

    return { valid: true };
  }

  private async processInviteRewards(
    invite: any,
    invitedUserId: string
  ): Promise<any> {
    const rewards: {
      inviterReward: any;
      inviteeReward: any;
    } = {
      inviterReward: null,
      inviteeReward: null,
    };

    try {
      // Process inviter reward
      if (invite.inviter_reward_type && invite.inviter_reward_amount > 0) {
        // Here you would integrate with your rewards system
        // For now, we'll just track it
        rewards.inviterReward = {
          type: invite.inviter_reward_type,
          amount: invite.inviter_reward_amount,
          status: "pending",
        };
      }

      // Process invitee reward
      if (invite.invitee_reward_type && invite.invitee_reward_amount > 0) {
        rewards.inviteeReward = {
          type: invite.invitee_reward_type,
          amount: invite.invitee_reward_amount,
          status: "pending",
        };
      }

      return rewards;
    } catch (error) {
      console.error("Error processing rewards:", error);
      return rewards;
    }
  }

  private async trackInviteClick(inviteCodeId: string): Promise<void> {
    await supabaseAdmin!
      .from("invite_codes")
      .update({
        total_clicks: supabaseAdmin!.rpc("increment_column", {
          table_name: "invite_codes",
          column_name: "total_clicks",
          row_id: inviteCodeId,
        }),
      })
      .eq("id", inviteCodeId);
  }

  private async trackActivity(
    userId: string,
    activityType: string,
    activityData: any = {},
    sessionId?: string
  ): Promise<void> {
    await supabaseAdmin!.from("user_activities").insert({
      user_id: userId,
      activity_type: activityType,
      activity_data: JSON.stringify(activityData),
      session_id: sessionId,
      platform: "mobile",
    });
  }

  private async createNotification(
    userId: string,
    notification: {
      type: string;
      title: string;
      message: string;
      actionUrl?: string;
      relatedUserId?: string;
      relatedInviteId?: string;
    }
  ): Promise<void> {
    await supabaseAdmin!.from("notifications").insert({
      user_id: userId,
      notification_type: notification.type,
      title: notification.title,
      message: notification.message,
      action_url: notification.actionUrl,
      related_user_id: notification.relatedUserId,
      related_invite_id: notification.relatedInviteId,
    });
  }
}
