-- Immutable baseline supplement: older deployments created this table at
-- runtime, while migration 0008 requires it before the server can start.
CREATE TABLE IF NOT EXISTS public.system_logs (
 id serial PRIMARY KEY, timestamp timestamptz DEFAULT CURRENT_TIMESTAMP,
 log_type varchar(50) NOT NULL, user_id varchar(50), username varchar(100),
 action varchar(255) NOT NULL, details jsonb, ip_address varchar(45),
 status varchar(50), related_id varchar(100)
);
CREATE INDEX IF NOT EXISTS idx_system_logs_timestamp ON public.system_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_system_logs_log_type ON public.system_logs(log_type);
CREATE INDEX IF NOT EXISTS idx_system_logs_user_id ON public.system_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_status ON public.system_logs(status);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.system_logs TO peas_app;
GRANT USAGE,SELECT,UPDATE ON SEQUENCE public.system_logs_id_seq TO peas_app;
