-- ===================================================================
-- PROFESSIONAL INVITE SYSTEM - ENTERPRISE GRADE
-- ===================================================================

-- Enhanced invite campaigns (for marketing and analytics)
CREATE TABLE invite_campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_name TEXT NOT NULL,
  campaign_type TEXT DEFAULT 'user_generated' CHECK (campaign_type IN ('user_generated', 'referral_program', 'promotional', 'targeted')),
  description TEXT,
  start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  end_date TIMESTAMP WITH TIME ZONE,
  max_total_uses INTEGER,
  current_total_uses INTEGER DEFAULT 0,
  reward_type TEXT CHECK (reward_type IN ('cashback', 'points', 'premium_access', 'custom')),
  reward_amount DECIMAL(10,2),
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enhanced invite codes with advanced features
-- First drop dependent objects
DROP POLICY IF EXISTS "Users can view invite usage related to them" ON invite_usage;
DROP TABLE IF EXISTS invite_usage CASCADE;
DROP TABLE IF EXISTS invite_codes CASCADE;

CREATE TABLE invite_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invite_code TEXT UNIQUE NOT NULL,
  inviter_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES invite_campaigns(id) ON DELETE SET NULL,
  
  -- Code configuration
  code_type TEXT DEFAULT 'personal' CHECK (code_type IN ('personal', 'group', 'event', 'promotional')),
  max_uses INTEGER DEFAULT 10,
  current_uses INTEGER DEFAULT 0,
  
  -- Validity and scheduling
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '30 days'),
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Advanced features
  geo_restrictions JSONB DEFAULT '[]'::jsonb, -- Country/region restrictions
  device_restrictions JSONB DEFAULT '{}'::jsonb, -- Device type restrictions
  usage_limit_per_user INTEGER DEFAULT 1,
  
  -- Rewards and incentives
  inviter_reward_type TEXT CHECK (inviter_reward_type IN ('cashback', 'points', 'premium_days', 'none')),
  inviter_reward_amount DECIMAL(10,2) DEFAULT 0,
  invitee_reward_type TEXT CHECK (invitee_reward_type IN ('cashback', 'points', 'premium_days', 'none')),
  invitee_reward_amount DECIMAL(10,2) DEFAULT 0,
  
  -- Analytics tracking
  total_clicks INTEGER DEFAULT 0,
  total_installs INTEGER DEFAULT 0,
  total_registrations INTEGER DEFAULT 0,
  conversion_rate DECIMAL(5,4) DEFAULT 0,
  
  -- Metadata
  source_platform TEXT, -- 'whatsapp', 'telegram', 'email', 'sms', 'direct'
  custom_message TEXT,
  
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Professional friend relationship system
DROP TABLE IF EXISTS friend_relationships CASCADE;
CREATE TABLE friend_relationships (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Relationship status and management
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'blocked', 'unfriended')),
  relationship_type TEXT DEFAULT 'friend' CHECK (relationship_type IN ('friend', 'family', 'colleague', 'acquaintance')),
  
  -- Connection source
  connection_source TEXT DEFAULT 'invite' CHECK (connection_source IN ('invite', 'contacts', 'manual', 'recommendation')),
  invited_via_code TEXT,
  invite_code_id UUID REFERENCES invite_codes(id) ON DELETE SET NULL,
  
  -- Interaction tracking
  last_interaction_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  interaction_count INTEGER DEFAULT 0,
  shared_cards_count INTEGER DEFAULT 0,
  
  -- Privacy and permissions
  can_see_cards BOOLEAN DEFAULT TRUE,
  can_see_activity BOOLEAN DEFAULT FALSE,
  can_send_recommendations BOOLEAN DEFAULT TRUE,
  
  -- Timestamps
  requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  accepted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_friendship UNIQUE (user_id, friend_id),
  CONSTRAINT no_self_friendship CHECK (user_id != friend_id)
);

