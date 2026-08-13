// keyRouter.js

import {
    canonicalizeKey,
    getEconomyPrefix,
    getUserLevelPrefix,
    getWarningsPrefix,
    getReactionRolesPrefix,
    getApplicationsPrefix,
    getTicketCounterKey,
    getServerCountersKey,
    getGuildConfigKey,
    getGuildBirthdaysKey,
    getWelcomeConfigKey,
    getLevelingKey,
} from './keys.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const TEMP_BACKED_TYPES = new Set([
    'warnings',
    'usernotes',
    'usernotes_list',
    'reaction_role',
    'application',
    'application_roles',
    'application_settings',
    'application_users',
    'jointocreate_config',
    'jointocreate_channels',
    'birthday_left',
    'birthday_tracking',
    'invite_data',
    'giveaway_entry',
    'giveaway_lock',
    'ticket_counter',
    'moderation_case',
    'automod_rule',
    'starboard_entry',
    'custom_command',
    'mute',
    'lockdown',
    'premium',
    'blacklist',
]);

const GUILD_SCOPED_SINGLETONS = [
    'config',
    'birthdays',
    'welcome',
    'leveling',
    'counters',
    'applications:roles',
    'applications:settings',
    'jointocreate',
    'jointocreate:channels',
    'invites',
    'usernotes:list',
    'birthdays:left',
    'birthdays:tracking',
    'automod',
    'logs',
    'starboard',
    'premium',
];

// Pre-compiled regex patterns for performance
const PATTERNS = Object.freeze({
    ECONOMY: /^economy:([^:]+):$/,
    GUILD_ECONOMY: /^guild:([^:]+):economy:$/,
    USER_LEVELS_SHORT: /^([^:]+):leveling:users:$/,
    USER_LEVELS_GUILD: /^guild:([^:]+):leveling:users:$/,
    TICKETS: /^guild:([^:]+):ticket:$/,
    WARNINGS_MOD: /^moderation:warnings:([^:]+):$/,
    WARNINGS_GUILD: /^guild:([^:]+):warnings:$/,
    REACTION_ROLES_SHORT: /^reaction_roles:([^:]+):$/,
    REACTION_ROLES_GUILD: /^guild:([^:]+):reaction_roles:$/,
    APPLICATIONS: /^guild:([^:]+):applications:$/,
    GUILD_ROOT: /^guild:([^:]+):$/,
    GIVEAWAY_LOCK: /^giveaway:lock:([^:]+)$/,
    GIVEAWAY_ENTRY: /^giveaway:([^:]+):([^:]+)$/,
});

// ─── Type Guards ─────────────────────────────────────────────────────────────

export function isTempBackedType(type) {
    return type === 'temp' || TEMP_BACKED_TYPES.has(type);
}

export function isGuildScopedType(type) {
    return type.startsWith('guild_') || 
           ['economy', 'user_level', 'afk_status', 'ticket', 'warnings', 
            'usernotes', 'usernotes_list', 'reaction_role', 'application',
            'application_roles', 'application_settings', 'application_users',
            'jointocreate_config', 'jointocreate_channels', 'invite_uses',
            'invite_member', 'invite_tracking', 'fake_account',
            'leveling_config', 'leveling_data', 'counters'].includes(type);
}

// ─── Key Parsing ─────────────────────────────────────────────────────────────

/**
 * Parse a storage key into routing metadata.
 * @param {string} key - Raw storage key
 * @returns {KeyMetadata} Routing metadata with type, ids, and fullKey
 */
