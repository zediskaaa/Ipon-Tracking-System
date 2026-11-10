# Structured name migration

Apply `schema.sql` before deploying the matching frontend because the member RPC signatures change in this release.

The migration preserves `full_name` for every profile and member. It only auto-fills `first_name` and `last_name` when the existing display name contains exactly two valid name parts. Names with one part, three or more parts, unsupported punctuation, or uncertain structure remain unchanged with null structured fields for manual review.

New signups and member records store first, optional middle, and last names while continuing to build `full_name` for existing reports, tables, and integrations.

## Manual review

Run these read-only queries after applying the schema:

```sql
select id, full_name
from public.profiles
where first_name is null or last_name is null
order by full_name;

select id, full_name
from public.members
where first_name is null or last_name is null
order by full_name;
```

Ambiguous members can be reviewed through the member edit form. Their original `full_name` is shown until structured name parts are supplied and saved. Profiles remain readable through `full_name`; update ambiguous profile names only after confirming the correct parts with the account owner.
