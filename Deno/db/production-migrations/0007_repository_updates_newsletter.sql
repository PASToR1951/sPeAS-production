-- PeAS Repository Updates newsletter. This migration is intentionally additive:
-- existing content is not scanned or backfilled and both operational switches
-- remain off until institutional acceptance is complete.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.newsletter_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  launch_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  signup_enabled boolean NOT NULL DEFAULT false,
  delivery_paused boolean NOT NULL DEFAULT true,
  pause_reason text,
  last_weekly_cutoff timestamptz,
  worker_heartbeat_at timestamptz,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO public.newsletter_settings (id) VALUES (true);

CREATE TABLE public.newsletter_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(254) NOT NULL,
  email_normalized varchar(254) NOT NULL UNIQUE,
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'unsubscribed', 'suppressed')),
  cadence varchar(16) NOT NULL CHECK (cadence IN ('immediate', 'weekly')),
  wants_news boolean NOT NULL DEFAULT true,
  wants_papers boolean NOT NULL DEFAULT true,
  news_opted_in_at timestamptz,
  papers_opted_in_at timestamptz,
  cadence_changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  consent_notice_version varchar(80),
  consented_at timestamptz,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  suppressed_at timestamptz,
  suppression_reason varchar(255),
  token_version integer NOT NULL DEFAULT 1 CHECK (token_version > 0),
  last_confirmation_sent_at timestamptz,
  confirmation_window_started_at timestamptz,
  confirmation_window_count integer NOT NULL DEFAULT 0 CHECK (confirmation_window_count >= 0),
  last_delivered_at timestamptz,
  consecutive_delivery_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_delivery_failures >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (wants_news OR wants_papers)
);

CREATE INDEX newsletter_subscriptions_status_cadence_idx
  ON public.newsletter_subscriptions (status, cadence);

CREATE TABLE public.newsletter_verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.newsletter_subscriptions(id) ON DELETE CASCADE,
  requested_cadence varchar(16) NOT NULL CHECK (requested_cadence IN ('immediate', 'weekly')),
  requested_news boolean NOT NULL,
  requested_papers boolean NOT NULL,
  consent_notice_version varchar(80) NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (requested_news OR requested_papers)
);

CREATE INDEX newsletter_verifications_subscription_idx
  ON public.newsletter_verification_requests (subscription_id, created_at DESC);

CREATE TABLE public.newsletter_consent_events (
  id bigserial PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES public.newsletter_subscriptions(id) ON DELETE CASCADE,
  event_type varchar(32) NOT NULL
    CHECK (event_type IN ('confirmed', 'preferences_changed', 'cadence_changed', 'unsubscribed', 'reactivated')),
  consent_notice_version varchar(80),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.newsletter_publication_events (
  id bigserial PRIMARY KEY,
  source_type varchar(16) NOT NULL CHECK (source_type IN ('news', 'document', 'compilation')),
  source_id bigint NOT NULL,
  content_type varchar(12) NOT NULL CHECK (content_type IN ('news', 'papers')),
  first_published_at timestamptz NOT NULL,
  eligible_at timestamptz NOT NULL,
  state varchar(12) NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'void')),
  delivered_once boolean NOT NULL DEFAULT false,
  voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (source_type, source_id)
);

CREATE INDEX newsletter_publication_events_due_idx
  ON public.newsletter_publication_events (state, eligible_at) WHERE state = 'active';

CREATE TABLE public.newsletter_campaigns (
  id bigserial PRIMARY KEY,
  kind varchar(16) NOT NULL CHECK (kind IN ('immediate', 'weekly')),
  publication_event_id bigint REFERENCES public.newsletter_publication_events(id),
  period_start timestamptz,
  period_end timestamptz,
  status varchar(16) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  queued_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((kind = 'immediate' AND publication_event_id IS NOT NULL) OR
         (kind = 'weekly' AND publication_event_id IS NULL))
);

CREATE UNIQUE INDEX newsletter_campaign_immediate_unique
  ON public.newsletter_campaigns (publication_event_id) WHERE kind = 'immediate';
CREATE UNIQUE INDEX newsletter_campaign_weekly_unique
  ON public.newsletter_campaigns (period_end) WHERE kind = 'weekly';

