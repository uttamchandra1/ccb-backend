-- Migration: Enhanced Card Detection System
-- Description: Adds new fields for improved card detection and fraud prevention

-- Add new columns to emails table
ALTER TABLE emails 
ADD COLUMN IF NOT EXISTS email_type TEXT CHECK (email_type IN ('statement', 'transaction', 'promotional', 'fraud', 'other')),
ADD COLUMN IF NOT EXISTS confidence DECIMAL(3,2) DEFAULT 0.0;

-- Add new columns to user_cards table
ALTER TABLE user_cards 
ADD COLUMN IF NOT EXISTS card_number TEXT,
ADD COLUMN IF NOT EXISTS expiry_date TEXT,
ADD COLUMN IF NOT EXISTS card_holder_name TEXT;

-- Create indexes for better performance on new fields
CREATE INDEX IF NOT EXISTS idx_emails_email_type ON emails(email_type);
CREATE INDEX IF NOT EXISTS idx_emails_confidence ON emails(confidence);
CREATE INDEX IF NOT EXISTS idx_user_cards_card_number ON user_cards(card_number);
CREATE INDEX IF NOT EXISTS idx_user_cards_expiry_date ON user_cards(expiry_date);

-- Create a view for high-confidence card detections
CREATE OR REPLACE VIEW high_confidence_cards AS
SELECT 
    uc.id,
    uc.user_id,
    uc.card_name,
    uc.bank_name,
    uc.card_type,
    uc.card_network,
    uc.last_four_digits,
    uc.card_number,
    uc.expiry_date,
    uc.card_holder_name,
    uc.detection_confidence,
    uc.is_verified,
    uc.created_at,
    e.email_type,
    e.confidence as email_confidence
FROM user_cards uc
LEFT JOIN emails e ON uc.user_id = e.user_id 
    AND uc.card_name = ANY(e.matched_cards)
WHERE uc.detection_confidence >= 0.8 
    OR (e.confidence IS NOT NULL AND e.confidence >= 0.8);

-- Grant permissions
GRANT SELECT ON high_confidence_cards TO authenticated;

-- Add comments for documentation
COMMENT ON COLUMN emails.email_type IS 'Classification of email: statement, transaction, promotional, fraud, or other';
COMMENT ON COLUMN emails.confidence IS 'Confidence score for email classification (0.0 to 1.0)';
COMMENT ON COLUMN user_cards.card_number IS 'Masked card number for verification purposes';
COMMENT ON COLUMN user_cards.expiry_date IS 'Card expiry date in MM/YY format';
COMMENT ON COLUMN user_cards.card_holder_name IS 'Name of the cardholder';

-- Create function to clean up low-confidence detections
CREATE OR REPLACE FUNCTION cleanup_low_confidence_cards()
RETURNS void AS $$
BEGIN
    -- Mark low-confidence cards as inactive
    UPDATE user_cards 
    SET is_active = false, updated_at = NOW()
    WHERE detection_confidence < 0.6 
    AND is_verified = false 
    AND created_at < NOW() - INTERVAL '7 days';
    
    -- Delete low-confidence emails
    DELETE FROM emails 
    WHERE confidence < 0.5 
    AND processed_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- Create a scheduled job to run cleanup (if using pg_cron)
-- SELECT cron.schedule('cleanup-low-confidence-cards', '0 2 * * *', 'SELECT cleanup_low_confidence_cards();');
