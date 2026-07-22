-- Integration tests run against their own database so they can truncate freely
-- without touching seeded demo data (spec §18).
--
-- This script runs only on first initialisation of an empty pgdata volume. After a
-- `docker compose down -v`, it runs again automatically.
CREATE DATABASE clearchain_test;