CREATE TABLE public.newsletter_campaign_items (
  id bigserial PRIMARY KEY,
  campaign_id bigint NOT NULL REFERENCES public.newsletter_campaigns(id) ON DELETE CASCADE,
  publication_event_id bigint NOT NULL REFERENCES public.newsletter_publication_events(id),
  snapshot_schema_version integer NOT NULL DEFAULT 1,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (campaign_id, publication_event_id)
);

CREATE TABLE public.newsletter_mail_jobs (
  id bigserial PRIMARY KEY,
  kind varchar(16) NOT NULL CHECK (kind IN ('confirmation', 'campaign', 'test')),
  subscription_id uuid REFERENCES public.newsletter_subscriptions(id) ON DELETE CASCADE,
  verification_request_id uuid REFERENCES public.newsletter_verification_requests(id) ON DELETE CASCADE,
  campaign_id bigint REFERENCES public.newsletter_campaigns(id) ON DELETE CASCADE,
  recipient_email varchar(254),
  status varchar(16) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'sent', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  locked_at timestamptz,
  sent_at timestamptz,
  terminal_at timestamptz,
  error_code varchar(80),
  error_detail varchar(255),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((kind = 'confirmation' AND subscription_id IS NOT NULL AND verification_request_id IS NOT NULL) OR
         (kind = 'campaign' AND subscription_id IS NOT NULL AND campaign_id IS NOT NULL) OR
         (kind = 'test' AND recipient_email IS NOT NULL))
);

CREATE UNIQUE INDEX newsletter_campaign_recipient_unique
  ON public.newsletter_mail_jobs (campaign_id, subscription_id) WHERE kind = 'campaign';
CREATE INDEX newsletter_mail_jobs_claim_idx
  ON public.newsletter_mail_jobs (status, available_at, id);

CREATE OR REPLACE FUNCTION public.newsletter_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE TRIGGER newsletter_settings_touch BEFORE UPDATE ON public.newsletter_settings
FOR EACH ROW EXECUTE FUNCTION public.newsletter_touch_updated_at();
CREATE TRIGGER newsletter_subscriptions_touch BEFORE UPDATE ON public.newsletter_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.newsletter_touch_updated_at();
CREATE TRIGGER newsletter_events_touch BEFORE UPDATE ON public.newsletter_publication_events
FOR EACH ROW EXECUTE FUNCTION public.newsletter_touch_updated_at();
CREATE TRIGGER newsletter_jobs_touch BEFORE UPDATE ON public.newsletter_mail_jobs
FOR EACH ROW EXECUTE FUNCTION public.newsletter_touch_updated_at();