export function parseKey(key) {
    if (!key || typeof key !== 'string') {
        throw new TypeError('Key must be a non-empty string');
    }

    const fullKey = canonicalizeKey(key);

    // Fast-path for special namespaces
    if (fullKey.startsWith('temp:')) {
        return { type: 'temp', fullKey, namespace: 'temp' };
    }
    if (fullKey.startsWith('cache:')) {
        return { type: 'cache', fullKey, namespace: 'cache', ttl: null };
    }

    // Parse colon-delimited path with safe splitting
    const parts = fullKey.split(':');
    const len = parts.length;

    if (parts[0] === 'guild' && len >= 3) {
        return parseGuildKey(parts, fullKey);
    }

    if (parts[0] === 'giveaway' && len >= 2) {
        return parseGiveawayKey(parts, fullKey);
    }

    if (parts[0] === 'economy' && len >= 2) {
        return { type: 'economy', guildId: parts[1], fullKey, namespace: 'economy' };
    }

    if (parts[0] === 'moderation' && len >= 3) {
        return parseModerationKey(parts, fullKey);
    }

    if (parts[0] === 'reaction_roles' && len >= 2) {
        return { 
            type: 'reaction_role', 
            guildId: parts[1], 
            messageId: parts[2] || null,
            fullKey,
            namespace: 'reaction_roles'
        };
    }

    // Legacy leveling key format: {guildId}:leveling:users:{userId}
    if (len >= 4 && parts[1] === 'leveling' && parts[2] === 'users') {
        return {
            type: 'user_level',
            guildId: parts[0],
            userId: parts[3],
            fullKey,
            namespace: 'leveling'
        };
    }

    // Default fallback
    return { type: 'temp', fullKey, namespace: 'temp', reason: 'unrecognized_format' };
}

/**
 * Parse guild-scoped keys.
 */
