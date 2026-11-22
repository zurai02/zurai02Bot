import { logger } from '../utils/logger.js';
import lavalinkConfig from '../config/music/lavalink.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_TIERS = {
  PRIMARY: 'primary',
  FALLBACK: 'fallback',
};

const CONNECT_TIMEOUT_MS = 5_000;

// ─── LavalinkNodeManager ──────────────────────────────────────────────────────

export class LavalinkNodeManager {
  constructor() {
    this._nodes = [];
    this._started = false;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────────

  async start() {
    if (this._started) return;

    const rawNodes = lavalinkConfig.nodes ?? [];

    if (!rawNodes.length) {
      logger.warn('No Lavalink nodes configured — music features will be disabled', {
        event: 'lavalink.no_nodes',
      });
      this._started = true;
      return;
    }

    this._nodes = rawNodes.map((node, index) => ({
      name: node.name ?? `node-${index}`,
      host: node.host,
      port: node.port,
      password: node.password,
      secure: node.secure ?? false,
      tier: node.tier ?? (index === 0 ? NODE_TIERS.PRIMARY : NODE_TIERS.FALLBACK),
      available: false,
      latency: null,
      lastChecked: null,
    }));

    logger.info(`Checking ${this._nodes.length} Lavalink node(s)...`, { event: 'lavalink.start' });

    await Promise.allSettled(this._nodes.map((node) => this._pingNode(node)));

    const available = this._nodes.filter((n) => n.available);
    logger.info(`Lavalink: ${available.length}/${this._nodes.length} node(s) reachable`, {
      event: 'lavalink.start.done',
      available: available.map((n) => n.name),
    });

    this._started = true;
  }

  async stop() {
    this._nodes = [];
    this._started = false;
    logger.info('LavalinkNodeManager stopped', { event: 'lavalink.stop' });
  }

  // ─── Node Selection ───────────────────────────────────────────────────────────

  /**
   * Returns the best available node (lowest latency primary first, then fallback),
   * or null if none are reachable.
   * @returns {{ name: string, tier: string } | null}
   */
  getBestNode() {
    const available = this._nodes.filter((n) => n.available);
    if (!available.length) return null;

    // Prefer primary tier, then sort by latency
    const sorted = [...available].sort((a, b) => {
      if (a.tier === NODE_TIERS.PRIMARY && b.tier !== NODE_TIERS.PRIMARY) return -1;
      if (b.tier === NODE_TIERS.PRIMARY && a.tier !== NODE_TIERS.PRIMARY) return 1;
      return (a.latency ?? Infinity) - (b.latency ?? Infinity);
    });

    const best = sorted[0];
    return { name: best.name, tier: best.tier };
  }

  // ─── Status ───────────────────────────────────────────────────────────────────

  getStatus() {
    const available = this._nodes.filter((n) => n.available);
    return {
      started: this._started,
      totalNodes: this._nodes.length,
      availableNodes: available.length,
      nodes: this._nodes.map((n) => ({
        name: n.name,
        tier: n.tier,
        available: n.available,
        latency: n.latency,
        lastChecked: n.lastChecked,
      })),
    };
  }

  // ─── Internal ─────────────────────────────────────────────────────────────────

  async _pingNode(node) {
    const protocol = node.secure ? 'https' : 'http';
    const url = `${protocol}://${node.host}:${node.port}/version`;

    const start = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

      const res = await fetch(url, {
        headers: { Authorization: node.password },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      node.latency = Date.now() - start;
      node.available = res.ok || res.status === 200;
      node.lastChecked = new Date().toISOString();

      if (node.available) {
        logger.info(`Lavalink node reachable: ${node.name} (${node.latency}ms)`, {
          event: 'lavalink.node.ok',
          node: node.name,
          latency: node.latency,
        });
      } else {
        logger.warn(`Lavalink node returned ${res.status}: ${node.name}`, {
          event: 'lavalink.node.bad_status',
          node: node.name,
          status: res.status,
        });
      }
    } catch (error) {
      node.available = false;
      node.latency = null;
      node.lastChecked = new Date().toISOString();

      const reason = error.name === 'AbortError' ? 'timeout' : error.message;
      logger.warn(`Lavalink node unreachable: ${node.name} (${reason})`, {
        event: 'lavalink.node.unreachable',
        node: node.name,
        reason,
      });
    }
  }
}