CREATE OR REPLACE FUNCTION public.newsletter_set_event(
  p_source_type text, p_source_id bigint, p_content_type text,
  p_published_at timestamptz, p_is_eligible boolean
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_launch timestamptz;
BEGIN
  SELECT launch_at INTO v_launch FROM public.newsletter_settings WHERE id = true;
  IF p_is_eligible AND p_published_at >= v_launch THEN
    INSERT INTO public.newsletter_publication_events
      (source_type, source_id, content_type, first_published_at, eligible_at)
    VALUES (p_source_type, p_source_id, p_content_type, p_published_at, p_published_at + interval '10 minutes')
    ON CONFLICT (source_type, source_id) DO UPDATE SET
      state = CASE WHEN newsletter_publication_events.delivered_once THEN newsletter_publication_events.state ELSE 'active' END,
      voided_at = CASE WHEN newsletter_publication_events.delivered_once THEN newsletter_publication_events.voided_at ELSE NULL END,
      first_published_at = CASE WHEN newsletter_publication_events.delivered_once THEN newsletter_publication_events.first_published_at ELSE EXCLUDED.first_published_at END,
      eligible_at = CASE WHEN newsletter_publication_events.delivered_once THEN newsletter_publication_events.eligible_at ELSE EXCLUDED.eligible_at END;
  ELSE
    UPDATE public.newsletter_publication_events
       SET state = 'void', voided_at = clock_timestamp()
     WHERE source_type = p_source_type AND source_id = p_source_id
       AND delivered_once = false;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.newsletter_refresh_compilation(p_compilation_id bigint)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_eligible boolean; v_published timestamptz;
BEGIN
  SELECT c.review_status = 'approved' AND c.deleted_at IS NULL AND EXISTS (
      SELECT 1 FROM public.documents d
      LEFT JOIN public.compiled_document_items i ON i.document_id = d.id
      WHERE (d.compiled_parent_id = c.id OR i.compiled_document_id = c.id)
        AND d.review_status = 'approved' AND d.is_public = true AND d.deleted_at IS NULL
    ), clock_timestamp()
    INTO v_eligible, v_published
    FROM public.compiled_documents c WHERE c.id = p_compilation_id;
  PERFORM public.newsletter_set_event('compilation', p_compilation_id, 'papers',
    COALESCE(v_published, clock_timestamp()), COALESCE(v_eligible, false));
END $$;

CREATE OR REPLACE FUNCTION public.newsletter_capture_news()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.newsletter_set_event('news', NEW.id, 'news',
    COALESCE(NEW.published_at, clock_timestamp()),
    NEW.status = 'published' AND NEW.published_at IS NOT NULL AND NEW.deleted_at IS NULL);
  RETURN NEW;
END $$;
CREATE TRIGGER newsletter_news_capture AFTER INSERT OR UPDATE OF status, published_at, deleted_at
ON public.news_posts FOR EACH ROW EXECUTE FUNCTION public.newsletter_capture_news();

CREATE OR REPLACE FUNCTION public.newsletter_capture_document()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_compilation bigint;
BEGIN
  SELECT COALESCE(NEW.compiled_parent_id, i.compiled_document_id) INTO v_compilation
  FROM (SELECT 1) x LEFT JOIN public.compiled_document_items i ON i.document_id = NEW.id LIMIT 1;
  IF v_compilation IS NULL THEN
    PERFORM public.newsletter_set_event('document', NEW.id, 'papers',
      clock_timestamp(),
      NEW.review_status = 'approved' AND NEW.is_public = true AND NEW.deleted_at IS NULL);
  ELSE
    PERFORM public.newsletter_set_event('document', NEW.id, 'papers', clock_timestamp(), false);
    PERFORM public.newsletter_refresh_compilation(v_compilation);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.compiled_parent_id IS NOT NULL AND OLD.compiled_parent_id IS DISTINCT FROM NEW.compiled_parent_id THEN
    PERFORM public.newsletter_refresh_compilation(OLD.compiled_parent_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER newsletter_document_capture AFTER INSERT OR UPDATE OF review_status, is_public, deleted_at, compiled_parent_id
ON public.documents FOR EACH ROW EXECUTE FUNCTION public.newsletter_capture_document();

CREATE OR REPLACE FUNCTION public.newsletter_capture_compilation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.newsletter_refresh_compilation(NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER newsletter_compilation_capture AFTER INSERT OR UPDATE OF review_status, deleted_at
ON public.compiled_documents FOR EACH ROW EXECUTE FUNCTION public.newsletter_capture_compilation();

CREATE OR REPLACE FUNCTION public.newsletter_capture_compilation_item()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM public.newsletter_refresh_compilation(OLD.compiled_document_id); END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM public.newsletter_set_event('document', NEW.document_id, 'papers', clock_timestamp(), false);
    PERFORM public.newsletter_refresh_compilation(NEW.compiled_document_id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER newsletter_compilation_item_capture AFTER INSERT OR UPDATE OR DELETE
ON public.compiled_document_items FOR EACH ROW EXECUTE FUNCTION public.newsletter_capture_compilation_item();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'peas_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      public.newsletter_settings, public.newsletter_subscriptions,
      public.newsletter_verification_requests, public.newsletter_consent_events,
      public.newsletter_publication_events, public.newsletter_campaigns,
      public.newsletter_campaign_items, public.newsletter_mail_jobs TO peas_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO peas_app;
    GRANT EXECUTE ON FUNCTION public.newsletter_set_event(text,bigint,text,timestamptz,boolean),
      public.newsletter_refresh_compilation(bigint), public.newsletter_touch_updated_at(),
      public.newsletter_capture_news(), public.newsletter_capture_document(),
      public.newsletter_capture_compilation(), public.newsletter_capture_compilation_item() TO peas_app;
  END IF;
END $$;