function parseGuildKey(parts, fullKey) {
    const guildId = parts[1];
    const scope = parts[2];
    const len = parts.length;

    // Singleton configs (guild:{id}:config)
    if (scope === 'config' && len === 3) {
        return { type: 'guild_config', guildId, fullKey, namespace: 'config' };
    }

    // Birthdays sub-scopes
    if (scope === 'birthdays') {
        if (len === 3) {
            return { type: 'guild_birthdays', guildId, fullKey, namespace: 'birthdays' };
        }
        if (parts[3] === 'left' && len === 4) {
            return { type: 'birthday_left', guildId, fullKey, namespace: 'birthdays' };
        }
        if (parts[3] === 'tracking' && len === 4) {
            return { type: 'birthday_tracking', guildId, fullKey, namespace: 'birthdays' };
        }
    }

    // Giveaways
    if (scope === 'giveaways' && len === 3) {
        return { type: 'guild_giveaways', guildId, fullKey, namespace: 'giveaways' };
    }

    // Welcome config
    if (scope === 'welcome' && len === 3) {
        return { type: 'welcome_config', guildId, fullKey, namespace: 'welcome' };
    }

    // Leveling scope
    if (scope === 'leveling') {
        if (parts[3] === 'config' && len === 4) {
            return { type: 'leveling_config', guildId, fullKey, namespace: 'leveling' };
        }
        if (parts[3] === 'users' && len === 5) {
            return { type: 'user_level', guildId, userId: parts[4], fullKey, namespace: 'leveling' };
        }
        if (len === 3) {
            return { type: 'leveling_data', guildId, fullKey, namespace: 'leveling' };
        }
    }

    // Economy (guild:{id}:economy:{userId})
    if (scope === 'economy' && len === 4) {
        return { type: 'economy', guildId, userId: parts[3], fullKey, namespace: 'economy' };
    }

    // AFK status
    if (scope === 'afk' && len === 4) {
        return { type: 'afk_status', guildId, userId: parts[3], fullKey, namespace: 'afk' };
    }

    // Tickets
    if (scope === 'ticket') {
        if (parts[3] === 'counter' && len === 4) {
            return { type: 'ticket_counter', guildId, fullKey, namespace: 'tickets' };
        }
        if (len === 4) {
            return { type: 'ticket', guildId, channelId: parts[3], fullKey, namespace: 'tickets' };
        }
    }

    // Warnings
    if (scope === 'warnings' && len === 4) {
        return { type: 'warnings', guildId, userId: parts[3], fullKey, namespace: 'moderation' };
    }

    // Usernotes
    if (scope === 'usernotes') {
        if (parts[3] === 'list' && len === 4) {
            return { type: 'usernotes_list', guildId, fullKey, namespace: 'moderation' };
        }
        if (len === 4) {
            return { type: 'usernotes', guildId, userId: parts[3], fullKey, namespace: 'moderation' };
        }
    }

    // Reaction roles
    if (scope === 'reaction_roles' && len === 4) {
        return { type: 'reaction_role', guildId, messageId: parts[3], fullKey, namespace: 'reaction_roles' };
    }

    // Server counters
    if (scope === 'counters' && len === 3) {
        return { type: 'counters', guildId, fullKey, namespace: 'counters' };
    }

    // Applications
    if (scope === 'applications') {
        if (parts[3] === 'roles' && len === 4) {
            return { type: 'application_roles', guildId, fullKey, namespace: 'applications' };
        }
        if (parts[3] === 'settings' && len === 4) {
            return { type: 'application_settings', guildId, fullKey, namespace: 'applications' };
        }
        if (parts[3] === 'users' && len === 5) {
            return { type: 'application_users', guildId, userId: parts[4], fullKey, namespace: 'applications' };
        }
        if (len === 4 && parts[3] !== 'roles' && parts[3] !== 'settings' && parts[3] !== 'users') {
            return { type: 'application', guildId, applicationId: parts[3], fullKey, namespace: 'applications' };
        }
    }

    // Join-to-create
    if (scope === 'jointocreate') {
        if (parts[3] === 'channels' && len === 4) {
            return { type: 'jointocreate_channels', guildId, fullKey, namespace: 'jointocreate' };
        }
        if (len === 3) {
            return { type: 'jointocreate_config', guildId, fullKey, namespace: 'jointocreate' };
        }
    }

    // Invite tracking
    if (scope === 'invite_uses' && len === 4) {
        return { type: 'invite_uses', guildId, inviteCode: parts[3], fullKey, namespace: 'invites' };
    }
    if (scope === 'invites') {
        if (len === 3) {
            return { type: 'invite_tracking', guildId, fullKey, namespace: 'invites' };
        }
        if (len === 4) {
            return { type: 'invite_member', guildId, userId: parts[3], fullKey, namespace: 'invites' };
        }
    }

    // Fake account detection
    if (scope === 'fake_account' && len === 4) {
        return { type: 'fake_account', guildId, userId: parts[3], fullKey, namespace: 'security' };
    }

    // New: AutoMod
    if (scope === 'automod' && len >= 3) {
        if (len === 3) return { type: 'automod_config', guildId, fullKey, namespace: 'automod' };
        return { type: 'automod_rule', guildId, ruleId: parts[3], fullKey, namespace: 'automod' };
    }

    // New: Starboard
    if (scope === 'starboard' && len >= 3) {
        if (len === 3) return { type: 'starboard_config', guildId, fullKey, namespace: 'starboard' };
        return { type: 'starboard_entry', guildId, messageId: parts[3], fullKey, namespace: 'starboard' };
    }

    // New: Custom commands
    if (scope === 'custom_commands' && len >= 3) {
        if (len === 3) return { type: 'custom_commands_list', guildId, fullKey, namespace: 'custom_commands' };
        return { type: 'custom_command', guildId, commandName: parts[3], fullKey, namespace: 'custom_commands' };
    }

    // New: Mute/Timeout
    if (scope === 'mutes' && len === 4) {
        return { type: 'mute', guildId, userId: parts[3], fullKey, namespace: 'moderation' };
    }

    // New: Lockdown
    if (scope === 'lockdown' && len >= 3) {
        if (len === 3) return { type: 'lockdown_config', guildId, fullKey, namespace: 'moderation' };
        return { type: 'lockdown_channel', guildId, channelId: parts[3], fullKey, namespace: 'moderation' };
    }

    // New: Premium
    if (scope === 'premium' && len === 3) {
        return { type: 'premium', guildId, fullKey, namespace: 'premium' };
    }

    // New: Logs
    if (scope === 'logs' && len >= 3) {
        if (len === 3) return { type: 'logs_config', guildId, fullKey, namespace: 'logs' };
        return { type: 'log_entry', guildId, logId: parts[3], fullKey, namespace: 'logs' };
    }

    // Unrecognized guild scope → temp fallback with warning context
    return { 
        type: 'temp', 
        guildId, 
        scope, 
        fullKey, 
        namespace: 'temp',
        reason: 'unrecognized_guild_scope'
    };
}

