-- Add investor_type and rules_accepted to yacht event attendees
ALTER TABLE yacht_event_attendees ADD COLUMN investor_type TEXT;
ALTER TABLE yacht_event_attendees ADD COLUMN rules_accepted INTEGER DEFAULT 0;
