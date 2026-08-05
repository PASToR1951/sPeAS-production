--
-- PostgreSQL database dump
--

\restrict 6ewJSGDRaAH6dpCmasgY0EFctToPkGYd3bzSX3mmr6iE2xTrvwEZBWcIts6GPkQ

-- Dumped from database version 17.10
-- Dumped by pg_dump version 17.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: document_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.document_type AS ENUM (
    'THESIS',
    'DISSERTATION',
    'CONFLUENCE',
    'SYNERGY'
);


--
-- Name: peas_validate_document_classification_overlap(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.peas_validate_document_classification_overlap() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  target_document_id INTEGER;
BEGIN
  target_document_id := COALESCE(NEW.document_id, OLD.document_id);

  IF EXISTS (
    SELECT 1
    FROM public.document_research_agenda dra
    JOIN public.research_agenda ra ON ra.id = dra.research_agenda_id
    JOIN public.document_topics dt ON dt.document_id = dra.document_id
    JOIN public.topics t ON t.id = dt.topic_id
    WHERE dra.document_id = target_document_id
      AND ra.normalized_name = t.normalized_name
  ) OR EXISTS (
    SELECT 1
    FROM public.document_research_agenda dra
    JOIN public.research_agenda ra ON ra.id = dra.research_agenda_id
    JOIN public.document_keywords dk ON dk.document_id = dra.document_id
    JOIN public.keywords k ON k.id = dk.keyword_id
    WHERE dra.document_id = target_document_id
      AND ra.normalized_name = k.normalized_term
  ) OR EXISTS (
    SELECT 1
    FROM public.document_topics dt
    JOIN public.topics t ON t.id = dt.topic_id
    JOIN public.document_keywords dk ON dk.document_id = dt.document_id
    JOIN public.keywords k ON k.id = dk.keyword_id
    WHERE dt.document_id = target_document_id
      AND t.normalized_name = k.normalized_term
  ) THEN
    RAISE EXCEPTION 'A document cannot reuse the same normalized term across research agenda, topic, and keyword classifications'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: sync_user_role_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_user_role_fields() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  resolved_role_id integer;
  resolved_role_name varchar(50);
BEGIN
  IF TG_OP = 'INSERT' AND NEW.role IS NOT NULL THEN
    SELECT id, lower(role_name)
    INTO resolved_role_id, resolved_role_name
    FROM public.roles
    WHERE lower(role_name) = lower(NEW.role)
    LIMIT 1;
  ELSIF TG_OP = 'INSERT' AND NEW.role_id IS NOT NULL THEN
    SELECT id, lower(role_name)
    INTO resolved_role_id, resolved_role_name
    FROM public.roles
    WHERE id = NEW.role_id
    LIMIT 1;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT id, lower(role_name)
    INTO resolved_role_id, resolved_role_name
    FROM public.roles
    WHERE lower(role_name) = 'user'
    LIMIT 1;
  ELSIF NEW.role IS DISTINCT FROM OLD.role THEN
    SELECT id, lower(role_name)
    INTO resolved_role_id, resolved_role_name
    FROM public.roles
    WHERE lower(role_name) = lower(COALESCE(NEW.role, 'user'))
    LIMIT 1;
  ELSIF NEW.role_id IS DISTINCT FROM OLD.role_id THEN
    SELECT id, lower(role_name)
    INTO resolved_role_id, resolved_role_name
    FROM public.roles
    WHERE id = NEW.role_id
    LIMIT 1;
  ELSE
    SELECT id, lower(role_name)
    INTO resolved_role_id, resolved_role_name
    FROM public.roles
    WHERE lower(role_name) = lower(COALESCE(NEW.role, 'user'))
    LIMIT 1;
  END IF;

  IF resolved_role_id IS NULL THEN
    RAISE EXCEPTION 'Unknown PeAS role: %', COALESCE(NEW.role, NEW.role_id::text, 'NULL');
  END IF;

  NEW.role_id := resolved_role_id;
  NEW.role := resolved_role_name;
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: abstract_extraction_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.abstract_extraction_jobs (
    id bigint NOT NULL,
    target_type character varying(24) NOT NULL,
    document_id integer,
    compiled_document_id integer,
    source_sha256 character(64),
    status character varying(20) DEFAULT 'queued'::character varying NOT NULL,
    method character varying(20),
    candidate_text text,
    confidence numeric(4,3),
    quality_flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    page_start integer,
    page_end integer,
    attempt_count integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    locked_at timestamp with time zone,
    locked_by character varying(120),
    last_error_code character varying(120),
    review_action character varying(24),
    reviewed_by character varying,
    reviewed_at timestamp with time zone,
    is_current boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT abstract_extraction_jobs_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT abstract_extraction_jobs_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)))),
    CONSTRAINT abstract_extraction_jobs_method_check CHECK (((method IS NULL) OR ((method)::text = ANY ((ARRAY['pdf_text'::character varying, 'ocr'::character varying, 'none'::character varying])::text[])))),
    CONSTRAINT abstract_extraction_jobs_review_action_check CHECK (((review_action IS NULL) OR ((review_action)::text = ANY ((ARRAY['accept_candidate'::character varying, 'save_manual'::character varying, 'mark_unavailable'::character varying])::text[])))),
    CONSTRAINT abstract_extraction_jobs_status_check CHECK (((status)::text = ANY ((ARRAY['queued'::character varying, 'processing'::character varying, 'needs_review'::character varying, 'accepted'::character varying, 'unavailable'::character varying, 'failed'::character varying, 'superseded'::character varying])::text[]))),
    CONSTRAINT abstract_extraction_jobs_target_type_check CHECK (((target_type)::text = ANY ((ARRAY['document'::character varying, 'compiled_foreword'::character varying])::text[]))),
    CONSTRAINT abstract_extraction_page_range_check CHECK ((((page_start IS NULL) AND (page_end IS NULL)) OR ((page_start IS NOT NULL) AND (page_start > 0) AND (page_end IS NOT NULL) AND (page_end >= page_start)))),
    CONSTRAINT abstract_extraction_source_sha256_check CHECK (((source_sha256 IS NULL) OR (source_sha256 ~* '^[0-9a-f]{64}$'::text))),
    CONSTRAINT abstract_extraction_target_check CHECK (((((target_type)::text = 'document'::text) AND (document_id IS NOT NULL) AND (compiled_document_id IS NULL)) OR (((target_type)::text = 'compiled_foreword'::text) AND (document_id IS NULL) AND (compiled_document_id IS NOT NULL))))
);


--
-- Name: abstract_extraction_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.abstract_extraction_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: abstract_extraction_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.abstract_extraction_jobs_id_seq OWNED BY public.abstract_extraction_jobs.id;


--
-- Name: abstract_extraction_worker_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.abstract_extraction_worker_state (
    state_id boolean DEFAULT true NOT NULL,
    worker_id character varying(120),
    worker_version character varying(120),
    last_heartbeat_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT abstract_extraction_worker_state_state_id_check CHECK ((state_id IS TRUE))
);


--
-- Name: account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account (
    id character varying NOT NULL,
    user_id character varying NOT NULL,
    account_id character varying NOT NULL,
    provider_id character varying NOT NULL,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamp with time zone,
    refresh_token_expires_at timestamp with time zone,
    scope text,
    password text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: admin_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_notifications (
    id bigint NOT NULL,
    notification_type character varying(80) NOT NULL,
    entity_type character varying(80) NOT NULL,
    entity_id text NOT NULL,
    severity character varying(20) DEFAULT 'info'::character varying NOT NULL,
    title character varying(255) NOT NULL,
    message text NOT NULL,
    action_path character varying(500),
    is_read boolean DEFAULT false NOT NULL,
    dismissed_at timestamp without time zone,
    resolved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT admin_notifications_severity_check CHECK (((severity)::text = ANY ((ARRAY['info'::character varying, 'warning'::character varying, 'urgent'::character varying])::text[])))
);


--
-- Name: admin_notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admin_notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: admin_notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.admin_notifications_id_seq OWNED BY public.admin_notifications.id;


--
-- Name: affiliations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.affiliations (
    id integer NOT NULL,
    affiliation_name character varying(255) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: affiliations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.affiliations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: affiliations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.affiliations_id_seq OWNED BY public.affiliations.id;


--
-- Name: author_activity_rollups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.author_activity_rollups (
    grain character varying(8) NOT NULL,
    bucket_start timestamp with time zone NOT NULL,
    author_id uuid NOT NULL,
    audience character varying(16) NOT NULL,
    visit_count bigint DEFAULT 0 NOT NULL,
    last_recorded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    view_count bigint DEFAULT 0 NOT NULL,
    CONSTRAINT author_activity_rollups_audience_check CHECK (((audience)::text = ANY ((ARRAY['guest'::character varying, 'registered'::character varying])::text[]))),
    CONSTRAINT author_activity_rollups_grain_check CHECK (((grain)::text = ANY ((ARRAY['hour'::character varying, 'day'::character varying])::text[]))),
    CONSTRAINT author_activity_rollups_view_count_check CHECK ((view_count >= 0)),
    CONSTRAINT author_activity_rollups_visit_count_check CHECK ((visit_count >= 0))
);


--
-- Name: TABLE author_activity_rollups; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.author_activity_rollups IS 'Identifier-free hourly and daily author-profile aggregates for administrator reporting.';


--
-- Name: COLUMN author_activity_rollups.view_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.author_activity_rollups.view_count IS 'Canonical successful public author-profile response count.';


--
-- Name: author_visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.author_visits (
    id integer NOT NULL,
    author_id uuid NOT NULL,
    visitor_type character varying(10) NOT NULL,
    user_id character varying,
    ip_address character varying(45),
    visit_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT author_visits_visitor_type_check CHECK (((visitor_type)::text = ANY (ARRAY[('guest'::character varying)::text, ('user'::character varying)::text])))
);


--
-- Name: TABLE author_visits; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.author_visits IS 'Tracks visits to author profiles';


--
-- Name: COLUMN author_visits.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.author_visits.id IS 'Primary key';


--
-- Name: COLUMN author_visits.author_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.author_visits.author_id IS 'Foreign key to authors table';


--
-- Name: COLUMN author_visits.visitor_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.author_visits.visitor_type IS 'Type of visitor (guest/user)';


--
-- Name: COLUMN author_visits.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.author_visits.user_id IS 'Foreign key to users table, only set for logged-in users';


--
-- Name: COLUMN author_visits.ip_address; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.author_visits.ip_address IS 'IP address of the visitor';


--
-- Name: COLUMN author_visits.visit_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.author_visits.visit_date IS 'Timestamp of when the visit occurred';


--
-- Name: author_visits_counter; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.author_visits_counter (
    author_id character varying(50) NOT NULL,
    date date DEFAULT CURRENT_DATE NOT NULL,
    visitor_type character varying(10) NOT NULL,
    visit_count integer DEFAULT 1,
    CONSTRAINT author_visits_counter_visitor_type_check CHECK (((visitor_type)::text = ANY ((ARRAY['guest'::character varying, 'user'::character varying])::text[])))
);


--
-- Name: TABLE author_visits_counter; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.author_visits_counter IS 'Counter-based tracking of author profile visits by date';


--
-- Name: author_visits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.author_visits_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: author_visits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.author_visits_id_seq OWNED BY public.author_visits.id;


--
-- Name: authors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.authors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    spud_id character varying(50),
    full_name character varying(255) NOT NULL,
    affiliation character varying(255),
    department character varying(255),
    email character varying(255),
    orcid_id character varying(255),
    biography text,
    profile_picture character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_source character varying(40) DEFAULT 'author_directory'::character varying NOT NULL
);


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id integer NOT NULL,
    category_name character varying(255) NOT NULL
);