/**
 * Parse giveaway keys.
 */
function parseGiveawayKey(parts, fullKey) {
    if (parts[1] === 'lock' && parts[2]) {
        return { type: 'giveaway_lock', messageId: parts[2], fullKey, namespace: 'giveaways' };
    }
    if (parts[1] && parts[2]) {
        return { 
            type: 'giveaway_entry', 
            userId: parts[1], 
            giveawayId: parts[2], 
            fullKey,
            namespace: 'giveaways'
        };
    }
    return { type: 'temp', fullKey, namespace: 'temp', reason: 'invalid_giveaway_format' };
}

/**
 * Parse moderation keys (non-guild scoped).
 */
function parseModerationKey(parts, fullKey) {
    if (parts[1] === 'warnings' && parts[2]) {
        return { type: 'warnings', guildId: parts[2], userId: parts[3] || null, fullKey, namespace: 'moderation' };
    }
    if (parts[1] === 'cases' && parts[2]) {
        return { type: 'moderation_case', caseId: parts[2], fullKey, namespace: 'moderation' };
    }
    return { type: 'temp', fullKey, namespace: 'temp', reason: 'unrecognized_moderation_scope' };
}

// ─── Key Builder (Inverse of parseKey) ────────────────────────────────────────

/**
 * Reconstruct a storage key from metadata.
 * @param {Object} meta - Key metadata
 * @returns {string} Canonical key
 */
export function buildKey(meta) {
    if (!meta || !meta.type) {
        throw new TypeError('Metadata with type is required');
    }

    switch (meta.type) {
        case 'guild_config':
            return getGuildConfigKey(meta.guildId);
        case 'guild_birthdays':
            return getGuildBirthdaysKey(meta.guildId);
        case 'birthday_left':
            return `guild:${meta.guildId}:birthdays:left`;
        case 'birthday_tracking':
            return `guild:${meta.guildId}:birthdays:tracking`;
        case 'welcome_config':
            return getWelcomeConfigKey(meta.guildId);
        case 'leveling_config':
            return `${getLevelingKey(meta.guildId)}:config`;
        case 'leveling_data':
            return getLevelingKey(meta.guildId);
        case 'user_level':
            return `guild:${meta.guildId}:leveling:users:${meta.userId}`;
        case 'economy':
            return `guild:${meta.guildId}:economy:${meta.userId}`;
        case 'afk_status':
            return `guild:${meta.guildId}:afk:${meta.userId}`;
        case 'ticket':
            return `guild:${meta.guildId}:ticket:${meta.channelId}`;
        case 'ticket_counter':
            return getTicketCounterKey(meta.guildId);
        case 'warnings':
            return `guild:${meta.guildId}:warnings:${meta.userId}`;
        case 'usernotes':
            return `guild:${meta.guildId}:usernotes:${meta.userId}`;
        case 'usernotes_list':
            return `guild:${meta.guildId}:usernotes:list`;
        case 'reaction_role':
            return `guild:${meta.guildId}:reaction_roles:${meta.messageId}`;
        case 'counters':
            return getServerCountersKey(meta.guildId);
        case 'application':
            return `guild:${meta.guildId}:applications:${meta.applicationId}`;
        case 'application_roles':
            return `guild:${meta.guildId}:applications:roles`;
        case 'application_settings':
            return `guild:${meta.guildId}:applications:settings`;
        case 'application_users':
            return `guild:${meta.guildId}:applications:users:${meta.userId}`;
        case 'jointocreate_config':
            return `guild:${meta.guildId}:jointocreate`;
        case 'jointocreate_channels':
            return `guild:${meta.guildId}:jointocreate:channels`;
        case 'invite_uses':
            return `guild:${meta.guildId}:invite_uses:${meta.inviteCode}`;
        case 'invite_tracking':
            return `guild:${meta.guildId}:invites`;
        case 'invite_member':
            return `guild:${meta.guildId}:invites:${meta.userId}`;
        case 'fake_account':
            return `guild:${meta.guildId}:fake_account:${meta.userId}`;
        case 'giveaway_lock':
            return `giveaway:lock:${meta.messageId}`;
        case 'giveaway_entry':
            return `giveaway:${meta.userId}:${meta.giveawayId}`;
        case 'temp':
            return meta.fullKey || `temp:${Math.random().toString(36).slice(2)}`;
        case 'cache':
            return meta.fullKey || `cache:${Math.random().toString(36).slice(2)}`;
        default:
            throw new TitanBotError(`Unknown key type: ${meta.type}`, ErrorTypes.VALIDATION);
    }
}

