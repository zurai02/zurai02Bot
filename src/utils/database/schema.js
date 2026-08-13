// schema.js

import { pgConfig } from '../../config/database/postgres.js';

const t = pgConfig.tables;

// ─── Helper: Common Column Fragments ─────────────────────────────────────────

const TIMESTAMPS = `
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
`;

const SOFT_DELETE = `
    deleted_at TIMESTAMP DEFAULT NULL
`;

const JSONB_DEFAULT = (val = '{}') => `JSONB DEFAULT '${val}'`;

const SNOWFLAKE = (name, constraints = '') => 
    `${name} VARCHAR(20) ${constraints}`;

const BIGINT_DEFAULT = (name, def = 0) => 
    `${name} BIGINT DEFAULT ${def}`;

const INTEGER_DEFAULT = (name, def = 0) => 
    `${name} INTEGER DEFAULT ${def}`;

const PRIMARY_KEY = (cols) => `PRIMARY KEY (${cols})`;
const FOREIGN_KEY = (col, refTable, refCol = 'id') => 
    `FOREIGN KEY (${col}) REFERENCES ${refTable}(${refCol}) ON DELETE CASCADE`;

// ─── Core Tables ─────────────────────────────────────────────────────────────

export const tableStatements = [
    // ─── Guilds ──────────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.guilds} (
        ${SNOWFLAKE('id', 'PRIMARY KEY')},
        config JSONB DEFAULT '{}',
        counters JSONB DEFAULT '[]',
        features JSONB DEFAULT '[]',
        premium_until TIMESTAMP DEFAULT NULL,
        ${TIMESTAMPS}
    )`,

    // ─── Users ───────────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.users} (
        ${SNOWFLAKE('id', 'PRIMARY KEY')},
        username VARCHAR(100),
        discriminator VARCHAR(10),
        avatar VARCHAR(100),
        locale VARCHAR(10),
        ${TIMESTAMPS}
    )`,

    // ─── Guild Membership ────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.guild_users} (
        ${SNOWFLAKE('guild_id')},
        ${SNOWFLAKE('user_id')},
        nickname VARCHAR(100),
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ${TIMESTAMPS},
        ${PRIMARY_KEY('guild_id, user_id')},
        ${FOREIGN_KEY('guild_id', t.guilds)},
        ${FOREIGN_KEY('user_id', t.users)}
    )`,

    // ─── Birthdays ───────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.birthdays} (
        ${SNOWFLAKE('guild_id')},
        ${SNOWFLAKE('user_id')},
        month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
        day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
        timezone VARCHAR(50) DEFAULT 'UTC',
        ${TIMESTAMPS},
        ${PRIMARY_KEY('guild_id, user_id')},
        ${FOREIGN_KEY('guild_id', t.guilds)},
        ${FOREIGN_KEY('user_id', t.users)}
    )`,

    // ─── Giveaways ───────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.giveaways} (
        id SERIAL PRIMARY KEY,
        ${SNOWFLAKE('guild_id')},
        ${SNOWFLAKE('message_id', 'NOT NULL')},
        ${SNOWFLAKE('channel_id', 'NOT NULL')},
        ${SNOWFLAKE('creator_id')},
        data JSONB NOT NULL DEFAULT '{}',
        ends_at TIMESTAMP,
        winner_count INTEGER DEFAULT 1 CHECK (winner_count > 0),
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'ended', 'cancelled')),
        ${TIMESTAMPS},
        ${FOREIGN_KEY('guild_id', t.guilds)},
        UNIQUE(guild_id, message_id)
    )`,

    // ─── Giveaway Entries ────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.giveaway_entries} (
        ${SNOWFLAKE('giveaway_id')},
        ${SNOWFLAKE('user_id')},
        entries INTEGER DEFAULT 1 CHECK (entries > 0),
        ${TIMESTAMPS},
        ${PRIMARY_KEY('giveaway_id, user_id')},
        ${FOREIGN_KEY('user_id', t.users)}
    )`,

    // ─── Tickets ───────────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.tickets} (
        ${SNOWFLAKE('guild_id')},
        ${SNOWFLAKE('channel_id', 'PRIMARY KEY')},
        ${SNOWFLAKE('user_id')},
        ${SNOWFLAKE('panel_id')},
        data JSONB NOT NULL DEFAULT '{}',
        status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'closed', 'archived')),
        expires_at TIMESTAMP,
        closed_at TIMESTAMP,
        ${TIMESTAMPS},
        ${FOREIGN_KEY('guild_id', t.guilds)},
        ${FOREIGN_KEY('user_id', t.users)}
    )`,

    // ─── Ticket Panels ───────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.ticket_panels} (
        ${SNOWFLAKE('guild_id')},
        ${SNOWFLAKE('panel_id', 'PRIMARY KEY')},
        name VARCHAR(100),
        data JSONB NOT NULL DEFAULT '{}',
        ${TIMESTAMPS},
        ${FOREIGN_KEY('guild_id', t.guilds)}
    )`,

    // ─── AFK Status ──────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.afk_status} (
        ${SNOWFLAKE('guild_id')},
        ${SNOWFLAKE('user_id')},
        reason TEXT,
        status_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        ${TIMESTAMPS},
        ${PRIMARY_KEY('guild_id, user_id')},
        ${FOREIGN_KEY('guild_id', t.guilds)},
        ${FOREIGN_KEY('user_id', t.users)}
    )`,

    // ─── Welcome Configs ─────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.welcome_configs} (
        ${SNOWFLAKE('guild_id', 'PRIMARY KEY')},
        config JSONB NOT NULL DEFAULT '{}',
        ${TIMESTAMPS},
        ${FOREIGN_KEY('guild_id', t.guilds)}
    )`,

    // ─── Leveling Configs ────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.leveling_configs} (
        ${SNOWFLAKE('guild_id', 'PRIMARY KEY')},
        config JSONB NOT NULL DEFAULT '{}',
        ${TIMESTAMPS},
        ${FOREIGN_KEY('guild_id', t.guilds)}
    )`,

    // ─── User Levels ─────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.user_levels} (
        ${SNOWFLAKE('guild_id')},
        ${SNOWFLAKE('user_id')},
        ${BIGINT_DEFAULT('xp')},
        ${INTEGER_DEFAULT('level')},
        ${BIGINT_DEFAULT('total_xp')},
        ${INTEGER_DEFAULT('message_count')},
        ${INTEGER_DEFAULT('voice_minutes')},
        last_message TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        rank INTEGER DEFAULT 0,
        ${TIMESTAMPS},
        ${PRIMARY_KEY('guild_id, user_id')},
        ${FOREIGN_KEY('guild_id', t.guilds)},
        ${FOREIGN_KEY('user_id', t.users)},
        CHECK (level >= 0 AND level <= 1000),
        CHECK (xp >= 0),
        CHECK (total_xp >= 0)
    )`,

    // ─── Economy ─────────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.economy} (
        ${SNOWFLAKE('guild_id')},
        ${SNOWFLAKE('user_id')},
        ${BIGINT_DEFAULT('balance')},
        ${BIGINT_DEFAULT('bank')},
        ${BIGINT_DEFAULT('net_worth')},
        data JSONB DEFAULT '{}',
        ${TIMESTAMPS},
        ${PRIMARY_KEY('guild_id, user_id')},
        ${FOREIGN_KEY('guild_id', t.guilds)},
        ${FOREIGN_KEY('user_id', t.users)},
        CHECK (balance >= 0),
        CHECK (bank >= 0)
    )`,

    // ─── Economy Transactions ────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.economy_transactions} (
        id SERIAL PRIMARY KEY,
        ${SNOWFLAKE('guild_id')},
        ${SNOWFLAKE('user_id')},
        ${SNOWFLAKE('target_user_id')},
        amount BIGINT NOT NULL,
        type VARCHAR(50) NOT NULL,
        description TEXT,
        ${TIMESTAMPS},
        ${FOREIGN_KEY('guild_id', t.guilds)},
        ${FOREIGN_KEY('user_id', t.users)}
    )`,

    // ─── Verification Audit ──────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.verification_audit} (
        id SERIAL PRIMARY KEY,
        ${SNOWFLAKE('guild_id', 'NOT NULL')},
        ${SNOWFLAKE('user_id', 'NOT NULL')},
        action VARCHAR(50) NOT NULL,
        source VARCHAR(50),
        ${SNOWFLAKE('moderator_id')},
        metadata JSONB DEFAULT '{}',
        ${TIMESTAMPS}
    )`,

    // ─── Invite Tracking ───────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.invite_tracking} (
        ${SNOWFLAKE('guild_id')},
        ${SNOWFLAKE('inviter_id')},
        invite_code VARCHAR(20),
        uses INTEGER DEFAULT 0 CHECK (uses >= 0),
        data JSONB DEFAULT '{}',
        ${TIMESTAMPS},
        ${PRIMARY_KEY('guild_id, invite_code')},
        ${FOREIGN_KEY('guild_id', t.guilds)}
    )`,

    // ─── Application Roles ───────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.application_roles} (
        ${SNOWFLAKE('guild_id')},
        ${SNOWFLAKE('role_id')},
        data JSONB DEFAULT '{}',
        ${TIMESTAMPS},
        ${PRIMARY_KEY('guild_id, role_id')},
        ${FOREIGN_KEY('guild_id', t.guilds)}
    )`,

    // ─── Reaction Roles ──────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.reaction_roles} (
        ${SNOWFLAKE('guild_id')},
        ${SNOWFLAKE('message_id')},
        ${SNOWFLAKE('channel_id')},
        emoji VARCHAR(100) NOT NULL,
        ${SNOWFLAKE('role_id')},
        data JSONB DEFAULT '{}',
        ${TIMESTAMPS},
        ${PRIMARY_KEY('guild_id, message_id, emoji')},
        ${FOREIGN_KEY('guild_id', t.guilds)}
    )`,

    // ─── Moderation Cases ────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.moderation_cases} (
        id SERIAL PRIMARY KEY,
        ${SNOWFLAKE('guild_id', 'NOT NULL')},
        ${SNOWFLAKE('user_id', 'NOT NULL')},
        ${SNOWFLAKE('moderator_id')},
        case_number INTEGER NOT NULL,
        action VARCHAR(50) NOT NULL,
        reason TEXT,
        duration INTEGER,
        expires_at TIMESTAMP,
        active BOOLEAN DEFAULT true,
        ${TIMESTAMPS},
        ${FOREIGN_KEY('guild_id', t.guilds)},
        UNIQUE(guild_id, case_number)
    )`,

    // ─── Mutes / Timeouts ──────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.mutes} (
        ${SNOWFLAKE('guild_id')},
        ${SNOWFLAKE('user_id')},
        ${SNOWFLAKE('moderator_id')},
        reason TEXT,
        expires_at TIMESTAMP,
        active BOOLEAN DEFAULT true,
        ${TIMESTAMPS},
        ${PRIMARY_KEY('guild_id, user_id')},
        ${FOREIGN_KEY('guild_id', t.guilds)},
        ${FOREIGN_KEY('user_id', t.users)}
    )`,

    // ─── AutoMod Rules ───────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.automod_rules} (
        id SERIAL PRIMARY KEY,
        ${SNOWFLAKE('guild_id', 'NOT NULL')},
        name VARCHAR(100) NOT NULL,
        rule_type VARCHAR(50) NOT NULL,
        config JSONB NOT NULL DEFAULT '{}',
        enabled BOOLEAN DEFAULT true,
        ${TIMESTAMPS},
        ${FOREIGN_KEY('guild_id', t.guilds)}
    )`,

    // ─── AutoMod Logs ──────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.automod_logs} (
        id SERIAL PRIMARY KEY,
        ${SNOWFLAKE('guild_id', 'NOT NULL')},
        ${SNOWFLAKE('user_id')},
        ${SNOWFLAKE('message_id')},
        rule_id INTEGER,
        action_taken VARCHAR(50),
        content TEXT,
        ${TIMESTAMPS},
        ${FOREIGN_KEY('guild_id', t.guilds)},
        ${FOREIGN_KEY('rule_id', t.automod_rules, 'id')}
    )`,

    // ─── Starboard ─────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.starboard_entries} (
        ${SNOWFLAKE('guild_id')},
        ${SNOWFLAKE('message_id')},
        ${SNOWFLAKE('channel_id')},
        ${SNOWFLAKE('author_id')},
        ${SNOWFLAKE('starboard_message_id')},
        star_count INTEGER DEFAULT 0 CHECK (star_count >= 0),
        ${TIMESTAMPS},
        ${PRIMARY_KEY('guild_id, message_id')},
        ${FOREIGN_KEY('guild_id', t.guilds)}
    )`,

    // ─── Custom Commands ─────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.custom_commands} (
        ${SNOWFLAKE('guild_id')},
        name VARCHAR(100) NOT NULL,
        response TEXT NOT NULL,
        aliases JSONB DEFAULT '[]',
        cooldown INTEGER DEFAULT 0,
        permissions JSONB DEFAULT '[]',
        ${TIMESTAMPS},
        ${PRIMARY_KEY('guild_id, name')},
        ${FOREIGN_KEY('guild_id', t.guilds)}
    )`,

    // ─── Lockdown Channels ───────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.lockdowns} (
        ${SNOWFLAKE('guild_id')},
        ${SNOWFLAKE('channel_id')},
        ${SNOWFLAKE('moderator_id')},
        original_permissions JSONB DEFAULT '{}',
        reason TEXT,
        expires_at TIMESTAMP,
        active BOOLEAN DEFAULT true,
        ${TIMESTAMPS},
        ${PRIMARY_KEY('guild_id, channel_id')},
        ${FOREIGN_KEY('guild_id', t.guilds)}
    )`,

    // ─── Guild Logs ──────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.guild_logs} (
        id SERIAL PRIMARY KEY,
        ${SNOWFLAKE('guild_id', 'NOT NULL')},
        ${SNOWFLAKE('target_id')},
        ${SNOWFLAKE('executor_id')},
        log_type VARCHAR(50) NOT NULL,
        data JSONB NOT NULL DEFAULT '{}',
        ${TIMESTAMPS},
        ${FOREIGN_KEY('guild_id', t.guilds)}
    )`,

    // ─── Premium Subscriptions ───────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.premium} (
        ${SNOWFLAKE('guild_id', 'PRIMARY KEY')},
        tier VARCHAR(20) DEFAULT 'free',
        expires_at TIMESTAMP,
        features JSONB DEFAULT '[]',
        ${TIMESTAMPS},
        ${FOREIGN_KEY('guild_id', t.guilds)}
    )`,

    // ─── Temp Data ───────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.temp_data} (
        key VARCHAR(255) PRIMARY KEY,
        value JSONB NOT NULL,
        expires_at TIMESTAMP,
        ${TIMESTAMPS}
    )`,

    // ─── Cache Data ──────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${t.cache_data} (
        key VARCHAR(255) PRIMARY KEY,
        value JSONB NOT NULL,
        expires_at TIMESTAMP,
        ${TIMESTAMPS}
    )`,
];

// ─── Indexes ─────────────────────────────────────────────────────────────────

export const indexStatements = [
    // Guild Users
    `CREATE INDEX IF NOT EXISTS idx_guild_users_guild_id ON ${t.guild_users}(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_guild_users_user_id ON ${t.guild_users}(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_guild_users_last_seen ON ${t.guild_users}(last_seen_at DESC)`,

    // Birthdays
    `CREATE INDEX IF NOT EXISTS idx_birthdays_guild_id ON ${t.birthdays}(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_birthdays_month_day ON ${t.birthdays}(month, day)`,
    `CREATE INDEX IF NOT EXISTS idx_birthdays_next ON ${t.birthdays}(guild_id, month, day)`,

    // Giveaways
    `CREATE INDEX IF NOT EXISTS idx_giveaways_guild_id ON ${t.giveaways}(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_giveaways_ends_at ON ${t.giveaways}(ends_at) WHERE status = 'active'`,
    `CREATE INDEX IF NOT EXISTS idx_giveaways_status ON ${t.giveaways}(status)`,

    // Giveaway Entries
    `CREATE INDEX IF NOT EXISTS idx_giveaway_entries_giveaway ON ${t.giveaway_entries}(giveaway_id)`,

    // Tickets
    `CREATE INDEX IF NOT EXISTS idx_tickets_guild_id ON ${t.tickets}(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tickets_user ON ${t.tickets}(guild_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tickets_status ON ${t.tickets}(status)`,
    `CREATE INDEX IF NOT EXISTS idx_tickets_expires_at ON ${t.tickets}(expires_at) WHERE expires_at IS NOT NULL`,

    // Ticket Panels
    `CREATE INDEX IF NOT EXISTS idx_ticket_panels_guild ON ${t.ticket_panels}(guild_id)`,

    // AFK
    `CREATE INDEX IF NOT EXISTS idx_afk_status_guild_id ON ${t.afk_status}(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_afk_status_expires_at ON ${t.afk_status}(expires_at) WHERE expires_at IS NOT NULL`,

    // User Levels — CRITICAL for leaderboard performance
    `CREATE INDEX IF NOT EXISTS idx_user_levels_guild_id ON ${t.user_levels}(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_user_levels_leaderboard ON ${t.user_levels}(guild_id, total_xp DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_user_levels_rank ON ${t.user_levels}(guild_id, rank)`,
    `CREATE INDEX IF NOT EXISTS idx_user_levels_xp ON ${t.user_levels}(xp)`,

    // Economy
    `CREATE INDEX IF NOT EXISTS idx_economy_guild_id ON ${t.economy}(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_economy_rich ON ${t.economy}(guild_id, net_worth DESC)`,

    // Economy Transactions
    `CREATE INDEX IF NOT EXISTS idx_economy_tx_guild ON ${t.economy_transactions}(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_economy_tx_user ON ${t.economy_transactions}(guild_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_economy_tx_type ON ${t.economy_transactions}(type)`,

    // Verification Audit
    `CREATE INDEX IF NOT EXISTS idx_verification_audit_guild_id ON ${t.verification_audit}(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_verification_audit_user_id ON ${t.verification_audit}(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_verification_audit_created_at ON ${t.verification_audit}(created_at DESC)`,

    // Invite Tracking
    `CREATE INDEX IF NOT EXISTS idx_invite_tracking_guild ON ${t.invite_tracking}(guild_id)`,

    // Reaction Roles
    `CREATE INDEX IF NOT EXISTS idx_reaction_roles_guild ON ${t.reaction_roles}(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reaction_roles_message ON ${t.reaction_roles}(message_id)`,

    // Moderation Cases
    `CREATE INDEX IF NOT EXISTS idx_moderation_cases_guild ON ${t.moderation_cases}(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_moderation_cases_user ON ${t.moderation_cases}(guild_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_moderation_cases_active ON ${t.moderation_cases}(guild_id, active) WHERE active = true`,
    `CREATE INDEX IF NOT EXISTS idx_moderation_cases_expires ON ${t.moderation_cases}(expires_at) WHERE expires_at IS NOT NULL`,

    // Mutes
    `CREATE INDEX IF NOT EXISTS idx_mutes_guild ON ${t.mutes}(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mutes_active ON ${t.mutes}(guild_id, active) WHERE active = true`,
    `CREATE INDEX IF NOT EXISTS idx_mutes_expires ON ${t.mutes}(expires_at) WHERE expires_at IS NOT NULL`,

    // AutoMod
    `CREATE INDEX IF NOT EXISTS idx_automod_rules_guild ON ${t.automod_rules}(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_automod_logs_guild ON ${t.automod_logs}(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_automod_logs_user ON ${t.automod_logs}(guild_id, user_id)`,

    // Starboard
    `CREATE INDEX IF NOT EXISTS idx_starboard_guild ON ${t.starboard_entries}(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_starboard_stars ON ${t.starboard_entries}(guild_id, star_count DESC)`,

    // Custom Commands
    `CREATE INDEX IF NOT EXISTS idx_custom_commands_guild ON ${t.custom_commands}(guild_id)`,

    // Lockdowns
    `CREATE INDEX IF NOT EXISTS idx_lockdowns_guild ON ${t.lockdowns}(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lockdowns_active ON ${t.lockdowns}(guild_id, active) WHERE active = true`,

    // Guild Logs
    `CREATE INDEX IF NOT EXISTS idx_guild_logs_guild ON ${t.guild_logs}(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_guild_logs_type ON ${t.guild_logs}(guild_id, log_type)`,
    `CREATE INDEX IF NOT EXISTS idx_guild_logs_created ON ${t.guild_logs}(created_at DESC)`,

    // Premium
    `CREATE INDEX IF NOT EXISTS idx_premium_expires ON ${t.premium}(expires_at) WHERE expires_at IS NOT NULL`,

    // Temp/Cache cleanup
    `CREATE INDEX IF NOT EXISTS idx_temp_data_expires_at ON ${t.temp_data}(expires_at) WHERE expires_at IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_cache_data_expires_at ON ${t.cache_data}(expires_at) WHERE expires_at IS NOT NULL`,
];

// ─── Trigger Function ────────────────────────────────────────────────────────

export const UPDATE_TIMESTAMP_FUNCTION = `
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
    END;
    $$ language 'plpgsql';
`;

// ─── Trigger Definitions ─────────────────────────────────────────────────────

export const triggerDefinitions = [
    { name: 'trg_guilds_updated_at', table: t.guilds },
    { name: 'trg_users_updated_at', table: t.users },
    { name: 'trg_guild_users_updated_at', table: t.guild_users },
    { name: 'trg_birthdays_updated_at', table: t.birthdays },
    { name: 'trg_giveaways_updated_at', table: t.giveaways },
    { name: 'trg_giveaway_entries_updated_at', table: t.giveaway_entries },
    { name: 'trg_tickets_updated_at', table: t.tickets },
    { name: 'trg_ticket_panels_updated_at', table: t.ticket_panels },
    { name: 'trg_afk_status_updated_at', table: t.afk_status },
    { name: 'trg_welcome_configs_updated_at', table: t.welcome_configs },
    { name: 'trg_leveling_configs_updated_at', table: t.leveling_configs },
    { name: 'trg_user_levels_updated_at', table: t.user_levels },
    { name: 'trg_economy_updated_at', table: t.economy },
    { name: 'trg_economy_transactions_updated_at', table: t.economy_transactions },
    { name: 'trg_application_roles_updated_at', table: t.application_roles },
    { name: 'trg_reaction_roles_updated_at', table: t.reaction_roles },
    { name: 'trg_moderation_cases_updated_at', table: t.moderation_cases },
    { name: 'trg_mutes_updated_at', table: t.mutes },
    { name: 'trg_automod_rules_updated_at', table: t.automod_rules },
    { name: 'trg_automod_logs_updated_at', table: t.automod_logs },
    { name: 'trg_starboard_entries_updated_at', table: t.starboard_entries },
    { name: 'trg_custom_commands_updated_at', table: t.custom_commands },
    { name: 'trg_lockdowns_updated_at', table: t.lockdowns },
    { name: 'trg_guild_logs_updated_at', table: t.guild_logs },
    { name: 'trg_premium_updated_at', table: t.premium },
];

// ─── Cleanup Procedures ────────────────────────────────────────────────────────

export const cleanupProcedures = [
    // Clean expired temp data
    `
    CREATE OR REPLACE FUNCTION cleanup_expired_temp()
    RETURNS INTEGER AS $$
    DECLARE
        deleted_count INTEGER;
    BEGIN
        DELETE FROM ${t.temp_data} WHERE expires_at < CURRENT_TIMESTAMP;
        GET DIAGNOSTICS deleted_count = ROW_COUNT;
        RETURN deleted_count;
    END;
    $$ LANGUAGE plpgsql;
    `,

    // Clean expired cache
    `
    CREATE OR EXISTS FUNCTION cleanup_expired_cache()
    RETURNS INTEGER AS $$
    DECLARE
        deleted_count INTEGER;
    BEGIN
        DELETE FROM ${t.cache_data} WHERE expires_at < CURRENT_TIMESTAMP;
        GET DIAGNOSTICS deleted_count = ROW_COUNT;
        RETURN deleted_count;
    END;
    $$ LANGUAGE plpgsql;
    `,

    // Clean expired AFK status
    `
    CREATE OR REPLACE FUNCTION cleanup_expired_afk()
    RETURNS INTEGER AS $$
    DECLARE
        deleted_count INTEGER;
    BEGIN
        DELETE FROM ${t.afk_status} WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP;
        GET DIAGNOSTICS deleted_count = ROW_COUNT;
        RETURN deleted_count;
    END;
    $$ LANGUAGE plpgsql;
    `,

    // Clean expired mutes
    `
    CREATE OR REPLACE FUNCTION cleanup_expired_mutes()
    RETURNS INTEGER AS $$
    DECLARE
        updated_count INTEGER;
    BEGIN
        UPDATE ${t.mutes} 
        SET active = false 
        WHERE active = true AND expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP;
        GET DIAGNOSTICS updated_count = ROW_COUNT;
        RETURN updated_count;
    END;
    $$ LANGUAGE plpgsql;
    `,

    // Clean expired lockdowns
    `
    CREATE OR REPLACE FUNCTION cleanup_expired_lockdowns()
    RETURNS INTEGER AS $$
    DECLARE
        updated_count INTEGER;
    BEGIN
        UPDATE ${t.lockdowns} 
        SET active = false 
        WHERE active = true AND expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP;
        GET DIAGNOSTICS updated_count = ROW_COUNT;
        RETURN updated_count;
    END;
    $$ LANGUAGE plpgsql;
    `,
];

// ─── Materialized Views ──────────────────────────────────────────────────────

export const materializedViews = [
    // Leaderboard view for fast reads
    `
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_guild_leaderboards AS
    SELECT 
        guild_id,
        user_id,
        level,
        total_xp,
        rank() OVER (PARTITION BY guild_id ORDER BY total_xp DESC) as leaderboard_rank,
        message_count,
        voice_minutes
    FROM ${t.user_levels}
    WITH DATA;
    `,
    
    // Economy leaderboard view
    `
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_guild_economy AS
    SELECT 
        guild_id,
        user_id,
        balance,
        bank,
        net_worth,
        rank() OVER (PARTITION BY guild_id ORDER BY net_worth DESC) as economy_rank
    FROM ${t.economy}
    WITH DATA;
    `,
];

export const refreshLeaderboardView = `
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_guild_leaderboards;
`;

export const refreshEconomyView = `
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_guild_economy;
`;

// ─── Schema Version ───────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 2;

export const versionTable = `
    CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        description TEXT
    );
`;

export const insertVersion = `
    INSERT INTO schema_version (version, description) 
    VALUES (${SCHEMA_VERSION}, 'Added moderation, automod, starboard, custom commands, lockdowns, premium, economy transactions, materialized views')
    ON CONFLICT (version) DO NOTHING;
`;

// ─── Migration Helpers ───────────────────────────────────────────────────────

export async function runMigrations(client) {
    await client.query(versionTable);
    
    const { rows } = await client.query('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1');
    const currentVersion = rows[0]?.version || 0;
    
    if (currentVersion < SCHEMA_VERSION) {
        // Run all table and index creation
        for (const stmt of [...tableStatements, ...indexStatements]) {
            await client.query(stmt);
        }
        
        // Create function
        await client.query(UPDATE_TIMESTAMP_FUNCTION);
        
        // Create triggers
        for (const { name, table } of triggerDefinitions) {
            await client.query(`
                DROP TRIGGER IF EXISTS ${name} ON ${table};
                CREATE TRIGGER ${name}
                BEFORE UPDATE ON ${table}
                FOR EACH ROW
                EXECUTE FUNCTION update_updated_at_column();
            `);
        }
        
        // Create cleanup procedures
        for (const proc of cleanupProcedures) {
            await client.query(proc);
        }
        
        // Create materialized views
        for (const view of materializedViews) {
            await client.query(view);
        }
        
        // Create unique indexes for concurrent refresh
        await client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_leaderboards_pk ON mv_guild_leaderboards(guild_id, user_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_economy_pk ON mv_guild_economy(guild_id, user_id);
        `);
        
        // Record version
        await client.query(insertVersion);
    }
}

export default {
    tableStatements,
    indexStatements,
    UPDATE_TIMESTAMP_FUNCTION,
    triggerDefinitions,
    cleanupProcedures,
    materializedViews,
    refreshLeaderboardView,
    refreshEconomyView,
    SCHEMA_VERSION,
    runMigrations,
};
