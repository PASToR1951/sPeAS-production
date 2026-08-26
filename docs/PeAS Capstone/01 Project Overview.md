# Project overview

PeAS publishes approved research metadata and PDFs, provides public author
profiles and document attribution, and gives administrators tools for upload,
review, publication, reporting, site content, and operations.

## Access model

- A visitor may browse approved public records, view safe author references and
  profiles, and download an available public PDF without authentication.
- An administrator must authenticate before viewing the full author directory,
  managing document-author relationships, uploading, reviewing, or accessing
  operational data.
- A document is publicly visible only when it is not deleted, is approved, is
  marked public, and any compiled parent is also live and approved.
- Public author references contain only string `id` and `full_name` values.
  Email, School ID, timestamps, provenance, and unpublished works are never part
  of that transfer object.

## Operational objectives

The immediate supported production topology is the native Windows Deno service
behind nginx. The target topology is a containerized application behind Caddy.
Security headers, trusted-origin validation, proxy-aware client identity,
health contracts, public DTOs, and authorization live in the application so
they work in either topology.

Production approval requires green cross-platform CI, zero high/critical npm
audit findings, external edge verification, and an accepted isolated restore
drill with measured RPO and RTO.