-- Enhanced invite usage tracking with detailed analytics
-- Table already dropped above with CASCADE
CREATE TABLE invite_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invite_code_id UUID NOT NULL REFERENCES invite_codes(id) ON DELETE CASCADE,
  invited_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Usage tracking
  clicked_at TIMESTAMP WITH TIME ZONE,
  registered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  activated_at TIMESTAMP WITH TIME ZONE, -- When user completed onboarding
  
  -- Device and location info
  device_info JSONB DEFAULT '{}'::jsonb,
  ip_address INET,
  user_agent TEXT,
  referrer_url TEXT,
  
  -- Conversion funnel tracking
  conversion_step TEXT DEFAULT 'registered' CHECK (conversion_step IN ('clicked', 'installed', 'registered', 'onboarded', 'first_card_added')),
  
  -- Rewards tracking
  inviter_reward_given BOOLEAN DEFAULT FALSE,
  invitee_reward_given BOOLEAN DEFAULT FALSE,
  reward_processed_at TIMESTAMP WITH TIME ZONE,
  
  CONSTRAINT unique_user_invite UNIQUE (invite_code_id, invited_user_id)
);

-- User engagement and activity tracking
CREATE TABLE user_activities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  activity_type TEXT NOT NULL CHECK (activity_type IN (
    'login', 'card_added', 'card_shared', 'friend_invited', 'friend_accepted',
    'recommendation_given', 'recommendation_received', 'card_verified'
  )),
  
  activity_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Analytics fields
  session_id TEXT,
  device_type TEXT,
  platform TEXT
);

-- Notification system for invites and friend activities
CREATE TABLE notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  notification_type TEXT NOT NULL CHECK (notification_type IN (
    'friend_request', 'friend_accepted', 'invite_used', 'card_shared',
    'recommendation_received', 'reward_earned', 'system_announcement'
  )),
  
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  action_url TEXT,
  
  -- Status
  is_read BOOLEAN DEFAULT FALSE,
  is_dismissed BOOLEAN DEFAULT FALSE,
  
  -- Related entities
  related_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  related_invite_id UUID REFERENCES invite_codes(id) ON DELETE SET NULL,
  related_friendship_id UUID REFERENCES friend_relationships(id) ON DELETE SET NULL,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  read_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '30 days')
);

-- Advanced analytics and insights tables
CREATE TABLE invite_analytics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Time period
  date_period DATE NOT NULL,
  period_type TEXT DEFAULT 'daily' CHECK (period_type IN ('hourly', 'daily', 'weekly', 'monthly')),
  
  -- Metrics
  total_invites_sent INTEGER DEFAULT 0,
  total_invites_used INTEGER DEFAULT 0,
  total_new_users INTEGER DEFAULT 0,
  total_friendships_created INTEGER DEFAULT 0,
  
  -- Conversion metrics
  click_to_install_rate DECIMAL(5,4) DEFAULT 0,
  install_to_register_rate DECIMAL(5,4) DEFAULT 0,
  register_to_onboard_rate DECIMAL(5,4) DEFAULT 0,
  
  -- Platform breakdown
  platform_breakdown JSONB DEFAULT '{}'::jsonb,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_date_period UNIQUE (date_period, period_type)
);

-- ===================================================================
-- INDEXES FOR PERFORMANCE
-- ===================================================================

-- Invite codes indexes
CREATE INDEX idx_invite_codes_inviter ON invite_codes(inviter_user_id);
CREATE INDEX idx_invite_codes_code ON invite_codes(invite_code);
CREATE INDEX idx_invite_codes_expires_at ON invite_codes(expires_at);
CREATE INDEX idx_invite_codes_campaign ON invite_codes(campaign_id);
CREATE INDEX idx_invite_codes_active ON invite_codes(is_active);

-- Friend relationships indexes
CREATE INDEX idx_friend_relationships_user ON friend_relationships(user_id);
CREATE INDEX idx_friend_relationships_friend ON friend_relationships(friend_id);
CREATE INDEX idx_friend_relationships_status ON friend_relationships(status);
CREATE INDEX idx_friend_relationships_interaction ON friend_relationships(last_interaction_at);

-- Invite usage indexes
CREATE INDEX idx_invite_usage_code ON invite_usage(invite_code_id);
CREATE INDEX idx_invite_usage_user ON invite_usage(invited_user_id);
CREATE INDEX idx_invite_usage_conversion ON invite_usage(conversion_step);

-- User activities indexes
CREATE INDEX idx_user_activities_user ON user_activities(user_id);
CREATE INDEX idx_user_activities_type ON user_activities(activity_type);
CREATE INDEX idx_user_activities_created ON user_activities(created_at);

-- Notifications indexes
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_type ON notifications(notification_type);
CREATE INDEX idx_notifications_read ON notifications(is_read);
CREATE INDEX idx_notifications_created ON notifications(created_at);

