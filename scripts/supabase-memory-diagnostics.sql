-- Run in the Supabase SQL Editor as an administrator. Read-only; no query text or secrets returned.
-- Compare this snapshot with Observability > Reports > Memory usage and Memory commitment.
select jsonb_pretty(jsonb_build_object(
  'captured_at', now(),
  'database', current_database(),
  'settings', (
    select jsonb_object_agg(name, setting || coalesce(unit, ''))
    from pg_settings
    where name in ('max_connections', 'shared_buffers', 'work_mem',
                   'maintenance_work_mem', 'autovacuum_work_mem', 'max_worker_processes')
  ),
  'connections_by_role_and_state', (
    select coalesce(jsonb_agg(to_jsonb(s) order by s.connections desc), '[]'::jsonb)
    from (
      select usename as role, coalesce(state, 'unknown') as state,
             count(*) as connections,
             count(*) filter (where wait_event_type = 'Lock') as lock_waiting,
             max(now() - backend_start) as oldest_connection_age
      from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid()
      group by usename, state
    ) s
  ),
  'database_activity', (
    select jsonb_build_object(
      'active_backends', numbackends,
      'cache_hit_ratio', round(blks_hit::numeric / nullif(blks_hit + blks_read, 0), 4),
      'temp_files_since_stats_reset', temp_files,
      'temp_bytes_since_stats_reset', temp_bytes,
      'stats_reset', stats_reset
    )
    from pg_stat_database where datname = current_database()
  ),
  'largest_tables', (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.total_bytes desc), '[]'::jsonb)
    from (
      select schemaname, relname, pg_total_relation_size(relid) as total_bytes,
             n_live_tup as estimated_live_rows, n_dead_tup as estimated_dead_rows
      from pg_stat_user_tables
      where schemaname = 'public'
      order by pg_total_relation_size(relid) desc
      limit 10
    ) t
  )
)) as memory_diagnostics;