--
-- Name: categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.categories_id_seq OWNED BY public.categories.id;


--
-- Name: classification_migration_review; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.classification_migration_review (
    document_id integer NOT NULL,
    legacy_research_agenda_id integer NOT NULL,
    legacy_value character varying(255) NOT NULL,
    suggested_type character varying(20),
    decision character varying(20),
    target_id integer,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    reviewed_by character varying(255),
    reviewed_at timestamp without time zone,
    notes text,
    CONSTRAINT classification_review_decision_check CHECK (((decision IS NULL) OR ((decision)::text = ANY ((ARRAY['agenda'::character varying, 'topic'::character varying, 'keyword'::character varying, 'discard'::character varying])::text[])))),
    CONSTRAINT classification_review_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'resolved'::character varying])::text[]))),
    CONSTRAINT classification_review_suggested_type_check CHECK (((suggested_type IS NULL) OR ((suggested_type)::text = ANY ((ARRAY['agenda'::character varying, 'topic'::character varying, 'keyword'::character varying, 'discard'::character varying])::text[]))))
);


--
-- Name: compiled_document_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compiled_document_items (
    id integer NOT NULL,
    compiled_document_id integer,
    document_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: compiled_document_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.compiled_document_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: compiled_document_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.compiled_document_items_id_seq OWNED BY public.compiled_document_items.id;


--
-- Name: compiled_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compiled_documents (
    id integer NOT NULL,
    start_year integer,
    end_year integer,
    volume integer,
    issue_number integer,
    department character varying(255),
    category character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp without time zone,
    foreword character varying(255),
    uploaded_by character varying,
    review_status character varying(20) DEFAULT 'approved'::character varying NOT NULL,
    reviewed_by character varying,
    reviewed_at timestamp with time zone,
    abstract_foreword text,
    abstract_foreword_source character varying(20) DEFAULT 'none'::character varying NOT NULL,
    abstract_foreword_reviewed_by character varying,
    abstract_foreword_reviewed_at timestamp with time zone,
    foreword_content_sha256 character(64),
    CONSTRAINT compiled_documents_abstract_foreword_source_check CHECK (((abstract_foreword_source)::text = ANY ((ARRAY['none'::character varying, 'manual'::character varying, 'pdf_text'::character varying, 'ocr'::character varying, 'legacy'::character varying])::text[]))),
    CONSTRAINT compiled_documents_foreword_sha256_check CHECK (((foreword_content_sha256 IS NULL) OR (foreword_content_sha256 ~* '^[0-9a-f]{64}$'::text))),
    CONSTRAINT compiled_documents_review_status_check CHECK (((review_status)::text = ANY ((ARRAY['pending_review'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[])))
);


--
-- Name: COLUMN compiled_documents.abstract_foreword; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.compiled_documents.abstract_foreword IS 'Abstract text extracted from the foreword PDF file';


--
-- Name: compiled_documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.compiled_documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: compiled_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.compiled_documents_id_seq OWNED BY public.compiled_documents.id;


--
-- Name: contact_inquiries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_inquiries (
    id bigint NOT NULL,
    reference_code character varying(32) NOT NULL,
    first_name character varying(80) NOT NULL,
    last_name character varying(80) NOT NULL,
    email character varying(254) NOT NULL,
    subject character varying(160) NOT NULL,
    message text NOT NULL,
    status character varying(16) DEFAULT 'new'::character varying NOT NULL,
    notification_status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    resolved_at timestamp with time zone,
    first_read_at timestamp with time zone,
    CONSTRAINT contact_inquiries_notification_status_check CHECK (((notification_status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'sent'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT contact_inquiries_status_check CHECK (((status)::text = ANY ((ARRAY['new'::character varying, 'read'::character varying, 'resolved'::character varying, 'spam'::character varying])::text[])))
);


--
-- Name: contact_inquiries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contact_inquiries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contact_inquiries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contact_inquiries_id_seq OWNED BY public.contact_inquiries.id;


--
-- Name: contact_inquiry_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_inquiry_notes (
    id bigint NOT NULL,
    inquiry_id bigint NOT NULL,
    administrator_user_id text NOT NULL,
    note text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT contact_inquiry_notes_note_check CHECK (((char_length(note) >= 1) AND (char_length(note) <= 5000)))
);


--
-- Name: contact_inquiry_notes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contact_inquiry_notes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contact_inquiry_notes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contact_inquiry_notes_id_seq OWNED BY public.contact_inquiry_notes.id;


--
-- Name: contact_inquiry_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_inquiry_status_history (
    id bigint NOT NULL,
    inquiry_id bigint NOT NULL,
    administrator_user_id text NOT NULL,
    previous_status character varying(16) NOT NULL,
    new_status character varying(16) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: contact_inquiry_status_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contact_inquiry_status_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contact_inquiry_status_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contact_inquiry_status_history_id_seq OWNED BY public.contact_inquiry_status_history.id;


--
-- Name: contact_notification_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_notification_jobs (
    id bigint NOT NULL,
    inquiry_id bigint NOT NULL,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_error character varying(500),
    processing_started_at timestamp with time zone,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT contact_notification_jobs_attempt_count_check CHECK (((attempt_count >= 0) AND (attempt_count <= 5))),
    CONSTRAINT contact_notification_jobs_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'sent'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: contact_notification_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contact_notification_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contact_notification_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contact_notification_jobs_id_seq OWNED BY public.contact_notification_jobs.id;


--
-- Name: credentials_legacy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credentials_legacy (
    id integer NOT NULL,
    user_id character varying NOT NULL,
    password text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: credentials_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.credentials_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: credentials_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.credentials_id_seq OWNED BY public.credentials_legacy.id;


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    id integer NOT NULL,
    department_name character varying(255) NOT NULL,
    code character varying(10)
);


--
-- Name: departments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.departments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: departments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.departments_id_seq OWNED BY public.departments.id;


--
-- Name: document_access_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_access_tokens (
    id integer NOT NULL,
    request_id integer NOT NULL,
    document_id text NOT NULL,
    email character varying(255) NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    used_at timestamp with time zone,
    access_count integer DEFAULT 0,
    revoked_at timestamp with time zone
);


--
-- Name: TABLE document_access_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.document_access_tokens IS 'Time-limited access tokens for approved outsider document requests';


--
-- Name: COLUMN document_access_tokens.token_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.document_access_tokens.token_hash IS 'SHA-256 hash of the raw download token; the raw token is only sent to the requester';


--
-- Name: document_access_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.document_access_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: document_access_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.document_access_tokens_id_seq OWNED BY public.document_access_tokens.id;


--
-- Name: document_annotation_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_annotation_sources (
    id uuid NOT NULL,
    document_id integer NOT NULL,
    fingerprint character varying(180) NOT NULL,
    page_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    content_sha256 character(64),
    is_current boolean DEFAULT false NOT NULL,
    CONSTRAINT document_annotation_sources_page_count_check CHECK ((page_count >= 0)),
    CONSTRAINT document_annotation_sources_sha256_check CHECK (((content_sha256 IS NULL) OR (content_sha256 ~* '^[0-9a-f]{64}$'::text)))
);


--
-- Name: document_authors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_authors (
    document_id integer NOT NULL,
    author_id uuid NOT NULL,
    author_order integer NOT NULL
);


--
-- Name: document_categories; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.document_categories AS
 SELECT id,
    category_name AS category,
    now() AS created_at,
    now() AS updated_at
   FROM public.categories;


--
-- Name: document_keywords; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_keywords (
    document_id integer NOT NULL,
    keyword_id integer NOT NULL,
    keyword_order integer DEFAULT 1 NOT NULL,
    assigned_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    assigned_by character varying(255)
);


--
-- Name: document_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_permissions (
    id integer NOT NULL,
    document_id integer NOT NULL,
    user_id character varying,
    role_id integer,
    can_view boolean DEFAULT false,
    can_download boolean DEFAULT false,
    can_manage boolean DEFAULT false,
    granted_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    granted_by character varying,
    CONSTRAINT document_permissions_check CHECK ((((user_id IS NOT NULL) AND (role_id IS NULL)) OR ((user_id IS NULL) AND (role_id IS NOT NULL))))
);


--
-- Name: document_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.document_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: document_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.document_permissions_id_seq OWNED BY public.document_permissions.id;


--
-- Name: document_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_requests (
    id integer NOT NULL,
    document_id character varying(255) NOT NULL,
    full_name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    affiliation character varying(255) NOT NULL,
    reason character varying(255) NOT NULL,
    reason_details text NOT NULL,
    status character varying(20) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    reviewed_by character varying(255),
    reviewed_at timestamp without time zone,
    review_notes text,
    email_sent boolean,
    email_error text,
    is_entire_collection boolean DEFAULT false,
    child_documents integer[],
    CONSTRAINT document_requests_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('approved'::character varying)::text, ('rejected'::character varying)::text])))
);


--
-- Name: document_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.document_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: document_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.document_requests_id_seq OWNED BY public.document_requests.id;


--
-- Name: document_research_agenda; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_research_agenda (
    document_id integer NOT NULL,
    research_agenda_id integer NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    assigned_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    assigned_by character varying(255)
);


--
-- Name: document_topics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_topics (
    document_id integer NOT NULL,
    topic_id integer NOT NULL,
    topic_order integer DEFAULT 1 NOT NULL,
    assigned_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    assigned_by character varying(255)
);


--
-- Name: document_visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_visits (
    doc_id character varying(50) NOT NULL,
    date date DEFAULT CURRENT_DATE NOT NULL,
    visitor_type character varying(10) NOT NULL,
    visit_count integer DEFAULT 1,
    CONSTRAINT document_visits_visitor_type_check CHECK (((visitor_type)::text = ANY ((ARRAY['guest'::character varying, 'user'::character varying])::text[])))
);


--
-- Name: TABLE document_visits; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.document_visits IS 'Counter-based tracking of document visits by date';


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    abstract text,
    publication_date date,
    start_year integer,
    end_year integer,
    category_id integer,
    department_id integer,
    file_path text NOT NULL,
    pages integer,
    is_public boolean DEFAULT false,
    document_type public.document_type NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp without time zone,
    volume character varying(50),
    issue character varying(50),
    compiled_parent_id integer,
    uploaded_by character varying,
    review_status character varying(20) DEFAULT 'approved'::character varying NOT NULL,
    reviewed_by character varying,
    reviewed_at timestamp with time zone,
    abstract_source character varying(20) DEFAULT 'none'::character varying NOT NULL,
    abstract_reviewed_by character varying,
    abstract_reviewed_at timestamp with time zone,
    content_sha256 character(64),
    CONSTRAINT documents_abstract_source_check CHECK (((abstract_source)::text = ANY ((ARRAY['none'::character varying, 'manual'::character varying, 'pdf_text'::character varying, 'ocr'::character varying, 'legacy'::character varying])::text[]))),
    CONSTRAINT documents_content_sha256_check CHECK (((content_sha256 IS NULL) OR (content_sha256 ~* '^[0-9a-f]{64}$'::text))),
    CONSTRAINT documents_review_status_check CHECK (((review_status)::text = ANY ((ARRAY['pending_review'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[])))
);


--
-- Name: documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.documents_id_seq OWNED BY public.documents.id;


--
-- Name: files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.files (
    id integer NOT NULL,
    file_name character varying(255) NOT NULL,
    file_path text NOT NULL,
    file_size integer,
    file_type character varying(50),
    document_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: files_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.files_id_seq OWNED BY public.files.id;


--
-- Name: keywords; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.keywords (
    id integer NOT NULL,
    term character varying(80) NOT NULL,
    normalized_term character varying(80) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT keywords_term_length_check CHECK (((char_length(btrim((term)::text)) >= 2) AND (char_length(btrim((term)::text)) <= 80)))
);


--
-- Name: keywords_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.keywords ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.keywords_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: legacy_public_path_daily_hits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legacy_public_path_daily_hits (
    release_id character varying(160) NOT NULL,
    hit_date date DEFAULT CURRENT_DATE NOT NULL,
    path text NOT NULL,
    method character varying(12) NOT NULL,
    response_status smallint NOT NULL,
    hit_count bigint DEFAULT 1 NOT NULL,
    first_seen_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_seen_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT legacy_public_path_daily_hits_hit_count_check CHECK ((hit_count > 0)),
    CONSTRAINT legacy_public_path_daily_hits_response_status_check CHECK (((response_status >= 100) AND (response_status <= 599)))
);


--
-- Name: legacy_public_release_soak; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legacy_public_release_soak (
    release_id character varying(160) NOT NULL,
    first_started_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_started_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    legacy_hit_count bigint DEFAULT 0 NOT NULL,
    last_legacy_hit_at timestamp with time zone,
    CONSTRAINT legacy_public_release_soak_legacy_hit_count_check CHECK ((legacy_hit_count >= 0))
);


--
-- Name: news_media_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.news_media_assets (
    id uuid NOT NULL,
    media_type character varying(16) NOT NULL,
    status character varying(20) DEFAULT 'uploading'::character varying NOT NULL,
    original_name text DEFAULT ''::text NOT NULL,
    source_mime character varying(120) NOT NULL,
    source_size bigint NOT NULL,
    source_sha256 character(64),
    width integer,
    height integer,
    duration_ms bigint,
    title character varying(255),
    alt_text text,
    is_decorative boolean DEFAULT false NOT NULL,
    caption text,
    credit character varying(255),
    poster_alt_text text,
    transcript text,
    source_key text,
    error_code character varying(80),
    created_by character varying(50),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ready_at timestamp with time zone,
    deleted_at timestamp with time zone,
    source_expires_at timestamp with time zone,
    CONSTRAINT news_media_assets_media_type_check CHECK (((media_type)::text = ANY ((ARRAY['image'::character varying, 'audio'::character varying, 'video'::character varying])::text[]))),
    CONSTRAINT news_media_assets_source_size_check CHECK ((source_size >= 0)),
    CONSTRAINT news_media_assets_status_check CHECK (((status)::text = ANY ((ARRAY['uploading'::character varying, 'verifying'::character varying, 'queued'::character varying, 'processing'::character varying, 'ready'::character varying, 'failed'::character varying, 'quarantined'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: news_media_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.news_media_jobs (
    id bigint NOT NULL,
    asset_id uuid NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    locked_at timestamp with time zone,
    locked_by character varying(120),
    last_error character varying(500),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT news_media_jobs_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: news_media_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.news_media_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: news_media_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.news_media_jobs_id_seq OWNED BY public.news_media_jobs.id;


--
-- Name: news_media_tracks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.news_media_tracks (
    id bigint NOT NULL,
    asset_id uuid NOT NULL,
    track_type character varying(20) NOT NULL,
    language character varying(16) DEFAULT 'en'::character varying NOT NULL,
    label character varying(120) DEFAULT 'English'::character varying NOT NULL,
    storage_key text,
    text_content text,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT news_media_tracks_track_type_check CHECK (((track_type)::text = ANY ((ARRAY['captions'::character varying, 'transcript'::character varying])::text[])))
);


--
-- Name: news_media_tracks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.news_media_tracks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: news_media_tracks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.news_media_tracks_id_seq OWNED BY public.news_media_tracks.id;


--
-- Name: news_media_upload_parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.news_media_upload_parts (
    session_id uuid NOT NULL,
    part_number integer NOT NULL,
    size_bytes bigint NOT NULL,
    checksum character(64),
    storage_key text NOT NULL,
    received_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT news_media_upload_parts_part_number_check CHECK ((part_number > 0)),
    CONSTRAINT news_media_upload_parts_size_bytes_check CHECK ((size_bytes > 0))
);


--
-- Name: news_media_upload_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.news_media_upload_sessions (
    id uuid NOT NULL,
    asset_id uuid NOT NULL,
    created_by character varying(50),
    expected_size bigint NOT NULL,
    part_size integer NOT NULL,
    received_size bigint DEFAULT 0 NOT NULL,
    part_count integer DEFAULT 0 NOT NULL,
    backend character varying(16) DEFAULT 'local'::character varying NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT news_media_upload_sessions_backend_check CHECK (((backend)::text = ANY ((ARRAY['local'::character varying, 's3'::character varying])::text[]))),
    CONSTRAINT news_media_upload_sessions_expected_size_check CHECK ((expected_size > 0)),
    CONSTRAINT news_media_upload_sessions_part_size_check CHECK ((part_size >= 5242880)),
    CONSTRAINT news_media_upload_sessions_received_size_check CHECK ((received_size >= 0))
);


--
-- Name: news_media_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.news_media_variants (
    id bigint NOT NULL,
    asset_id uuid NOT NULL,
    variant_key character varying(120) NOT NULL,
    mime_type character varying(120) NOT NULL,
    storage_key text NOT NULL,
    size_bytes bigint NOT NULL,
    width integer,
    height integer,
    bitrate integer,
    checksum character(64),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT news_media_variants_size_bytes_check CHECK ((size_bytes >= 0))
);


--
-- Name: news_media_variants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.news_media_variants_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: news_media_variants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.news_media_variants_id_seq OWNED BY public.news_media_variants.id;


--
-- Name: news_post_authors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.news_post_authors (
    news_post_id bigint NOT NULL,
    author_id uuid NOT NULL,
    "position" smallint DEFAULT 0 NOT NULL
);


--
-- Name: news_post_media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.news_post_media (
    news_post_id bigint NOT NULL,
    asset_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL
);


--
-- Name: news_post_works; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.news_post_works (
    news_post_id bigint NOT NULL,
    record_type character varying(20) NOT NULL,
    record_id integer NOT NULL,
    "position" smallint DEFAULT 0 NOT NULL,
    CONSTRAINT news_post_works_record_type_check CHECK (((record_type)::text = ANY ((ARRAY['document'::character varying, 'compiled'::character varying])::text[])))
);


--
-- Name: news_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.news_posts (
    id bigint NOT NULL,
    title character varying(255) NOT NULL,
    slug character varying(255) NOT NULL,
    excerpt text NOT NULL,
    body text NOT NULL,
    body_format character varying(20) DEFAULT 'plain'::character varying NOT NULL,
    cover_image_url text,
    cover_image_alt character varying(255) DEFAULT ''::character varying NOT NULL,
    author_name character varying(160) DEFAULT 'Office of Research & Publications'::character varying NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    published_at timestamp with time zone,
    created_by text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    cover_media_id uuid,
    CONSTRAINT news_posts_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'published'::character varying])::text[])))
);


--
-- Name: news_posts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.news_posts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: news_posts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.news_posts_id_seq OWNED BY public.news_posts.id;


--
-- Name: operational_analytics_backfills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operational_analytics_backfills (
    version character varying(64) NOT NULL,
    cutoff_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ambiguous_repository_rows bigint DEFAULT 0 NOT NULL,
    skipped_repository_rows bigint DEFAULT 0 NOT NULL,
    skipped_invalid_rows bigint DEFAULT 0 NOT NULL,
    notes jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: operational_analytics_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operational_analytics_state (
    state_id boolean DEFAULT true NOT NULL,
    schema_version character varying(16) DEFAULT 'v2'::character varying NOT NULL,
    writes_enabled boolean DEFAULT false NOT NULL,
    reads_enabled boolean DEFAULT false NOT NULL,
    live_started_at timestamp with time zone,
    last_backfill_version character varying(64),
    last_reconciliation_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    traffic_v3_writes_enabled boolean DEFAULT false NOT NULL,
    traffic_v3_reads_enabled boolean DEFAULT false NOT NULL,
    traffic_v3_started_at timestamp with time zone,
    search_analytics_writes_enabled boolean DEFAULT false NOT NULL,
    search_analytics_reads_enabled boolean DEFAULT false NOT NULL,
    search_analytics_started_at timestamp with time zone,
    CONSTRAINT operational_analytics_state_state_id_check CHECK (state_id)
);


--
-- Name: COLUMN operational_analytics_state.writes_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.operational_analytics_state.writes_enabled IS 'Explicit cutover switch; content delivery remains independent of analytics availability.';


--
-- Name: COLUMN operational_analytics_state.reads_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.operational_analytics_state.reads_enabled IS 'Independent reporting-read switch; reports remain unavailable until backfill reconciliation is approved.';


--
-- Name: COLUMN operational_analytics_state.traffic_v3_started_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.operational_analytics_state.traffic_v3_started_at IS 'Start of real whole-site visit tracking; historical visits are not backfilled.';


--
-- Name: page_activity_rollups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.page_activity_rollups (
    grain character varying(8) NOT NULL,
    bucket_start timestamp with time zone NOT NULL,
    page_key character varying(255) NOT NULL,
    audience character varying(16) NOT NULL,
    visit_count bigint DEFAULT 0 NOT NULL,
    last_recorded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    view_count bigint DEFAULT 0 NOT NULL,
    CONSTRAINT page_activity_rollups_audience_check CHECK (((audience)::text = ANY ((ARRAY['guest'::character varying, 'registered'::character varying])::text[]))),
    CONSTRAINT page_activity_rollups_grain_check CHECK (((grain)::text = ANY ((ARRAY['hour'::character varying, 'day'::character varying])::text[]))),
    CONSTRAINT page_activity_rollups_view_count_check CHECK ((view_count >= 0)),
    CONSTRAINT page_activity_rollups_visit_count_check CHECK ((visit_count >= 0))
);


--
-- Name: TABLE page_activity_rollups; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.page_activity_rollups IS 'Identifier-free hourly and daily public-page aggregates for administrator reporting.';


--
-- Name: COLUMN page_activity_rollups.view_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.page_activity_rollups.view_count IS 'Canonical successful public page-load count; refreshes count as additional views.';


--
-- Name: page_visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.page_visits (
    id integer NOT NULL,
    page_url character varying(255) NOT NULL,
    visitor_type character varying(10) NOT NULL,
    user_id character varying(50),
    ip_address character varying(45),
    visit_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    metadata jsonb
);


--
-- Name: page_visits_counter; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.page_visits_counter (
    page_path character varying(255) NOT NULL,
    date date DEFAULT CURRENT_DATE NOT NULL,
    visitor_type character varying(10) NOT NULL,
    visit_count integer DEFAULT 1,
    CONSTRAINT page_visits_counter_visitor_type_check CHECK (((visitor_type)::text = ANY ((ARRAY['guest'::character varying, 'user'::character varying])::text[])))
);


--
-- Name: TABLE page_visits_counter; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.page_visits_counter IS 'Counter-based tracking of page visits by date';


--
-- Name: page_visits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.page_visits_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: page_visits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.page_visits_id_seq OWNED BY public.page_visits.id;


--
-- Name: repository_activity_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repository_activity_daily (
    activity_date date NOT NULL,
    record_type character varying(16) NOT NULL,
    record_id integer NOT NULL,
    audience character varying(24) NOT NULL,
    view_count bigint DEFAULT 0 NOT NULL,
    download_count bigint DEFAULT 0 NOT NULL,
    last_recorded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT repository_activity_daily_audience_check CHECK (((audience)::text = ANY ((ARRAY['guest'::character varying, 'registered'::character varying, 'approved_request'::character varying])::text[]))),
    CONSTRAINT repository_activity_daily_download_count_check CHECK ((download_count >= 0)),
    CONSTRAINT repository_activity_daily_record_id_check CHECK ((record_id > 0)),
    CONSTRAINT repository_activity_daily_record_type_check CHECK (((record_type)::text = ANY ((ARRAY['document'::character varying, 'compiled'::character varying])::text[]))),
    CONSTRAINT repository_activity_daily_view_count_check CHECK ((view_count >= 0))
);


--
-- Name: repository_activity_rollups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repository_activity_rollups (
    grain character varying(8) NOT NULL,
    bucket_start timestamp with time zone NOT NULL,
    record_type character varying(16) NOT NULL,
    record_id integer NOT NULL,
    audience character varying(24) NOT NULL,
    view_count bigint DEFAULT 0 NOT NULL,
    download_count bigint DEFAULT 0 NOT NULL,
    last_recorded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT repository_activity_rollups_audience_check CHECK (((audience)::text = ANY ((ARRAY['guest'::character varying, 'registered'::character varying, 'approved_request'::character varying])::text[]))),
    CONSTRAINT repository_activity_rollups_download_count_check CHECK ((download_count >= 0)),
    CONSTRAINT repository_activity_rollups_grain_check CHECK (((grain)::text = ANY ((ARRAY['hour'::character varying, 'day'::character varying])::text[]))),
    CONSTRAINT repository_activity_rollups_record_id_check CHECK ((record_id > 0)),
    CONSTRAINT repository_activity_rollups_record_type_check CHECK (((record_type)::text = ANY ((ARRAY['document'::character varying, 'compiled'::character varying])::text[]))),
    CONSTRAINT repository_activity_rollups_view_count_check CHECK ((view_count >= 0))
);


--
-- Name: TABLE repository_activity_rollups; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.repository_activity_rollups IS 'Identifier-free hourly and daily repository aggregates for administrator reporting.';


--
-- Name: repository_analytics_backfills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repository_analytics_backfills (
    version character varying(64) NOT NULL,
    completed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    notes text
);


--
-- Name: research_agenda; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_agenda (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    code character varying(32),
    normalized_name character varying(255),
    description text,
    effective_from date,
    effective_to date,
    is_official boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: research_agenda_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.research_agenda_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: research_agenda_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.research_agenda_id_seq OWNED BY public.research_agenda.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    role_name character varying(50) NOT NULL
);


--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: search_activity_rollups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.search_activity_rollups (
    bucket_start timestamp with time zone NOT NULL,
    normalized_term character varying(160) NOT NULL,
    display_term character varying(160) NOT NULL,
    term_type character varying(24) NOT NULL,
    action character varying(24) NOT NULL,
    source character varying(16) NOT NULL,
    search_count bigint DEFAULT 0 NOT NULL,
    zero_result_count bigint DEFAULT 0 NOT NULL,
    last_recorded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT search_activity_rollups_action_check CHECK (((action)::text = ANY ((ARRAY['submit'::character varying, 'suggestion_select'::character varying])::text[]))),
    CONSTRAINT search_activity_rollups_search_count_check CHECK ((search_count >= 0)),
    CONSTRAINT search_activity_rollups_source_check CHECK (((source)::text = ANY ((ARRAY['home'::character varying, 'results'::character varying])::text[]))),
    CONSTRAINT search_activity_rollups_term_type_check CHECK (((term_type)::text = ANY ((ARRAY['work'::character varying, 'author'::character varying, 'topic'::character varying, 'keyword'::character varying, 'agenda'::character varying, 'free_text'::character varying])::text[]))),
    CONSTRAINT search_activity_rollups_zero_result_count_check CHECK ((zero_result_count >= 0))
);


--
-- Name: TABLE search_activity_rollups; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.search_activity_rollups IS 'Identifier-free hourly aggregates of explicit public search submissions and suggestion selections.';


--
-- Name: session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session (
    id character varying NOT NULL,
    user_id character varying NOT NULL,
    token character varying NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    ip_address character varying,
    user_agent text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: site_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_assets (
    id integer NOT NULL,
    file_path character varying(500) NOT NULL,
    kind character varying(80) NOT NULL,
    alt_text character varying(255),
    mime_type character varying(120) NOT NULL,
    size_bytes integer NOT NULL,
    created_by character varying(50),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: site_assets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.site_assets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: site_assets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.site_assets_id_seq OWNED BY public.site_assets.id;


--
-- Name: site_experience_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_experience_versions (
    id integer NOT NULL,
    status character varying(20) NOT NULL,
    version integer NOT NULL,
    config jsonb NOT NULL,
    created_by character varying(50),
    updated_by character varying(50),
    published_by character varying(50),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    published_at timestamp without time zone,
    CONSTRAINT site_experience_versions_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'published'::character varying, 'archived'::character varying])::text[])))
);


--
-- Name: site_experience_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.site_experience_versions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: site_experience_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.site_experience_versions_id_seq OWNED BY public.site_experience_versions.id;


--
-- Name: site_session_rollups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_session_rollups (
    grain character varying(8) NOT NULL,
    bucket_start timestamp with time zone NOT NULL,
    audience character varying(16) NOT NULL,
    session_count bigint DEFAULT 0 NOT NULL,
    last_recorded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT site_session_rollups_audience_check CHECK (((audience)::text = ANY ((ARRAY['guest'::character varying, 'registered'::character varying])::text[]))),
    CONSTRAINT site_session_rollups_grain_check CHECK (((grain)::text = ANY ((ARRAY['hour'::character varying, 'day'::character varying])::text[]))),
    CONSTRAINT site_session_rollups_session_count_check CHECK ((session_count >= 0))
);


--
-- Name: TABLE site_session_rollups; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.site_session_rollups IS 'Identifier-free hourly and daily whole-site session aggregates.';


--
-- Name: topics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.topics (
    id integer NOT NULL,
    name character varying(120) NOT NULL,
    normalized_name character varying(120) NOT NULL,
    description text,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    proposed_by character varying(255),
    reviewed_by character varying(255),
    reviewed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT topics_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'retired'::character varying])::text[])))
);


--
-- Name: topics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.topics ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.topics_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_compiled_document_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_compiled_document_history (
    id integer NOT NULL,
    user_id character varying(50) NOT NULL,
    compiled_document_id integer NOT NULL,
    accessed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    action character varying(20) NOT NULL,
    CONSTRAINT user_compiled_document_history_action_check CHECK (((action)::text = ANY ((ARRAY['VIEW'::character varying, 'DOWNLOAD'::character varying])::text[])))
);


--
-- Name: user_compiled_document_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_compiled_document_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_compiled_document_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_compiled_document_history_id_seq OWNED BY public.user_compiled_document_history.id;


--
-- Name: user_document_annotations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_document_annotations (
    id uuid NOT NULL,
    user_id character varying(50) NOT NULL,
    document_id integer NOT NULL,
    source_id uuid NOT NULL,
    annotation_type character varying(16) NOT NULL,
    anchor_type character varying(16) NOT NULL,
    page_number integer NOT NULL,
    selected_text text,
    text_prefix character varying(256),
    text_suffix character varying(256),
    rects jsonb,
    color character varying(16) DEFAULT 'yellow'::character varying NOT NULL,
    label character varying(160),
    note_text character varying(5000),
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    client_request_id uuid,
    CONSTRAINT user_document_annotations_anchor_type_check CHECK (((anchor_type)::text = ANY ((ARRAY['page'::character varying, 'text'::character varying, 'area'::character varying])::text[]))),
    CONSTRAINT user_document_annotations_annotation_type_check CHECK (((annotation_type)::text = ANY ((ARRAY['bookmark'::character varying, 'highlight'::character varying, 'note'::character varying])::text[]))),
    CONSTRAINT user_document_annotations_color_check CHECK (((color)::text = ANY ((ARRAY['yellow'::character varying, 'green'::character varying, 'blue'::character varying, 'pink'::character varying])::text[]))),
    CONSTRAINT user_document_annotations_page_number_check CHECK ((page_number > 0)),
    CONSTRAINT user_document_annotations_rects_check CHECK (((jsonb_typeof(rects) IS NULL) OR (jsonb_typeof(rects) = 'array'::text)))
);


--
-- Name: user_document_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_document_history (
    id integer NOT NULL,
    user_id character varying NOT NULL,
    document_id integer NOT NULL,
    accessed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    action character varying(20) NOT NULL,
    CONSTRAINT user_document_history_action_check CHECK (((action)::text = ANY (ARRAY[('VIEW'::character varying)::text, ('DOWNLOAD'::character varying)::text])))
);


--
-- Name: TABLE user_document_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_document_history IS 'Tracks user interactions with documents such as views and downloads';


--
-- Name: COLUMN user_document_history.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_document_history.user_id IS 'Reference to the user ID';


--
-- Name: COLUMN user_document_history.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_document_history.document_id IS 'Reference to the document ID';


--
-- Name: COLUMN user_document_history.accessed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_document_history.accessed_at IS 'Timestamp when the action was performed';


--
-- Name: COLUMN user_document_history.action; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_document_history.action IS 'Type of action performed (VIEW or DOWNLOAD)';


--
-- Name: user_document_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_document_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_document_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_document_history_id_seq OWNED BY public.user_document_history.id;


--
-- Name: user_document_reading_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_document_reading_progress (
    user_id character varying(50) NOT NULL,
    document_id integer NOT NULL,
    source_id uuid NOT NULL,
    last_page integer NOT NULL,
    page_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT user_document_reading_progress_last_page_check CHECK ((last_page > 0)),
    CONSTRAINT user_document_reading_progress_page_count_check CHECK ((page_count >= 0))
);


--
-- Name: user_experience_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_experience_preferences (
    user_id character varying(50) NOT NULL,
    preferences jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: user_read_compiled_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_read_compiled_documents (
    user_id character varying NOT NULL,
    compiled_document_id integer NOT NULL,
    read_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: user_read_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_read_documents (
    user_id character varying NOT NULL,
    document_id integer NOT NULL,
    read_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: user_saved_compiled_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_saved_compiled_documents (
    user_id character varying(50) NOT NULL,
    compiled_document_id integer NOT NULL,
    saved_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: user_saved_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_saved_documents (
    user_id character varying NOT NULL,
    document_id integer NOT NULL,
    saved_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: user_saved_news_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_saved_news_posts (
    user_id character varying(50) NOT NULL,
    news_post_id bigint NOT NULL,
    saved_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id character varying NOT NULL,
    first_name character varying(50),
    middle_name character varying(50),
    last_name character varying(50),
    email character varying(255) NOT NULL,
    department_id integer,
    role_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    last_login timestamp without time zone,
    profile_picture character varying(255),
    name character varying(255) NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    username character varying(255),
    display_username character varying(255),
    role character varying(20)
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: verification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification (
    id character varying NOT NULL,
    identifier character varying NOT NULL,
    value text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: abstract_extraction_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abstract_extraction_jobs ALTER COLUMN id SET DEFAULT nextval('public.abstract_extraction_jobs_id_seq'::regclass);


--
-- Name: admin_notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_notifications ALTER COLUMN id SET DEFAULT nextval('public.admin_notifications_id_seq'::regclass);


--
-- Name: affiliations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliations ALTER COLUMN id SET DEFAULT nextval('public.affiliations_id_seq'::regclass);


--
-- Name: author_visits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.author_visits ALTER COLUMN id SET DEFAULT nextval('public.author_visits_id_seq'::regclass);


--
-- Name: categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories ALTER COLUMN id SET DEFAULT nextval('public.categories_id_seq'::regclass);


--
-- Name: compiled_document_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compiled_document_items ALTER COLUMN id SET DEFAULT nextval('public.compiled_document_items_id_seq'::regclass);


--
-- Name: compiled_documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compiled_documents ALTER COLUMN id SET DEFAULT nextval('public.compiled_documents_id_seq'::regclass);


--
-- Name: contact_inquiries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_inquiries ALTER COLUMN id SET DEFAULT nextval('public.contact_inquiries_id_seq'::regclass);


--
-- Name: contact_inquiry_notes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_inquiry_notes ALTER COLUMN id SET DEFAULT nextval('public.contact_inquiry_notes_id_seq'::regclass);


--
-- Name: contact_inquiry_status_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_inquiry_status_history ALTER COLUMN id SET DEFAULT nextval('public.contact_inquiry_status_history_id_seq'::regclass);


--
-- Name: contact_notification_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_notification_jobs ALTER COLUMN id SET DEFAULT nextval('public.contact_notification_jobs_id_seq'::regclass);


--
-- Name: credentials_legacy id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credentials_legacy ALTER COLUMN id SET DEFAULT nextval('public.credentials_id_seq'::regclass);


--
-- Name: departments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments ALTER COLUMN id SET DEFAULT nextval('public.departments_id_seq'::regclass);


--
-- Name: document_access_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_access_tokens ALTER COLUMN id SET DEFAULT nextval('public.document_access_tokens_id_seq'::regclass);


--
-- Name: document_permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_permissions ALTER COLUMN id SET DEFAULT nextval('public.document_permissions_id_seq'::regclass);


--
-- Name: document_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_requests ALTER COLUMN id SET DEFAULT nextval('public.document_requests_id_seq'::regclass);


--
-- Name: documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents ALTER COLUMN id SET DEFAULT nextval('public.documents_id_seq'::regclass);


--
-- Name: files id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files ALTER COLUMN id SET DEFAULT nextval('public.files_id_seq'::regclass);


--
-- Name: news_media_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_media_jobs ALTER COLUMN id SET DEFAULT nextval('public.news_media_jobs_id_seq'::regclass);


--
-- Name: news_media_tracks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_media_tracks ALTER COLUMN id SET DEFAULT nextval('public.news_media_tracks_id_seq'::regclass);


--
-- Name: news_media_variants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_media_variants ALTER COLUMN id SET DEFAULT nextval('public.news_media_variants_id_seq'::regclass);


--
-- Name: news_posts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_posts ALTER COLUMN id SET DEFAULT nextval('public.news_posts_id_seq'::regclass);


--
-- Name: page_visits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_visits ALTER COLUMN id SET DEFAULT nextval('public.page_visits_id_seq'::regclass);


--
-- Name: research_agenda id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_agenda ALTER COLUMN id SET DEFAULT nextval('public.research_agenda_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: site_assets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_assets ALTER COLUMN id SET DEFAULT nextval('public.site_assets_id_seq'::regclass);


--
-- Name: site_experience_versions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_experience_versions ALTER COLUMN id SET DEFAULT nextval('public.site_experience_versions_id_seq'::regclass);


--
-- Name: user_compiled_document_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_compiled_document_history ALTER COLUMN id SET DEFAULT nextval('public.user_compiled_document_history_id_seq'::regclass);


--
-- Name: user_document_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_document_history ALTER COLUMN id SET DEFAULT nextval('public.user_document_history_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: abstract_extraction_jobs abstract_extraction_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abstract_extraction_jobs
    ADD CONSTRAINT abstract_extraction_jobs_pkey PRIMARY KEY (id);


--
-- Name: abstract_extraction_worker_state abstract_extraction_worker_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abstract_extraction_worker_state
    ADD CONSTRAINT abstract_extraction_worker_state_pkey PRIMARY KEY (state_id);


--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);


--
-- Name: admin_notifications admin_notifications_notification_type_entity_type_entity_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_notifications
    ADD CONSTRAINT admin_notifications_notification_type_entity_type_entity_id_key UNIQUE (notification_type, entity_type, entity_id);


--
-- Name: admin_notifications admin_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_notifications
    ADD CONSTRAINT admin_notifications_pkey PRIMARY KEY (id);


--
-- Name: affiliations affiliations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliations
    ADD CONSTRAINT affiliations_pkey PRIMARY KEY (id);


--
-- Name: author_activity_rollups author_activity_rollups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.author_activity_rollups
    ADD CONSTRAINT author_activity_rollups_pkey PRIMARY KEY (grain, bucket_start, author_id, audience);


--
-- Name: author_visits author_visits_author_id_idx; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.author_visits
    ADD CONSTRAINT author_visits_author_id_idx UNIQUE (id, author_id);


--
-- Name: author_visits_counter author_visits_counter_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.author_visits_counter
    ADD CONSTRAINT author_visits_counter_pkey PRIMARY KEY (author_id, date, visitor_type);


--
-- Name: author_visits author_visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.author_visits
    ADD CONSTRAINT author_visits_pkey PRIMARY KEY (id);


--
-- Name: authors authors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authors
    ADD CONSTRAINT authors_pkey PRIMARY KEY (id);


--
-- Name: authors authors_spud_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authors
    ADD CONSTRAINT authors_spud_id_key UNIQUE (spud_id);


--
-- Name: categories categories_category_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_category_name_key UNIQUE (category_name);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: classification_migration_review classification_migration_review_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classification_migration_review
    ADD CONSTRAINT classification_migration_review_pkey PRIMARY KEY (document_id, legacy_research_agenda_id);


--
-- Name: compiled_document_items compiled_document_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compiled_document_items
    ADD CONSTRAINT compiled_document_items_pkey PRIMARY KEY (id);


--
-- Name: compiled_documents compiled_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compiled_documents
    ADD CONSTRAINT compiled_documents_pkey PRIMARY KEY (id);


--
-- Name: contact_inquiries contact_inquiries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_inquiries
    ADD CONSTRAINT contact_inquiries_pkey PRIMARY KEY (id);


--
-- Name: contact_inquiries contact_inquiries_reference_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_inquiries
    ADD CONSTRAINT contact_inquiries_reference_code_key UNIQUE (reference_code);


--
-- Name: contact_inquiry_notes contact_inquiry_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_inquiry_notes
    ADD CONSTRAINT contact_inquiry_notes_pkey PRIMARY KEY (id);


--
-- Name: contact_inquiry_status_history contact_inquiry_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_inquiry_status_history
    ADD CONSTRAINT contact_inquiry_status_history_pkey PRIMARY KEY (id);


--
-- Name: contact_notification_jobs contact_notification_jobs_inquiry_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_notification_jobs
    ADD CONSTRAINT contact_notification_jobs_inquiry_id_key UNIQUE (inquiry_id);


--
-- Name: contact_notification_jobs contact_notification_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_notification_jobs
    ADD CONSTRAINT contact_notification_jobs_pkey PRIMARY KEY (id);


--
-- Name: credentials_legacy credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credentials_legacy
    ADD CONSTRAINT credentials_pkey PRIMARY KEY (id);


--
-- Name: credentials_legacy credentials_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credentials_legacy
    ADD CONSTRAINT credentials_user_id_key UNIQUE (user_id);


--
-- Name: departments departments_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_code_key UNIQUE (code);


--
-- Name: departments departments_department_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_department_name_key UNIQUE (department_name);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: document_access_tokens document_access_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_access_tokens
    ADD CONSTRAINT document_access_tokens_pkey PRIMARY KEY (id);


--
-- Name: document_access_tokens document_access_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_access_tokens
    ADD CONSTRAINT document_access_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: document_annotation_sources document_annotation_sources_document_id_fingerprint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_annotation_sources
    ADD CONSTRAINT document_annotation_sources_document_id_fingerprint_key UNIQUE (document_id, fingerprint);


--
-- Name: document_annotation_sources document_annotation_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_annotation_sources
    ADD CONSTRAINT document_annotation_sources_pkey PRIMARY KEY (id);


--
-- Name: document_authors document_authors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_authors
    ADD CONSTRAINT document_authors_pkey PRIMARY KEY (document_id, author_id);


--
-- Name: document_keywords document_keywords_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_keywords
    ADD CONSTRAINT document_keywords_pkey PRIMARY KEY (document_id, keyword_id);


--
-- Name: document_permissions document_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_permissions
    ADD CONSTRAINT document_permissions_pkey PRIMARY KEY (id);


--
-- Name: document_requests document_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_requests
    ADD CONSTRAINT document_requests_pkey PRIMARY KEY (id);


--
-- Name: document_research_agenda document_research_agenda_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_research_agenda
    ADD CONSTRAINT document_research_agenda_pkey PRIMARY KEY (document_id, research_agenda_id);


--
-- Name: document_topics document_topics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_topics
    ADD CONSTRAINT document_topics_pkey PRIMARY KEY (document_id, topic_id);


--
-- Name: document_visits document_visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_visits
    ADD CONSTRAINT document_visits_pkey PRIMARY KEY (doc_id, date, visitor_type);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: files files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_pkey PRIMARY KEY (id);


--
-- Name: keywords keywords_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.keywords
    ADD CONSTRAINT keywords_pkey PRIMARY KEY (id);


--
-- Name: legacy_public_path_daily_hits legacy_public_path_daily_hits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legacy_public_path_daily_hits
    ADD CONSTRAINT legacy_public_path_daily_hits_pkey PRIMARY KEY (release_id, hit_date, path, method, response_status);


--
-- Name: legacy_public_release_soak legacy_public_release_soak_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legacy_public_release_soak
    ADD CONSTRAINT legacy_public_release_soak_pkey PRIMARY KEY (release_id);


--
-- Name: news_media_assets news_media_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_media_assets
    ADD CONSTRAINT news_media_assets_pkey PRIMARY KEY (id);


--
-- Name: news_media_jobs news_media_jobs_asset_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_media_jobs
    ADD CONSTRAINT news_media_jobs_asset_id_key UNIQUE (asset_id);


--
-- Name: news_media_jobs news_media_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_media_jobs
    ADD CONSTRAINT news_media_jobs_pkey PRIMARY KEY (id);


--
-- Name: news_media_tracks news_media_tracks_asset_id_track_type_language_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_media_tracks
    ADD CONSTRAINT news_media_tracks_asset_id_track_type_language_key UNIQUE (asset_id, track_type, language);


--
-- Name: news_media_tracks news_media_tracks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_media_tracks
    ADD CONSTRAINT news_media_tracks_pkey PRIMARY KEY (id);


--
-- Name: news_media_upload_parts news_media_upload_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_media_upload_parts
    ADD CONSTRAINT news_media_upload_parts_pkey PRIMARY KEY (session_id, part_number);


--
-- Name: news_media_upload_sessions news_media_upload_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_media_upload_sessions
    ADD CONSTRAINT news_media_upload_sessions_pkey PRIMARY KEY (id);


--
-- Name: news_media_variants news_media_variants_asset_id_variant_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_media_variants
    ADD CONSTRAINT news_media_variants_asset_id_variant_key_key UNIQUE (asset_id, variant_key);


--
-- Name: news_media_variants news_media_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_media_variants
    ADD CONSTRAINT news_media_variants_pkey PRIMARY KEY (id);


--
-- Name: news_post_authors news_post_authors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_post_authors
    ADD CONSTRAINT news_post_authors_pkey PRIMARY KEY (news_post_id, author_id);


--
-- Name: news_post_media news_post_media_asset_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_post_media
    ADD CONSTRAINT news_post_media_asset_id_key UNIQUE (asset_id);


--
-- Name: news_post_media news_post_media_news_post_id_position_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_post_media
    ADD CONSTRAINT news_post_media_news_post_id_position_key UNIQUE (news_post_id, "position");


--
-- Name: news_post_media news_post_media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_post_media
    ADD CONSTRAINT news_post_media_pkey PRIMARY KEY (news_post_id, asset_id);


--
-- Name: news_post_works news_post_works_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_post_works
    ADD CONSTRAINT news_post_works_pkey PRIMARY KEY (news_post_id, record_type, record_id);


--
-- Name: news_posts news_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_posts
    ADD CONSTRAINT news_posts_pkey PRIMARY KEY (id);


--
-- Name: news_posts news_posts_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_posts
    ADD CONSTRAINT news_posts_slug_key UNIQUE (slug);


--
-- Name: operational_analytics_backfills operational_analytics_backfills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_analytics_backfills
    ADD CONSTRAINT operational_analytics_backfills_pkey PRIMARY KEY (version);


--
-- Name: operational_analytics_state operational_analytics_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_analytics_state
    ADD CONSTRAINT operational_analytics_state_pkey PRIMARY KEY (state_id);


--
-- Name: page_activity_rollups page_activity_rollups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_activity_rollups
    ADD CONSTRAINT page_activity_rollups_pkey PRIMARY KEY (grain, bucket_start, page_key, audience);


--
-- Name: page_visits_counter page_visits_counter_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_visits_counter
    ADD CONSTRAINT page_visits_counter_pkey PRIMARY KEY (page_path, date, visitor_type);


--
-- Name: page_visits page_visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_visits
    ADD CONSTRAINT page_visits_pkey PRIMARY KEY (id);


--
-- Name: repository_activity_daily repository_activity_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repository_activity_daily
    ADD CONSTRAINT repository_activity_daily_pkey PRIMARY KEY (activity_date, record_type, record_id, audience);


--
-- Name: repository_activity_rollups repository_activity_rollups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repository_activity_rollups
    ADD CONSTRAINT repository_activity_rollups_pkey PRIMARY KEY (grain, bucket_start, record_type, record_id, audience);


--
-- Name: repository_analytics_backfills repository_analytics_backfills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repository_analytics_backfills
    ADD CONSTRAINT repository_analytics_backfills_pkey PRIMARY KEY (version);


--
-- Name: research_agenda research_agenda_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_agenda
    ADD CONSTRAINT research_agenda_name_key UNIQUE (name);


--
-- Name: research_agenda research_agenda_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_agenda
    ADD CONSTRAINT research_agenda_pkey PRIMARY KEY (id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: roles roles_role_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_role_name_key UNIQUE (role_name);


--
-- Name: search_activity_rollups search_activity_rollups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_activity_rollups
    ADD CONSTRAINT search_activity_rollups_pkey PRIMARY KEY (bucket_start, normalized_term, term_type, action, source);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: session session_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_token_key UNIQUE (token);


--
-- Name: site_assets site_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_assets
    ADD CONSTRAINT site_assets_pkey PRIMARY KEY (id);


--
-- Name: site_experience_versions site_experience_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_experience_versions
    ADD CONSTRAINT site_experience_versions_pkey PRIMARY KEY (id);


--
-- Name: site_session_rollups site_session_rollups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_session_rollups
    ADD CONSTRAINT site_session_rollups_pkey PRIMARY KEY (grain, bucket_start, audience);


--
-- Name: topics topics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topics
    ADD CONSTRAINT topics_pkey PRIMARY KEY (id);


--
-- Name: user_compiled_document_history user_compiled_document_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_compiled_document_history
    ADD CONSTRAINT user_compiled_document_history_pkey PRIMARY KEY (id);


--
-- Name: user_document_annotations user_document_annotations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_document_annotations
    ADD CONSTRAINT user_document_annotations_pkey PRIMARY KEY (id);


--
-- Name: user_document_history user_document_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_document_history
    ADD CONSTRAINT user_document_history_pkey PRIMARY KEY (id);


--
-- Name: user_document_reading_progress user_document_reading_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_document_reading_progress
    ADD CONSTRAINT user_document_reading_progress_pkey PRIMARY KEY (user_id, document_id, source_id);


--
-- Name: user_experience_preferences user_experience_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_experience_preferences
    ADD CONSTRAINT user_experience_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: user_read_compiled_documents user_read_compiled_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_read_compiled_documents
    ADD CONSTRAINT user_read_compiled_documents_pkey PRIMARY KEY (user_id, compiled_document_id);


--
-- Name: user_read_documents user_read_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_read_documents
    ADD CONSTRAINT user_read_documents_pkey PRIMARY KEY (user_id, document_id);


--
-- Name: user_saved_compiled_documents user_saved_compiled_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_saved_compiled_documents
    ADD CONSTRAINT user_saved_compiled_documents_pkey PRIMARY KEY (user_id, compiled_document_id);


--
-- Name: user_saved_documents user_saved_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_saved_documents
    ADD CONSTRAINT user_saved_documents_pkey PRIMARY KEY (user_id, document_id);


--
-- Name: user_saved_news_posts user_saved_news_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_saved_news_posts
    ADD CONSTRAINT user_saved_news_posts_pkey PRIMARY KEY (user_id, news_post_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: verification verification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);


--
-- Name: account_provider_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX account_provider_uidx ON public.account USING btree (provider_id, account_id);


--
-- Name: account_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_user_id_idx ON public.account USING btree (user_id);


--
-- Name: admin_notifications_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_notifications_open_idx ON public.admin_notifications USING btree (resolved_at, is_read, created_at DESC);


--
-- Name: admin_notifications_visible_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_notifications_visible_idx ON public.admin_notifications USING btree (resolved_at, dismissed_at, is_read, created_at DESC);


--
-- Name: affiliations_name_ci_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX affiliations_name_ci_key ON public.affiliations USING btree (lower(btrim((affiliation_name)::text)));


--
-- Name: author_activity_rollups_bucket_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX author_activity_rollups_bucket_idx ON public.author_activity_rollups USING btree (grain, bucket_start, author_id);


--
-- Name: author_activity_rollups_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX author_activity_rollups_date_idx ON public.author_activity_rollups USING btree (grain, bucket_start);


--
-- Name: author_visits_author_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX author_visits_author_id ON public.author_visits USING btree (author_id);


--
-- Name: author_visits_visit_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX author_visits_visit_date ON public.author_visits USING btree (visit_date);


--
-- Name: authors_normalized_full_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX authors_normalized_full_name_key ON public.authors USING btree (lower(regexp_replace(btrim((full_name)::text), '[[:space:]]+'::text, ' '::text, 'g'::text)));


--
-- Name: classification_review_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX classification_review_status_idx ON public.classification_migration_review USING btree (status, document_id);


--
-- Name: departments_code_ci_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX departments_code_ci_key ON public.departments USING btree (lower(btrim((code)::text))) WHERE (code IS NOT NULL);


--
-- Name: departments_name_ci_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX departments_name_ci_key ON public.departments USING btree (lower(btrim((department_name)::text)));


--
-- Name: document_keywords_keyword_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_keywords_keyword_idx ON public.document_keywords USING btree (keyword_id, document_id);


--
-- Name: document_research_agenda_primary_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX document_research_agenda_primary_uidx ON public.document_research_agenda USING btree (document_id) WHERE (is_primary = true);


--
-- Name: document_topics_topic_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_topics_topic_idx ON public.document_topics USING btree (topic_id, document_id);


--
-- Name: idx_abstract_extraction_jobs_ready; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_abstract_extraction_jobs_ready ON public.abstract_extraction_jobs USING btree (status, available_at, id) WHERE (is_current IS TRUE);


--
-- Name: idx_abstract_extraction_jobs_review; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_abstract_extraction_jobs_review ON public.abstract_extraction_jobs USING btree (status, updated_at DESC) WHERE (is_current IS TRUE);


--
-- Name: idx_author_visits_counter_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_author_visits_counter_date ON public.author_visits_counter USING btree (date);


--
-- Name: idx_authors_affiliation_ci; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_authors_affiliation_ci ON public.authors USING btree (lower(btrim((affiliation)::text)));


--
-- Name: idx_authors_department_ci; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_authors_department_ci ON public.authors USING btree (lower(btrim((department)::text)));


--
-- Name: idx_authors_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_authors_email ON public.authors USING btree (email);


--
-- Name: idx_authors_full_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_authors_full_name ON public.authors USING btree (full_name);


--
-- Name: idx_compiled_documents_review_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compiled_documents_review_queue ON public.compiled_documents USING btree (review_status, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_contact_inquiries_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_inquiries_created ON public.contact_inquiries USING btree (created_at DESC, id DESC);


--
-- Name: idx_contact_inquiries_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_inquiries_status_created ON public.contact_inquiries USING btree (status, created_at DESC);


--
-- Name: idx_contact_inquiry_notes_inquiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_inquiry_notes_inquiry ON public.contact_inquiry_notes USING btree (inquiry_id, created_at, id);


--
-- Name: idx_contact_notification_jobs_ready; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_notification_jobs_ready ON public.contact_notification_jobs USING btree (next_attempt_at, id) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_document_access_tokens_document_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_access_tokens_document_id ON public.document_access_tokens USING btree (document_id);


--
-- Name: idx_document_access_tokens_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_access_tokens_expires_at ON public.document_access_tokens USING btree (expires_at);


--
-- Name: idx_document_access_tokens_request_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_access_tokens_request_id ON public.document_access_tokens USING btree (request_id);


--
-- Name: idx_document_annotation_sources_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_annotation_sources_document ON public.document_annotation_sources USING btree (document_id, created_at DESC);


--
-- Name: idx_document_authors_author_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_authors_author_id ON public.document_authors USING btree (author_id);


--
-- Name: idx_document_authors_document_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_authors_document_id ON public.document_authors USING btree (document_id);


--
-- Name: idx_document_research_agenda_document_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_research_agenda_document_id ON public.document_research_agenda USING btree (document_id);


--
-- Name: idx_document_research_agenda_research_agenda_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_research_agenda_research_agenda_id ON public.document_research_agenda USING btree (research_agenda_id);


--
-- Name: idx_document_visits_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_visits_date ON public.document_visits USING btree (date);


--
-- Name: idx_documents_compiled_parent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_compiled_parent_id ON public.documents USING btree (compiled_parent_id);


--
-- Name: idx_documents_review_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_review_queue ON public.documents USING btree (review_status, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_legacy_public_path_hits_release; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_legacy_public_path_hits_release ON public.legacy_public_path_daily_hits USING btree (release_id, hit_date DESC);


--
-- Name: idx_news_media_assets_cleanup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_media_assets_cleanup ON public.news_media_assets USING btree (status, updated_at);


--
-- Name: idx_news_media_assets_owner_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_media_assets_owner_status ON public.news_media_assets USING btree (created_by, status, created_at DESC);


--
-- Name: idx_news_media_jobs_ready; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_media_jobs_ready ON public.news_media_jobs USING btree (status, available_at, id);


--
-- Name: idx_news_media_tracks_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_media_tracks_asset ON public.news_media_tracks USING btree (asset_id, track_type, language);


--
-- Name: idx_news_media_upload_sessions_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_media_upload_sessions_expiry ON public.news_media_upload_sessions USING btree (expires_at);


--
-- Name: idx_news_media_variants_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_media_variants_asset ON public.news_media_variants USING btree (asset_id, variant_key);


--
-- Name: idx_news_post_authors_author; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_post_authors_author ON public.news_post_authors USING btree (author_id, news_post_id);


--
-- Name: idx_news_post_media_post; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_post_media_post ON public.news_post_media USING btree (news_post_id, "position");


--
-- Name: idx_news_post_works_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_post_works_record ON public.news_post_works USING btree (record_type, record_id, news_post_id);


--
-- Name: idx_news_posts_public_feed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_posts_public_feed ON public.news_posts USING btree (published_at DESC) WHERE (((status)::text = 'published'::text) AND (deleted_at IS NULL));


--
-- Name: idx_page_visits_counter_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_page_visits_counter_date ON public.page_visits_counter USING btree (date);


--
-- Name: idx_page_visits_document_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_page_visits_document_id ON public.page_visits USING btree (((metadata ->> 'documentId'::text)));


--
-- Name: idx_page_visits_page_url; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_page_visits_page_url ON public.page_visits USING btree (page_url);


--
-- Name: idx_page_visits_visit_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_page_visits_visit_date ON public.page_visits USING btree (visit_date);


--
-- Name: idx_site_assets_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_site_assets_kind ON public.site_assets USING btree (kind);


--
-- Name: idx_site_experience_versions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_site_experience_versions_status ON public.site_experience_versions USING btree (status);


--
-- Name: idx_site_experience_versions_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_site_experience_versions_version ON public.site_experience_versions USING btree (version DESC);


--
-- Name: idx_user_compiled_document_history_compiled_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_compiled_document_history_compiled_id ON public.user_compiled_document_history USING btree (compiled_document_id);


--
-- Name: idx_user_compiled_document_history_user_accessed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_compiled_document_history_user_accessed ON public.user_compiled_document_history USING btree (user_id, accessed_at DESC);


--
-- Name: idx_user_document_annotations_owner_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_document_annotations_owner_page ON public.user_document_annotations USING btree (user_id, document_id, source_id, page_number) WHERE (deleted_at IS NULL);


--
-- Name: idx_user_document_annotations_owner_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_document_annotations_owner_updated ON public.user_document_annotations USING btree (user_id, updated_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_user_document_annotations_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_document_annotations_search ON public.user_document_annotations USING gin (to_tsvector('simple'::regconfig, ((((COALESCE(selected_text, ''::text) || ' '::text) || (COALESCE(note_text, ''::character varying))::text) || ' '::text) || (COALESCE(label, ''::character varying))::text)));


--
-- Name: idx_user_document_annotations_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_document_annotations_tags ON public.user_document_annotations USING gin (tags) WHERE (deleted_at IS NULL);


--
-- Name: idx_user_document_history_accessed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_document_history_accessed_at ON public.user_document_history USING btree (accessed_at);


--
-- Name: idx_user_document_history_document_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_document_history_document_id ON public.user_document_history USING btree (document_id);


--
-- Name: idx_user_document_history_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_document_history_user_id ON public.user_document_history USING btree (user_id);


--
-- Name: idx_user_document_progress_owner_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_document_progress_owner_updated ON public.user_document_reading_progress USING btree (user_id, updated_at DESC);


--
-- Name: idx_user_read_compiled_documents_user_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_read_compiled_documents_user_read ON public.user_read_compiled_documents USING btree (user_id, read_at DESC);


--
-- Name: idx_user_read_documents_user_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_read_documents_user_read ON public.user_read_documents USING btree (user_id, read_at DESC);


--
-- Name: idx_user_saved_compiled_documents_user_saved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_saved_compiled_documents_user_saved ON public.user_saved_compiled_documents USING btree (user_id, saved_at DESC);


--
-- Name: idx_user_saved_news_posts_user_saved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_saved_news_posts_user_saved ON public.user_saved_news_posts USING btree (user_id, saved_at DESC);


--
-- Name: keywords_normalized_term_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX keywords_normalized_term_uidx ON public.keywords USING btree (normalized_term);


--
-- Name: page_activity_rollups_bucket_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX page_activity_rollups_bucket_idx ON public.page_activity_rollups USING btree (grain, bucket_start, page_key);


--
-- Name: page_activity_rollups_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX page_activity_rollups_date_idx ON public.page_activity_rollups USING btree (grain, bucket_start);


--
-- Name: repository_activity_daily_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX repository_activity_daily_date_idx ON public.repository_activity_daily USING btree (activity_date);


--
-- Name: repository_activity_daily_ranking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX repository_activity_daily_ranking_idx ON public.repository_activity_daily USING btree (record_type, record_id, activity_date);


--
-- Name: repository_activity_rollups_audience_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX repository_activity_rollups_audience_idx ON public.repository_activity_rollups USING btree (grain, bucket_start, audience);


--
-- Name: repository_activity_rollups_bucket_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX repository_activity_rollups_bucket_idx ON public.repository_activity_rollups USING btree (grain, bucket_start);


--
-- Name: repository_activity_rollups_ranking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX repository_activity_rollups_ranking_idx ON public.repository_activity_rollups USING btree (record_type, record_id, grain, bucket_start);


--
-- Name: research_agenda_active_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX research_agenda_active_order_idx ON public.research_agenda USING btree (is_active, sort_order, id);


--
-- Name: research_agenda_official_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX research_agenda_official_code_uidx ON public.research_agenda USING btree (code);


--
-- Name: research_agenda_official_name_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX research_agenda_official_name_uidx ON public.research_agenda USING btree (normalized_name) WHERE (is_official = true);


--
-- Name: search_activity_rollups_bucket_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_activity_rollups_bucket_idx ON public.search_activity_rollups USING btree (bucket_start);


--
-- Name: search_activity_rollups_term_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_activity_rollups_term_idx ON public.search_activity_rollups USING btree (normalized_term, bucket_start);


--
-- Name: session_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_user_id_idx ON public.session USING btree (user_id);


--
-- Name: site_session_rollups_bucket_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX site_session_rollups_bucket_idx ON public.site_session_rollups USING btree (grain, bucket_start);


--
-- Name: topics_normalized_name_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX topics_normalized_name_uidx ON public.topics USING btree (normalized_name);


--
-- Name: topics_status_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX topics_status_name_idx ON public.topics USING btree (status, normalized_name);


--
-- Name: uq_abstract_extraction_current_compiled; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_abstract_extraction_current_compiled ON public.abstract_extraction_jobs USING btree (compiled_document_id) WHERE ((is_current IS TRUE) AND (compiled_document_id IS NOT NULL));


--
-- Name: uq_abstract_extraction_current_document; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_abstract_extraction_current_document ON public.abstract_extraction_jobs USING btree (document_id) WHERE ((is_current IS TRUE) AND (document_id IS NOT NULL));


--
-- Name: uq_document_annotation_sources_current; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_document_annotation_sources_current ON public.document_annotation_sources USING btree (document_id) WHERE (is_current IS TRUE);


--
-- Name: uq_document_annotation_sources_id_document; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_document_annotation_sources_id_document ON public.document_annotation_sources USING btree (id, document_id);


--
-- Name: uq_document_annotation_sources_sha256; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_document_annotation_sources_sha256 ON public.document_annotation_sources USING btree (document_id, content_sha256) WHERE (content_sha256 IS NOT NULL);


--
-- Name: uq_user_document_annotation_request; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_user_document_annotation_request ON public.user_document_annotations USING btree (user_id, document_id, source_id, client_request_id) WHERE (client_request_id IS NOT NULL);


--
-- Name: uq_user_document_page_bookmark; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_user_document_page_bookmark ON public.user_document_annotations USING btree (user_id, document_id, source_id, page_number) WHERE (((annotation_type)::text = 'bookmark'::text) AND (deleted_at IS NULL));


--
-- Name: users_email_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_uidx ON public.users USING btree (email);


--
-- Name: users_username_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_username_uidx ON public.users USING btree (username);


--
-- Name: verification_identifier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX verification_identifier_idx ON public.verification USING btree (identifier);


--
-- Name: document_research_agenda peas_classification_overlap_agenda_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER peas_classification_overlap_agenda_trigger AFTER INSERT OR DELETE OR UPDATE ON public.document_research_agenda DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.peas_validate_document_classification_overlap();


--
-- Name: document_keywords peas_classification_overlap_keyword_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER peas_classification_overlap_keyword_trigger AFTER INSERT OR DELETE OR UPDATE ON public.document_keywords DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.peas_validate_document_classification_overlap();


--
-- Name: document_topics peas_classification_overlap_topic_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER peas_classification_overlap_topic_trigger AFTER INSERT OR DELETE OR UPDATE ON public.document_topics DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.peas_validate_document_classification_overlap();


--
-- Name: users users_sync_role_fields; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_sync_role_fields BEFORE INSERT OR UPDATE OF role, role_id ON public.users FOR EACH ROW EXECUTE FUNCTION public.sync_user_role_fields();


--
-- Name: users users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: abstract_extraction_jobs abstract_extraction_jobs_compiled_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abstract_extraction_jobs
    ADD CONSTRAINT abstract_extraction_jobs_compiled_document_id_fkey FOREIGN KEY (compiled_document_id) REFERENCES public.compiled_documents(id) ON DELETE CASCADE;


--
-- Name: abstract_extraction_jobs abstract_extraction_jobs_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abstract_extraction_jobs
    ADD CONSTRAINT abstract_extraction_jobs_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: abstract_extraction_jobs abstract_extraction_jobs_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abstract_extraction_jobs
    ADD CONSTRAINT abstract_extraction_jobs_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: account account_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: author_visits author_visits_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.author_visits
    ADD CONSTRAINT author_visits_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.authors(id) ON DELETE CASCADE;


--
-- Name: author_visits author_visits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.author_visits
    ADD CONSTRAINT author_visits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: classification_migration_review classification_migration_review_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classification_migration_review
    ADD CONSTRAINT classification_migration_review_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: classification_migration_review classification_migration_review_legacy_research_agenda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classification_migration_review
    ADD CONSTRAINT classification_migration_review_legacy_research_agenda_id_fkey FOREIGN KEY (legacy_research_agenda_id) REFERENCES public.research_agenda(id) ON DELETE RESTRICT;


--
-- Name: compiled_document_items compiled_document_items_compiled_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compiled_document_items
    ADD CONSTRAINT compiled_document_items_compiled_document_id_fkey FOREIGN KEY (compiled_document_id) REFERENCES public.compiled_documents(id) ON DELETE CASCADE;


--
-- Name: compiled_document_items compiled_document_items_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compiled_document_items
    ADD CONSTRAINT compiled_document_items_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: compiled_documents compiled_documents_abstract_foreword_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compiled_documents
    ADD CONSTRAINT compiled_documents_abstract_foreword_reviewed_by_fkey FOREIGN KEY (abstract_foreword_reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: compiled_documents compiled_documents_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compiled_documents
    ADD CONSTRAINT compiled_documents_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: compiled_documents compiled_documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compiled_documents
    ADD CONSTRAINT compiled_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: contact_inquiry_notes contact_inquiry_notes_inquiry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_inquiry_notes
    ADD CONSTRAINT contact_inquiry_notes_inquiry_id_fkey FOREIGN KEY (inquiry_id) REFERENCES public.contact_inquiries(id);


--
-- Name: contact_inquiry_status_history contact_inquiry_status_history_inquiry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_inquiry_status_history
    ADD CONSTRAINT contact_inquiry_status_history_inquiry_id_fkey FOREIGN KEY (inquiry_id) REFERENCES public.contact_inquiries(id);


--
-- Name: contact_notification_jobs contact_notification_jobs_inquiry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_notification_jobs
    ADD CONSTRAINT contact_notification_jobs_inquiry_id_fkey FOREIGN KEY (inquiry_id) REFERENCES public.contact_inquiries(id);


--
-- Name: credentials_legacy credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credentials_legacy
    ADD CONSTRAINT credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: document_access_tokens document_access_tokens_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_access_tokens
    ADD CONSTRAINT document_access_tokens_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.document_requests(id) ON DELETE CASCADE;


--
-- Name: document_annotation_sources document_annotation_sources_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_annotation_sources
    ADD CONSTRAINT document_annotation_sources_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: document_authors document_authors_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_authors
    ADD CONSTRAINT document_authors_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.authors(id) ON DELETE CASCADE;


--
-- Name: document_authors document_authors_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_authors
    ADD CONSTRAINT document_authors_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: document_keywords document_keywords_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_keywords
    ADD CONSTRAINT document_keywords_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: document_keywords document_keywords_keyword_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_keywords
    ADD CONSTRAINT document_keywords_keyword_id_fkey FOREIGN KEY (keyword_id) REFERENCES public.keywords(id) ON DELETE RESTRICT;


--
-- Name: document_permissions document_permissions_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_permissions
    ADD CONSTRAINT document_permissions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: document_permissions document_permissions_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_permissions
    ADD CONSTRAINT document_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id);


--
-- Name: document_permissions document_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_permissions
    ADD CONSTRAINT document_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: document_permissions document_permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_permissions
    ADD CONSTRAINT document_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: document_research_agenda document_research_agenda_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_research_agenda
    ADD CONSTRAINT document_research_agenda_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: document_research_agenda document_research_agenda_research_agenda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_research_agenda
    ADD CONSTRAINT document_research_agenda_research_agenda_id_fkey FOREIGN KEY (research_agenda_id) REFERENCES public.research_agenda(id);


--
-- Name: document_topics document_topics_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_topics
    ADD CONSTRAINT document_topics_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: document_topics document_topics_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_topics
    ADD CONSTRAINT document_topics_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE RESTRICT;


--
-- Name: documents documents_abstract_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_abstract_reviewed_by_fkey FOREIGN KEY (abstract_reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: documents documents_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);


--
-- Name: documents documents_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: documents documents_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: documents documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: files files_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: documents fk_compiled_parent; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT fk_compiled_parent FOREIGN KEY (compiled_parent_id) REFERENCES public.compiled_documents(id) ON DELETE SET NULL;


--
-- Name: user_document_annotations fk_user_document_annotations_source_document; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_document_annotations
    ADD CONSTRAINT fk_user_document_annotations_source_document FOREIGN KEY (source_id, document_id) REFERENCES public.document_annotation_sources(id, document_id);


--
-- Name: legacy_public_path_daily_hits legacy_public_path_daily_hits_release_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legacy_public_path_daily_hits
    ADD CONSTRAINT legacy_public_path_daily_hits_release_id_fkey FOREIGN KEY (release_id) REFERENCES public.legacy_public_release_soak(release_id);


--
-- Name: news_media_assets news_media_assets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_media_assets
    ADD CONSTRAINT news_media_assets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: news_media_jobs news_media_jobs_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_media_jobs
    ADD CONSTRAINT news_media_jobs_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.news_media_assets(id) ON DELETE CASCADE;


--
-- Name: news_media_tracks news_media_tracks_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_media_tracks
    ADD CONSTRAINT news_media_tracks_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.news_media_assets(id) ON DELETE CASCADE;


--
-- Name: news_media_upload_parts news_media_upload_parts_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_media_upload_parts
    ADD CONSTRAINT news_media_upload_parts_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.news_media_upload_sessions(id) ON DELETE CASCADE;


--
-- Name: news_media_upload_sessions news_media_upload_sessions_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_media_upload_sessions
    ADD CONSTRAINT news_media_upload_sessions_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.news_media_assets(id) ON DELETE CASCADE;


--
-- Name: news_media_upload_sessions news_media_upload_sessions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_media_upload_sessions
    ADD CONSTRAINT news_media_upload_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: news_media_variants news_media_variants_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_media_variants
    ADD CONSTRAINT news_media_variants_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.news_media_assets(id) ON DELETE CASCADE;


--
-- Name: news_post_authors news_post_authors_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_post_authors
    ADD CONSTRAINT news_post_authors_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.authors(id) ON DELETE CASCADE;


--
-- Name: news_post_authors news_post_authors_news_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_post_authors
    ADD CONSTRAINT news_post_authors_news_post_id_fkey FOREIGN KEY (news_post_id) REFERENCES public.news_posts(id) ON DELETE CASCADE;


--
-- Name: news_post_media news_post_media_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_post_media
    ADD CONSTRAINT news_post_media_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.news_media_assets(id) ON DELETE CASCADE;


--
-- Name: news_post_media news_post_media_news_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_post_media
    ADD CONSTRAINT news_post_media_news_post_id_fkey FOREIGN KEY (news_post_id) REFERENCES public.news_posts(id) ON DELETE CASCADE;


--
-- Name: news_post_works news_post_works_news_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_post_works
    ADD CONSTRAINT news_post_works_news_post_id_fkey FOREIGN KEY (news_post_id) REFERENCES public.news_posts(id) ON DELETE CASCADE;


--
-- Name: news_posts news_posts_cover_media_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_posts
    ADD CONSTRAINT news_posts_cover_media_id_fkey FOREIGN KEY (cover_media_id) REFERENCES public.news_media_assets(id) ON DELETE SET NULL;


--
-- Name: session session_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_compiled_document_history user_compiled_document_history_compiled_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_compiled_document_history
    ADD CONSTRAINT user_compiled_document_history_compiled_document_id_fkey FOREIGN KEY (compiled_document_id) REFERENCES public.compiled_documents(id) ON DELETE CASCADE;


--
-- Name: user_compiled_document_history user_compiled_document_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_compiled_document_history
    ADD CONSTRAINT user_compiled_document_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: user_document_annotations user_document_annotations_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_document_annotations
    ADD CONSTRAINT user_document_annotations_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: user_document_annotations user_document_annotations_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_document_annotations
    ADD CONSTRAINT user_document_annotations_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.document_annotation_sources(id) ON DELETE CASCADE;


--
-- Name: user_document_annotations user_document_annotations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_document_annotations
    ADD CONSTRAINT user_document_annotations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_document_history user_document_history_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_document_history
    ADD CONSTRAINT user_document_history_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: user_document_history user_document_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_document_history
    ADD CONSTRAINT user_document_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: user_document_reading_progress user_document_reading_progress_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_document_reading_progress
    ADD CONSTRAINT user_document_reading_progress_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: user_document_reading_progress user_document_reading_progress_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_document_reading_progress
    ADD CONSTRAINT user_document_reading_progress_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.document_annotation_sources(id) ON DELETE CASCADE;


--
-- Name: user_document_reading_progress user_document_reading_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_document_reading_progress
    ADD CONSTRAINT user_document_reading_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_read_compiled_documents user_read_compiled_documents_compiled_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_read_compiled_documents
    ADD CONSTRAINT user_read_compiled_documents_compiled_document_id_fkey FOREIGN KEY (compiled_document_id) REFERENCES public.compiled_documents(id) ON DELETE CASCADE;


--
-- Name: user_read_compiled_documents user_read_compiled_documents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_read_compiled_documents
    ADD CONSTRAINT user_read_compiled_documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_read_documents user_read_documents_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_read_documents
    ADD CONSTRAINT user_read_documents_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: user_read_documents user_read_documents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_read_documents
    ADD CONSTRAINT user_read_documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_saved_compiled_documents user_saved_compiled_documents_compiled_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_saved_compiled_documents
    ADD CONSTRAINT user_saved_compiled_documents_compiled_document_id_fkey FOREIGN KEY (compiled_document_id) REFERENCES public.compiled_documents(id) ON DELETE CASCADE;


--
-- Name: user_saved_compiled_documents user_saved_compiled_documents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_saved_compiled_documents
    ADD CONSTRAINT user_saved_compiled_documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: user_saved_documents user_saved_documents_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_saved_documents
    ADD CONSTRAINT user_saved_documents_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: user_saved_documents user_saved_documents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_saved_documents
    ADD CONSTRAINT user_saved_documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: user_saved_news_posts user_saved_news_posts_news_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_saved_news_posts
    ADD CONSTRAINT user_saved_news_posts_news_post_id_fkey FOREIGN KEY (news_post_id) REFERENCES public.news_posts(id) ON DELETE CASCADE;


--
-- Name: user_saved_news_posts user_saved_news_posts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_saved_news_posts
    ADD CONSTRAINT user_saved_news_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: users users_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- PostgreSQL database dump complete
--

\unrestrict 6ewJSGDRaAH6dpCmasgY0EFctToPkGYd3bzSX3mmr6iE2xTrvwEZBWcIts6GPkQ