-- Analytics indexes
CREATE INDEX idx_invite_analytics_date ON invite_analytics(date_period);
CREATE INDEX idx_invite_analytics_period ON invite_analytics(period_type);

-- ===================================================================
-- ROW LEVEL SECURITY POLICIES
-- ===================================================================

-- Enable RLS
ALTER TABLE invite_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_analytics ENABLE ROW LEVEL SECURITY;

-- Invite campaigns policies
CREATE POLICY "Users can view active campaigns" ON invite_campaigns
  FOR SELECT USING (is_active = true);

CREATE POLICY "Campaign creators can manage their campaigns" ON invite_campaigns
  FOR ALL USING (created_by = auth.uid());

-- Invite codes policies  
CREATE POLICY "Users can view their own invite codes" ON invite_codes
  FOR SELECT USING (inviter_user_id = auth.uid());

CREATE POLICY "Users can create their own invite codes" ON invite_codes
  FOR INSERT WITH CHECK (inviter_user_id = auth.uid());

CREATE POLICY "Users can update their own invite codes" ON invite_codes
  FOR UPDATE USING (inviter_user_id = auth.uid());

-- Friend relationships policies
CREATE POLICY "Users can view their own relationships" ON friend_relationships
  FOR SELECT USING (user_id = auth.uid() OR friend_id = auth.uid());

CREATE POLICY "Users can create relationships where they are involved" ON friend_relationships
  FOR INSERT WITH CHECK (user_id = auth.uid() OR friend_id = auth.uid());

CREATE POLICY "Users can update their own relationships" ON friend_relationships
  FOR UPDATE USING (user_id = auth.uid() OR friend_id = auth.uid());

-- User activities policies
CREATE POLICY "Users can view their own activities" ON user_activities
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "System can insert activities" ON user_activities
  FOR INSERT WITH CHECK (true);

-- Notifications policies
CREATE POLICY "Users can view their own notifications" ON notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can update their own notifications" ON notifications
  FOR UPDATE USING (user_id = auth.uid());

-- ===================================================================
-- TRIGGERS AND FUNCTIONS
-- ===================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_invite_campaigns_updated_at 
  BEFORE UPDATE ON invite_campaigns 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_invite_codes_updated_at 
  BEFORE UPDATE ON invite_codes 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_friend_relationships_updated_at 
  BEFORE UPDATE ON friend_relationships 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to automatically accept friend requests from successful invites
CREATE OR REPLACE FUNCTION auto_accept_invite_friendship()
RETURNS TRIGGER AS $$
BEGIN
    -- If an invite usage is recorded, automatically create/accept friendship
    IF NEW.conversion_step = 'registered' THEN
        INSERT INTO friend_relationships (
            user_id, friend_id, status, connection_source, 
            invited_via_code, invite_code_id, accepted_at
        )
        SELECT 
            ic.inviter_user_id,
            NEW.invited_user_id,
            'accepted',
            'invite',
            ic.invite_code,
            NEW.invite_code_id,
            NOW()
        FROM invite_codes ic
        WHERE ic.id = NEW.invite_code_id
        ON CONFLICT (user_id, friend_id) 
        DO UPDATE SET 
            status = 'accepted',
            accepted_at = NOW(),
            updated_at = NOW();
            
        -- Create reverse relationship
        INSERT INTO friend_relationships (
            user_id, friend_id, status, connection_source,
            invited_via_code, invite_code_id, accepted_at
        )
        SELECT 
            NEW.invited_user_id,
            ic.inviter_user_id,
            'accepted',
            'invite',
            ic.invite_code,
            NEW.invite_code_id,
            NOW()
        FROM invite_codes ic
        WHERE ic.id = NEW.invite_code_id
        ON CONFLICT (user_id, friend_id) 
        DO UPDATE SET 
            status = 'accepted',
            accepted_at = NOW(),
            updated_at = NOW();
            
        -- Create notification for inviter
        INSERT INTO notifications (
            user_id, notification_type, title, message,
            related_user_id, related_invite_id
        )
        SELECT 
            ic.inviter_user_id,
            'invite_used',
            'Your invite was accepted! 🎉',
            'Someone joined using your invite code and you''re now friends!',
            NEW.invited_user_id,
            NEW.invite_code_id
        FROM invite_codes ic
        WHERE ic.id = NEW.invite_code_id;
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trigger_auto_accept_invite_friendship
    AFTER INSERT ON invite_usage
    FOR EACH ROW
    EXECUTE FUNCTION auto_accept_invite_friendship();