// ─── Structured List Plans ───────────────────────────────────────────────────

const PLAN_BUILDERS = new Map();

// Register plan builders for extensibility
function registerPlanBuilder(pattern, builder) {
    PLAN_BUILDERS.set(pattern, builder);
}

// Economy
registerPlanBuilder(PATTERNS.ECONOMY, (match, tables) => ({
    queries: [{
        sql: `SELECT user_id FROM ${tables.economy} WHERE guild_id = $1`,
        params: [match[1]],
        mapKey: (row) => `guild:${match[1]}:economy:${row.user_id}`,
    }]
}));

registerPlanBuilder(PATTERNS.GUILD_ECONOMY, (match, tables) => ({
    queries: [{
        sql: `SELECT user_id FROM ${tables.economy} WHERE guild_id = $1`,
        params: [match[1]],
        mapKey: (row) => `guild:${match[1]}:economy:${row.user_id}`,
    }]
}));

// User levels
registerPlanBuilder(PATTERNS.USER_LEVELS_SHORT, (match, tables) => ({
    queries: [{
        sql: `SELECT user_id FROM ${tables.user_levels} WHERE guild_id = $1`,
        params: [match[1]],
        mapKey: (row) => `guild:${match[1]}:leveling:users:${row.user_id}`,
    }]
}));

registerPlanBuilder(PATTERNS.USER_LEVELS_GUILD, (match, tables) => ({
    queries: [{
        sql: `SELECT user_id FROM ${tables.user_levels} WHERE guild_id = $1`,
        params: [match[1]],
        mapKey: (row) => `guild:${match[1]}:leveling:users:${row.user_id}`,
    }]
}));

// Tickets
registerPlanBuilder(PATTERNS.TICKETS, (match, tables) => ({
    queries: [{
        sql: `SELECT channel_id FROM ${tables.tickets} WHERE guild_id = $1`,
        params: [match[1]],
        mapKey: (row) => `guild:${match[1]}:ticket:${row.channel_id}`,
    }],
    staticKeys: [getTicketCounterKey(match[1])]
}));

// Warnings
registerPlanBuilder(PATTERNS.WARNINGS_MOD, (match) => ({
    tempPrefixes: [`moderation:warnings:${match[1]}:`, getWarningsPrefix(match[1])]
}));

registerPlanBuilder(PATTERNS.WARNINGS_GUILD, (match) => ({
    tempPrefixes: [getWarningsPrefix(match[1]), `moderation:warnings:${match[1]}:`]
}));

// Reaction roles
registerPlanBuilder(PATTERNS.REACTION_ROLES_SHORT, (match) => ({
    tempPrefixes: [`reaction_roles:${match[1]}:`, getReactionRolesPrefix(match[1])]
}));

registerPlanBuilder(PATTERNS.REACTION_ROLES_GUILD, (match) => ({
    tempPrefixes: [getReactionRolesPrefix(match[1]), `reaction_roles:${match[1]}:`]
}));

// Applications
registerPlanBuilder(PATTERNS.APPLICATIONS, (match) => ({
    tempPrefixes: [getApplicationsPrefix(match[1])]
}));

