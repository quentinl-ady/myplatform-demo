package com.myplatform.demo.configuration;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * Supabase exposes the public schema through its Data API, and the tables Hibernate creates there have no
 * row level security. Turning it on without any policy hides every row from the API roles, while this
 * backend keeps full access: Postgres doesn't apply row level security to the owner of a table.
 */
@Component
public class RowLevelSecurityInitializer {

    private static final Logger log = LoggerFactory.getLogger(RowLevelSecurityInitializer.class);

    private final JdbcTemplate jdbc;

    public RowLevelSecurityInitializer(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Runs once Hibernate has created or updated the tables. */
    @EventListener(ApplicationReadyEvent.class)
    public void enableOnPublicTables() {
        try {
            String database = jdbc.execute((ConnectionCallback<String>) c -> c.getMetaData().getDatabaseProductName());
            if (!"PostgreSQL".equals(database)) {
                return;
            }
            List<Map<String, Object>> tables = jdbc.queryForList("""
                    select tablename, tableowner = current_user as owned,
                           format('alter table public.%I enable row level security', tablename) as statement
                    from pg_tables
                    where schemaname = 'public' and not rowsecurity
                    """);
            for (Map<String, Object> table : tables) {
                if (Boolean.TRUE.equals(table.get("owned"))) {
                    jdbc.execute((String) table.get("statement"));
                    log.info("Row level security enabled on public.{}", table.get("tablename"));
                } else {
                    // Row level security would also hide the rows of another role's table from this backend.
                    log.warn("public.{} has no row level security and belongs to another role: enable it in Supabase",
                            table.get("tablename"));
                }
            }
        } catch (DataAccessException e) {
            log.error("Couldn't enable row level security on the public tables: {}", e.getMessage());
        }
    }
}