-- Function to track user activity
CREATE OR REPLACE FUNCTION track_user_activity(
    p_user_id UUID,
    p_activity_type TEXT,
    p_activity_data JSONB DEFAULT '{}'::jsonb,
    p_session_id TEXT DEFAULT NULL,
    p_device_type TEXT DEFAULT NULL,
    p_platform TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    activity_id UUID;
BEGIN
    INSERT INTO user_activities (
        user_id, activity_type, activity_data,
        session_id, device_type, platform
    ) VALUES (
        p_user_id, p_activity_type, p_activity_data,
        p_session_id, p_device_type, p_platform
    ) RETURNING id INTO activity_id;
    
    RETURN activity_id;
END;
$$ language 'plpgsql';

-- Function to generate professional invite codes
CREATE OR REPLACE FUNCTION generate_professional_invite_code() 
RETURNS TEXT AS $$
DECLARE
    code TEXT;
    exists_check INTEGER;
BEGIN
    LOOP
        -- Generate format: CCB-XXXX-XXXX (CCB prefix + 8 random chars)
        code := 'CCB-' || 
                UPPER(substring(encode(gen_random_bytes(2), 'hex') from 1 for 4)) || 
                '-' ||
                UPPER(substring(encode(gen_random_bytes(2), 'hex') from 1 for 4));
        
        -- Check if code already exists
        SELECT COUNT(*) INTO exists_check 
        FROM invite_codes 
        WHERE invite_code = code;
        
        -- Exit loop if code is unique
        EXIT WHEN exists_check = 0;
    END LOOP;
    
    RETURN code;
END;
$$ language 'plpgsql';

-- ===================================================================
-- SAMPLE DATA
-- ===================================================================

-- Insert default invite campaign
INSERT INTO invite_campaigns (
    campaign_name, campaign_type, description,
    reward_type, reward_amount, max_total_uses
) VALUES (
    'User Referral Program',
    'referral_program', 
    'Default referral program for user invites',
    'points',
    100,
    10000
);

-- ===================================================================
-- ANALYTICS VIEWS
-- ===================================================================

-- View for invite performance analytics
CREATE VIEW invite_performance_view AS
SELECT 
    ic.id,
    ic.invite_code,
    ic.inviter_user_id,
    ic.created_at,
    ic.expires_at,
    ic.max_uses,
    ic.current_uses,
    ic.total_clicks,
    ic.total_registrations,
    ic.conversion_rate,
    COUNT(iu.id) as actual_usage_count,
    COUNT(CASE WHEN iu.conversion_step = 'onboarded' THEN 1 END) as completed_onboarding,
    (ic.current_uses::DECIMAL / NULLIF(ic.max_uses, 0) * 100) as usage_percentage
FROM invite_codes ic
LEFT JOIN invite_usage iu ON ic.id = iu.invite_code_id
GROUP BY ic.id;

-- View for friendship network analysis
CREATE VIEW friendship_network_view AS
SELECT 
    fr.user_id,
    COUNT(*) as total_friends,
    COUNT(CASE WHEN fr.status = 'accepted' THEN 1 END) as accepted_friends,
    COUNT(CASE WHEN fr.status = 'pending' THEN 1 END) as pending_requests,
    COUNT(CASE WHEN fr.connection_source = 'invite' THEN 1 END) as friends_from_invites,
    AVG(fr.interaction_count) as avg_interactions,
    MAX(fr.last_interaction_at) as last_friend_interaction
FROM friend_relationships fr
GROUP BY fr.user_id;

COMMENT ON TABLE invite_campaigns IS 'Professional invite campaign management for marketing and analytics';
COMMENT ON TABLE invite_codes IS 'Enhanced invite codes with advanced features, analytics, and reward system';
COMMENT ON TABLE friend_relationships IS 'Professional friend relationship management with detailed tracking';
COMMENT ON TABLE invite_usage IS 'Detailed invite usage tracking with conversion funnel analytics';
COMMENT ON TABLE user_activities IS 'User engagement and activity tracking for analytics and personalization';
COMMENT ON TABLE notifications IS 'In-app notification system for user engagement';
COMMENT ON TABLE invite_analytics IS 'Time-series analytics for invite system performance';