// Guild root — comprehensive scan
registerPlanBuilder(PATTERNS.GUILD_ROOT, (match, tables) => {
    const guildId = match[1];
    const staticKeys = GUILD_SCOPED_SINGLETONS.map(s => `guild:${guildId}:${s}`);
    
    return {
        queries: [
            {
                sql: `SELECT user_id FROM ${tables.economy} WHERE guild_id = $1`,
                params: [guildId],
                mapKey: (row) => `guild:${guildId}:economy:${row.user_id}`,
            },
            {
                sql: `SELECT user_id FROM ${tables.user_levels} WHERE guild_id = $1`,
                params: [guildId],
                mapKey: (row) => `guild:${guildId}:leveling:users:${row.user_id}`,
            },
            {
                sql: `SELECT channel_id FROM ${tables.tickets} WHERE guild_id = $1`,
                params: [guildId],
                mapKey: (row) => `guild:${guildId}:ticket:${row.channel_id}`,
            }
        ],
        staticKeys: [
            ...staticKeys,
            getGuildConfigKey(guildId),
            getGuildBirthdaysKey(guildId),
            getWelcomeConfigKey(guildId),
            getLevelingKey(guildId),
            getServerCountersKey(guildId),
            getTicketCounterKey(guildId),
        ],
        tempPrefixes: [
            getApplicationsPrefix(guildId),
            getWarningsPrefix(guildId),
            `moderation:warnings:${guildId}:`,
            getReactionRolesPrefix(guildId),
            `reaction_roles:${guildId}:`,
            getEconomyPrefix(guildId),
            `economy:${guildId}:`,
            getUserLevelPrefix(guildId),
            `${guildId}:leveling:users:`,
        ]
    };
});

/**
 * Build PostgreSQL list queries for structured tables.
 * @param {string} prefix - Key prefix to list
 * @param {Object} tables - Table name mappings
 * @returns {ListPlan} Query plan with SQL, params, and temp prefixes
 */
export function getStructuredListPlan(prefix, tables) {
    if (!prefix || typeof prefix !== 'string') {
        throw new TypeError('Prefix must be a non-empty string');
    }
    if (!tables || typeof tables !== 'object') {
        throw new TypeError('Tables mapping is required');
    }

    const normalizedPrefix = canonicalizeKey(prefix.endsWith(':') ? prefix : `${prefix}:`);

    // Try registered patterns
    for (const [pattern, builder] of PLAN_BUILDERS) {
        const match = normalizedPrefix.match(pattern);
        if (match) {
            return builder(match, tables);
        }
    }

    // Default: no structured plan, rely on temp/cache scan
    return { queries: [], staticKeys: [], tempPrefixes: [normalizedPrefix] };
}

// ─── Validation & Utilities ───────────────────────────────────────────────────

/**
 * Validate that a key matches expected format for its type.
 */
export function validateKey(key, expectedType = null) {
    try {
        const meta = parseKey(key);
        if (expectedType && meta.type !== expectedType) {
            return { valid: false, error: `Expected type ${expectedType}, got ${meta.type}` };
        }
        if (meta.type === 'temp' && meta.reason === 'unrecognized_format') {
            return { valid: false, error: 'Unrecognized key format' };
        }
        return { valid: true, meta };
    } catch (err) {
        return { valid: false, error: err.message };
    }
}

/**
 * Get all supported key types.
 */
export function getSupportedTypes() {
    return [
        'temp', 'cache', 'guild_config', 'guild_birthdays', 'birthday_left',
        'birthday_tracking', 'guild_giveaways', 'welcome_config', 'leveling_config',
        'leveling_data', 'user_level', 'economy', 'afk_status', 'ticket',
        'ticket_counter', 'warnings', 'usernotes', 'usernotes_list', 'reaction_role',
        'counters', 'application', 'application_roles', 'application_settings',
        'application_users', 'jointocreate_config', 'jointocreate_channels',
        'invite_uses', 'invite_member', 'invite_tracking', 'fake_account',
        'giveaway_lock', 'giveaway_entry', 'automod_config', 'automod_rule',
        'starboard_config', 'starboard_entry', 'custom_commands_list', 'custom_command',
        'mute', 'lockdown_config', 'lockdown_channel', 'premium', 'logs_config', 'log_entry'
    ];
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export default {
    isTempBackedType,
    isGuildScopedType,
    parseKey,
    buildKey,
    getStructuredListPlan,
    validateKey,
    getSupportedTypes,
    TEMP_BACKED_TYPES,
    GUILD_SCOPED_SINGLETONS,
};
