-- Create invite_codes table for tracking invite codes
CREATE TABLE invite_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invite_code TEXT UNIQUE NOT NULL,
  inviter_user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  max_uses INTEGER DEFAULT 1,
  current_uses INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  
  CONSTRAINT fk_inviter_user FOREIGN KEY (inviter_user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Create friend_relationships table for tracking friendships
CREATE TABLE friend_relationships (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  friend_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT DEFAULT 'accepted' CHECK (status IN ('pending', 'accepted', 'blocked')),
  invited_via_code TEXT,
  
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT fk_friend FOREIGN KEY (friend_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT unique_friendship UNIQUE (user_id, friend_id),
  CONSTRAINT no_self_friendship CHECK (user_id != friend_id)
);

-- Create invite_usage table for tracking who used which invite codes
CREATE TABLE invite_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invite_code_id UUID NOT NULL,
  invited_user_id UUID NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT fk_invite_code FOREIGN KEY (invite_code_id) REFERENCES invite_codes(id) ON DELETE CASCADE,
  CONSTRAINT fk_invited_user FOREIGN KEY (invited_user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT unique_user_invite UNIQUE (invite_code_id, invited_user_id)
);

-- Create indexes for better performance
CREATE INDEX idx_invite_codes_inviter ON invite_codes(inviter_user_id);
CREATE INDEX idx_invite_codes_code ON invite_codes(invite_code);
CREATE INDEX idx_friend_relationships_user ON friend_relationships(user_id);
CREATE INDEX idx_friend_relationships_friend ON friend_relationships(friend_id);
CREATE INDEX idx_invite_usage_code ON invite_usage(invite_code_id);
CREATE INDEX idx_invite_usage_user ON invite_usage(invited_user_id);

-- Enable Row Level Security (RLS)
ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_usage ENABLE ROW LEVEL SECURITY;

-- RLS Policies for invite_codes
CREATE POLICY "Users can view their own invite codes" ON invite_codes
  FOR SELECT USING (inviter_user_id = auth.uid());

CREATE POLICY "Users can create their own invite codes" ON invite_codes
  FOR INSERT WITH CHECK (inviter_user_id = auth.uid());

CREATE POLICY "Users can update their own invite codes" ON invite_codes
  FOR UPDATE USING (inviter_user_id = auth.uid());

-- RLS Policies for friend_relationships
CREATE POLICY "Users can view their own friendships" ON friend_relationships
  FOR SELECT USING (user_id = auth.uid() OR friend_id = auth.uid());

CREATE POLICY "Users can create friendships where they are involved" ON friend_relationships
  FOR INSERT WITH CHECK (user_id = auth.uid() OR friend_id = auth.uid());

CREATE POLICY "Users can update their own friendships" ON friend_relationships
  FOR UPDATE USING (user_id = auth.uid() OR friend_id = auth.uid());

-- RLS Policies for invite_usage
CREATE POLICY "Users can view invite usage related to them" ON invite_usage
  FOR SELECT USING (
    invited_user_id = auth.uid() OR 
    EXISTS (
      SELECT 1 FROM invite_codes 
      WHERE invite_codes.id = invite_usage.invite_code_id 
      AND invite_codes.inviter_user_id = auth.uid()
    )
  );

CREATE POLICY "System can insert invite usage" ON invite_usage
  FOR INSERT WITH CHECK (true);
