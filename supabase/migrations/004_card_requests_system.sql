-- Migration: Card Requests System
-- Description: Allows users to request card usage from friends

-- Create card_requests table
CREATE TABLE IF NOT EXISTS public.card_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    card_owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    card_id UUID NOT NULL REFERENCES public.user_cards(id) ON DELETE CASCADE,
    request_message TEXT,
    response_message TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    responded_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days'),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_card_requests_requester_id ON public.card_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_card_requests_card_owner_id ON public.card_requests(card_owner_id);
CREATE INDEX IF NOT EXISTS idx_card_requests_card_id ON public.card_requests(card_id);
CREATE INDEX IF NOT EXISTS idx_card_requests_status ON public.card_requests(status);
CREATE INDEX IF NOT EXISTS idx_card_requests_requested_at ON public.card_requests(requested_at);
CREATE INDEX IF NOT EXISTS idx_card_requests_expires_at ON public.card_requests(expires_at);

-- Create composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_card_requests_owner_status ON public.card_requests(card_owner_id, status);
CREATE INDEX IF NOT EXISTS idx_card_requests_requester_status ON public.card_requests(requester_id, status);

-- Add RLS policies
ALTER TABLE public.card_requests ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view requests they sent
CREATE POLICY "Users can view requests they sent" ON public.card_requests
    FOR SELECT USING (auth.uid() = requester_id);

-- Policy: Users can view requests they received
CREATE POLICY "Users can view requests they received" ON public.card_requests
    FOR SELECT USING (auth.uid() = card_owner_id);

-- Policy: Users can create requests
CREATE POLICY "Users can create card requests" ON public.card_requests
    FOR INSERT WITH CHECK (auth.uid() = requester_id);

-- Policy: Card owners can update requests they received
CREATE POLICY "Card owners can update requests they received" ON public.card_requests
    FOR UPDATE USING (auth.uid() = card_owner_id);

-- Policy: Users can delete their own requests
CREATE POLICY "Users can delete their own requests" ON public.card_requests
    FOR DELETE USING (auth.uid() = requester_id OR auth.uid() = card_owner_id);

-- Create function to automatically expire old requests
CREATE OR REPLACE FUNCTION expire_old_card_requests()
RETURNS void AS $$
BEGIN
    UPDATE public.card_requests 
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'pending' AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Create a trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_card_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_card_requests_updated_at
    BEFORE UPDATE ON public.card_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_card_requests_updated_at();

-- Add some helpful views for analytics
CREATE OR REPLACE VIEW public.card_requests_summary AS
SELECT 
    cr.id,
    cr.requester_id,
    cr.card_owner_id,
    cr.card_id,
    cr.status,
    cr.requested_at,
    cr.responded_at,
    cr.expires_at,
    uc.card_name,
    uc.bank_name,
    uc.card_type,
    requester.email as requester_email,
    requester.raw_user_meta_data->>'full_name' as requester_name,
    owner.email as owner_email,
    owner.raw_user_meta_data->>'full_name' as owner_name
FROM public.card_requests cr
JOIN public.user_cards uc ON cr.card_id = uc.id
JOIN auth.users requester ON cr.requester_id = requester.id
JOIN auth.users owner ON cr.card_owner_id = owner.id;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_requests TO authenticated;
GRANT SELECT ON public.card_requests_summary TO authenticated;

-- Add comments for documentation
COMMENT ON TABLE public.card_requests IS 'Stores card usage requests between users';
COMMENT ON COLUMN public.card_requests.requester_id IS 'User requesting to use the card';
COMMENT ON COLUMN public.card_requests.card_owner_id IS 'User who owns the card';
COMMENT ON COLUMN public.card_requests.card_id IS 'The card being requested';
COMMENT ON COLUMN public.card_requests.status IS 'Request status: pending, accepted, rejected, expired';
COMMENT ON COLUMN public.card_requests.expires_at IS 'When the request expires (default 7 days)';
