-- ===================================================================
-- CORE BUSINESS TABLES FOR CREDIT CARD SHARING PLATFORM
-- ===================================================================

-- User Google tokens (already exists but ensuring structure)
CREATE TABLE IF NOT EXISTS user_google_tokens (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  scope TEXT,
  token_type TEXT,
  expiry_date BIGINT,
  id_token TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Contacts table (already exists but ensuring structure)
CREATE TABLE IF NOT EXISTS contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  google_contact_id TEXT,
  display_name TEXT,
  given_name TEXT,
  family_name TEXT,
  middle_name TEXT,
  nickname TEXT,
  email_addresses JSONB DEFAULT '[]'::jsonb,
  phone_numbers JSONB DEFAULT '[]'::jsonb,
  addresses JSONB DEFAULT '[]'::jsonb,
  organizations JSONB DEFAULT '[]'::jsonb,
  photo_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_user_google_contact UNIQUE (user_id, google_contact_id)
);

-- Emails table (for Gmail scan results)
CREATE TABLE IF NOT EXISTS emails (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  subject TEXT,
  sender TEXT,
  date_received TIMESTAMP WITH TIME ZONE,
  matched_cards TEXT[] DEFAULT '{}',
  raw_text TEXT,
  email_type TEXT CHECK (email_type IN ('statement', 'transaction', 'promotional', 'fraud', 'other')),
  confidence DECIMAL(3,2) DEFAULT 0.0,
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_user_message UNIQUE (user_id, message_id)
);

-- User Cards - The core table for storing user's credit cards
CREATE TABLE IF NOT EXISTS user_cards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Card identification
  card_name TEXT NOT NULL, -- e.g., "HDFC Millennia Credit Card"
  bank_name TEXT NOT NULL, -- e.g., "HDFC Bank"
  card_type TEXT NOT NULL, -- e.g., "Credit Card", "Debit Card"
  card_network TEXT, -- e.g., "Visa", "Mastercard", "RuPay"
  last_four_digits TEXT, -- e.g., "1234"
  card_number TEXT, -- Masked card number for verification
  expiry_date TEXT, -- Card expiry date
  card_holder_name TEXT, -- Name on the card
  
  -- Card details
  annual_fee DECIMAL(10,2),
  rewards_type TEXT, -- e.g., "Cashback", "Points", "Miles"
  primary_benefit TEXT, -- e.g., "5% cashback on online shopping"
  
  -- Detection metadata
  detected_from TEXT NOT NULL CHECK (detected_from IN ('gmail_scan', 'manual_entry', 'bank_statement', 'other')),
  detection_confidence DECIMAL(3,2) DEFAULT 0.8, -- 0.0 to 1.0
  first_detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Sharing settings
  visibility TEXT DEFAULT 'friends' CHECK (visibility IN ('private', 'friends', 'public')),
  is_active BOOLEAN DEFAULT TRUE,
  is_verified BOOLEAN DEFAULT FALSE, -- Manually verified by user
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_user_card UNIQUE (user_id, card_name, bank_name)
);

-- Card Reviews/Ratings by users
CREATE TABLE card_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES user_cards(id) ON DELETE CASCADE,
  
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT,
  pros TEXT[] DEFAULT '{}',
  cons TEXT[] DEFAULT '{}',
  recommended_for TEXT, -- e.g., "Online shopping", "Travel", "Dining"
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_user_card_review UNIQUE (user_id, card_id)
);

-- Card Usage Analytics
CREATE TABLE card_usage_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  card_id UUID NOT NULL REFERENCES user_cards(id) ON DELETE CASCADE,
  
  -- Monthly usage data
  month_year DATE NOT NULL, -- First day of month
  total_transactions INTEGER DEFAULT 0,
  total_amount DECIMAL(12,2) DEFAULT 0,
  rewards_earned DECIMAL(10,2) DEFAULT 0,
  
  -- Categories
  category_breakdown JSONB DEFAULT '{}'::jsonb, -- {"dining": 1500, "shopping": 2500}
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_card_month UNIQUE (card_id, month_year)
);

-- Card Recommendations (algorithmic suggestions)
CREATE TABLE card_recommendations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES user_cards(id) ON DELETE CASCADE,
  
  recommendation_type TEXT NOT NULL CHECK (recommendation_type IN ('friend_usage', 'spending_pattern', 'similar_users', 'promotional')),
  confidence_score DECIMAL(3,2) NOT NULL, -- 0.0 to 1.0
  reasoning TEXT,
  
  -- Friend who has this card (if friend_usage type)
  recommended_by_friend_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  is_viewed BOOLEAN DEFAULT FALSE,
  is_dismissed BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  
  CONSTRAINT unique_user_card_rec UNIQUE (user_id, card_id, recommendation_type)
);

-- ===================================================================
-- INDEXES FOR PERFORMANCE
-- ===================================================================

