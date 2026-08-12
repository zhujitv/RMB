ALTER TABLE "business_entities"
  ADD COLUMN "show_contact_phone_on_pi" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "show_contact_email_on_pi" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "show_website_on_pi" BOOLEAN NOT NULL DEFAULT false;
