-- Reference data for a clean PeAS installation.
-- This file intentionally contains no users, documents, requests, sessions,
-- history, logs, credentials, or uploaded-file metadata.
INSERT INTO public.roles (id, role_name) VALUES
  (1, 'ADMIN'),
  (2, 'USER'),
  (3, 'PUBLISHER')
ON CONFLICT (id) DO UPDATE SET role_name = EXCLUDED.role_name;

INSERT INTO public.categories (id, category_name) VALUES
  (1, 'Confluence'),
  (2, 'Synergy'),
  (3, 'Thesis'),
  (4, 'Dissertation')
ON CONFLICT (id) DO UPDATE SET category_name = EXCLUDED.category_name;

INSERT INTO public.departments (id, department_name, code) VALUES
  (1, 'College of Business Information Technology', 'CBIT'),
  (2, 'College of Nursing', 'CON'),
  (3, 'Basic Academic Education', 'BAED'),
  (4, 'College of Arts and Science Education', 'CASE')
ON CONFLICT (id) DO UPDATE SET
  department_name = EXCLUDED.department_name,
  code = EXCLUDED.code;

INSERT INTO public.research_agenda
  (id, code, name, normalized_name, is_official, is_active, sort_order)
VALUES
  (1, 'RA-01', 'Paulinian Spirituality/Identity and its impact to international community and global partnerships', lower(regexp_replace(btrim('Paulinian Spirituality/Identity and its impact to international community and global partnerships'), '[[:space:]]+', ' ', 'g')), true, true, 1),
  (2, 'RA-02', 'Paulinian Mission / Vision / Philosophy / Goals', lower(regexp_replace(btrim('Paulinian Mission / Vision / Philosophy / Goals'), '[[:space:]]+', ' ', 'g')), true, true, 2),
  (3, 'RA-03', 'Paulinian Roots and Formation', lower(regexp_replace(btrim('Paulinian Roots and Formation'), '[[:space:]]+', ' ', 'g')), true, true, 3),
  (4, 'RA-04', 'Advocacy (Peace, Pro-Life, Environment, Disaster & Risks Management)', lower(regexp_replace(btrim('Advocacy (Peace, Pro-Life, Environment, Disaster & Risks Management)'), '[[:space:]]+', ' ', 'g')), true, true, 4),
  (5, 'RA-05', 'Global Mental Health and Wellness', lower(regexp_replace(btrim('Global Mental Health and Wellness'), '[[:space:]]+', ' ', 'g')), true, true, 5),
  (6, 'RA-06', 'Synodal Church: Communion, Participation, and Mission', lower(regexp_replace(btrim('Synodal Church: Communion, Participation, and Mission'), '[[:space:]]+', ' ', 'g')), true, true, 6),
  (7, 'RA-07', 'Inclusivity and Equity in Education', lower(regexp_replace(btrim('Inclusivity and Equity in Education'), '[[:space:]]+', ' ', 'g')), true, true, 7),
  (8, 'RA-08', 'Curriculum development and Innovation geared towards internalization and global partnership', lower(regexp_replace(btrim('Curriculum development and Innovation geared towards internalization and global partnership'), '[[:space:]]+', ' ', 'g')), true, true, 8),
  (9, 'RA-09', 'OBE - Instruction', lower(regexp_replace(btrim('OBE - Instruction'), '[[:space:]]+', ' ', 'g')), true, true, 9),
  (10, 'RA-10', 'Technology Integration', lower(regexp_replace(btrim('Technology Integration'), '[[:space:]]+', ' ', 'g')), true, true, 10),
  (11, 'RA-11', 'Faculty / Staff Development', lower(regexp_replace(btrim('Faculty / Staff Development'), '[[:space:]]+', ' ', 'g')), true, true, 11),
  (12, 'RA-12', 'Infrastructure / Software Development and Innovation', lower(regexp_replace(btrim('Infrastructure / Software Development and Innovation'), '[[:space:]]+', ' ', 'g')), true, true, 12),
  (13, 'RA-13', 'Financial Management, Sustainability, and Energy Security', lower(regexp_replace(btrim('Financial Management, Sustainability, and Energy Security'), '[[:space:]]+', ' ', 'g')), true, true, 13),
  (14, 'RA-14', 'Environmental Discipline and Stewardship', lower(regexp_replace(btrim('Environmental Discipline and Stewardship'), '[[:space:]]+', ' ', 'g')), true, true, 14),
  (15, 'RA-15', 'Ethical Leaders & Professionals', lower(regexp_replace(btrim('Ethical Leaders & Professionals'), '[[:space:]]+', ' ', 'g')), true, true, 15),
  (16, 'RA-16', 'Cutting-edge Resilient Visionaries & Innovators; Engaging, Trustworthy Team Builders & Mentors; Reliable, Productive Experts & Implementers; Dedicated, Transformative Supporters & Stewardship in context of international community and global partnerships', lower(regexp_replace(btrim('Cutting-edge Resilient Visionaries & Innovators; Engaging, Trustworthy Team Builders & Mentors; Reliable, Productive Experts & Implementers; Dedicated, Transformative Supporters & Stewardship in context of international community and global partnerships'), '[[:space:]]+', ' ', 'g')), true, true, 16),
  (17, 'RA-17', 'Civic and Community Involvement', lower(regexp_replace(btrim('Civic and Community Involvement'), '[[:space:]]+', ' ', 'g')), true, true, 17),
  (18, 'RA-18', 'Equality and Diversity', lower(regexp_replace(btrim('Equality and Diversity'), '[[:space:]]+', ' ', 'g')), true, true, 18),
  (19, 'RA-19', 'Economic cooperation and integration', lower(regexp_replace(btrim('Economic cooperation and integration'), '[[:space:]]+', ' ', 'g')), true, true, 19),
  (20, 'RA-20', 'Student and Faculty Mobility', lower(regexp_replace(btrim('Student and Faculty Mobility'), '[[:space:]]+', ' ', 'g')), true, true, 20)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name = EXCLUDED.name,
  normalized_name = EXCLUDED.normalized_name,
  is_official = true,
  is_active = true,
  sort_order = EXCLUDED.sort_order;

SELECT setval('public.roles_id_seq', (SELECT COALESCE(MAX(id), 1) FROM public.roles));
SELECT setval('public.categories_id_seq', (SELECT COALESCE(MAX(id), 1) FROM public.categories));
SELECT setval('public.departments_id_seq', (SELECT COALESCE(MAX(id), 1) FROM public.departments));
SELECT setval('public.research_agenda_id_seq', (SELECT COALESCE(MAX(id), 1) FROM public.research_agenda));