-- User cards indexes
CREATE INDEX idx_user_cards_user_id ON user_cards(user_id);
CREATE INDEX idx_user_cards_bank_name ON user_cards(bank_name);
CREATE INDEX idx_user_cards_visibility ON user_cards(visibility);
CREATE INDEX idx_user_cards_active ON user_cards(is_active);
CREATE INDEX idx_user_cards_detection ON user_cards(detected_from);

-- Contacts indexes
CREATE INDEX idx_contacts_user_id ON contacts(user_id);
CREATE INDEX idx_contacts_google_id ON contacts(google_contact_id);

-- Emails indexes
CREATE INDEX idx_emails_user_id ON emails(user_id);
CREATE INDEX idx_emails_message_id ON emails(message_id);
CREATE INDEX idx_emails_date ON emails(date_received);

-- Reviews indexes
CREATE INDEX idx_card_reviews_user_id ON card_reviews(user_id);
CREATE INDEX idx_card_reviews_card_id ON card_reviews(card_id);
CREATE INDEX idx_card_reviews_rating ON card_reviews(rating);

-- Usage stats indexes
CREATE INDEX idx_card_usage_card_id ON card_usage_stats(card_id);
CREATE INDEX idx_card_usage_month ON card_usage_stats(month_year);

-- Recommendations indexes
CREATE INDEX idx_card_recommendations_user_id ON card_recommendations(user_id);
CREATE INDEX idx_card_recommendations_type ON card_recommendations(recommendation_type);
CREATE INDEX idx_card_recommendations_score ON card_recommendations(confidence_score);

-- ===================================================================
-- ROW LEVEL SECURITY
-- ===================================================================

-- Enable RLS on all tables
ALTER TABLE user_google_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_usage_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_recommendations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_google_tokens
CREATE POLICY "Users can manage their own tokens" ON user_google_tokens
  FOR ALL USING (user_id = auth.uid());

-- RLS Policies for contacts
CREATE POLICY "Users can manage their own contacts" ON contacts
  FOR ALL USING (user_id = auth.uid());

-- RLS Policies for emails
CREATE POLICY "Users can manage their own emails" ON emails
  FOR ALL USING (user_id = auth.uid());

-- RLS Policies for user_cards
CREATE POLICY "Users can manage their own cards" ON user_cards
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "Users can view friends' cards" ON user_cards
  FOR SELECT USING (
    visibility IN ('public', 'friends') AND (
      user_id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM friend_relationships 
        WHERE (user_id = auth.uid() AND friend_id = user_cards.user_id)
           OR (friend_id = auth.uid() AND user_id = user_cards.user_id)
      )
    )
  );

-- RLS Policies for card_reviews
CREATE POLICY "Users can manage their own reviews" ON card_reviews
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "Users can view reviews for cards they can see" ON card_reviews
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_cards uc 
      WHERE uc.id = card_reviews.card_id 
      AND (
        uc.user_id = auth.uid() OR
        (uc.visibility IN ('public', 'friends') AND
         EXISTS (
           SELECT 1 FROM friend_relationships fr
           WHERE (fr.user_id = auth.uid() AND fr.friend_id = uc.user_id)
              OR (fr.friend_id = auth.uid() AND fr.user_id = uc.user_id)
         )
        )
      )
    )
  );

-- RLS Policies for card_usage_stats
CREATE POLICY "Users can view usage stats for their cards" ON card_usage_stats
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_cards uc 
      WHERE uc.id = card_usage_stats.card_id 
      AND uc.user_id = auth.uid()
    )
  );

-- RLS Policies for card_recommendations
CREATE POLICY "Users can manage their own recommendations" ON card_recommendations
  FOR ALL USING (user_id = auth.uid());

-- ===================================================================
-- TRIGGERS FOR UPDATED_AT
-- ===================================================================

-- Function to update updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_user_google_tokens_updated_at 
  BEFORE UPDATE ON user_google_tokens 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contacts_updated_at 
  BEFORE UPDATE ON contacts 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_cards_updated_at 
  BEFORE UPDATE ON user_cards 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_card_reviews_updated_at 
  BEFORE UPDATE ON card_reviews 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===================================================================
-- SAMPLE DATA INSERTION FUNCTIONS
-- ===================================================================

-- Function to get card network from card name
CREATE OR REPLACE FUNCTION extract_card_network(card_name TEXT, bank_name TEXT)
RETURNS TEXT AS $$
BEGIN
  card_name := LOWER(card_name);
  bank_name := LOWER(bank_name);
  
  IF card_name ~ 'visa' THEN RETURN 'Visa';
  ELSIF card_name ~ 'master' THEN RETURN 'Mastercard';
  ELSIF card_name ~ 'amex|american express' THEN RETURN 'American Express';
  ELSIF card_name ~ 'rupay' THEN RETURN 'RuPay';
  ELSIF card_name ~ 'discover' THEN RETURN 'Discover';
  ELSE RETURN 'Unknown';
  END IF;
END;
$$ LANGUAGE plpgsql;
