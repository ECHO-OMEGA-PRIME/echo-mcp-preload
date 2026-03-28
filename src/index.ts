/**
 * ECHO OMEGA PRIME - Cloud MCP Server v2.0.0
 * Remote MCP Server on Cloudflare Workers (Authless)
 * 13 Tools: preload_context, rag_search, log_outcome, memory_store,
 *   memory_search, association_walk, knowledge_search, knowledge_mastery,
 *   graph_query, ekm_query, system_health, rag_ask, brain_broadcast
 * 
 * URL: echo-mcp-preload.bmcii1976.workers.dev/sse (SSE)
 *      echo-mcp-preload.bmcii1976.workers.dev/mcp (Streamable HTTP)
 * 
 * Authority: 11.0 SOVEREIGN
 * #mcp #preload #session #context #claude-desktop #rag #memory
 */

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Env = {
  MCP: DurableObjectNamespace;
};

export class EchoMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "echo-omega-prime",
    version: "2.0.0",
  });

  private readonly RAG_URL = "https://echo-rag-orchestrator.bmcii1976.workers.dev";
  private readonly CORTEX_URL = "https://echo-memory-cortex.bmcii1976.workers.dev";  private readonly FORGE_URL = "https://echo-knowledge-forge.bmcii1976.workers.dev";
  private readonly GRAPH_URL = "https://graph-query-engine.bmcii1976.workers.dev";
  private readonly EKM_URL = "https://ekm-query-engine.bmcii1976.workers.dev";
  private readonly BRAIN_URL = "https://echo-shared-brain.bmcii1976.workers.dev";

  async init() {
    // ═══ TOOL 1: preload_context ═══
    this.server.tool(
      "preload_context",
      "Load relevant memories, knowledge, entities, and graph data for session context. Call at conversation start to prime Claude with Commander's knowledge base.",
      {
        first_message: z.string().describe("The user's first message or conversation topic"),
        instance_id: z.string().default("CLAUDE_PRIMARY").describe("Instance: CLAUDE_PRIMARY or CLAUDE_SECONDARY"),
        topK: z.number().default(15).describe("Results per source to retrieve"),
      },
      async ({ first_message, instance_id, topK }) => {
        try {
          const [ragResult, cortexResult] = await Promise.allSettled([
            fetch(`${this.RAG_URL}/rag/query`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ query: first_message, topK, sources: ["all"] }),
            }).then(r => r.json()),
            fetch(`${this.CORTEX_URL}/preload`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ context: first_message, instance_id }),
            }).then(r => r.json()),
          ]);          const ragData = ragResult.status === "fulfilled" ? ragResult.value : { error: "RAG unavailable" };
          const cortexData = cortexResult.status === "fulfilled" ? cortexResult.value : { error: "Cortex unavailable" };
          const preload = {
            instance_id, timestamp: new Date().toISOString(), query: first_message,
            rag_results: (ragData as any).results || [], rag_stats: (ragData as any).stats || {},
            cortex_preload: cortexData,
            summary: `Loaded ${(ragData as any).results?.length || 0} RAG results + cortex preload`,
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(preload, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, tool: "preload_context" }) }] };
        }
      }
    );

    // ═══ TOOL 2: rag_search ═══
    this.server.tool(
      "rag_search",
      "Search ALL ECHO systems: Memory Cortex (8,200+ memories), Knowledge Forge (75,000+ chunks), EKM, Graph Engine (28,000+ nodes). Returns ranked results.",
      {
        query: z.string().describe("Natural language search query"),
        topK: z.number().default(10).describe("Number of results"),
        sources: z.array(z.enum(["memory", "knowledge", "graph", "ekm", "all"])).default(["all"]).describe("Data sources to query"),
        memory_type: z.string().optional().describe("Filter: decision, episodic, semantic, procedural, fact, emotional"),
        category: z.string().optional().describe("Knowledge category filter"),
      },      async ({ query, topK, sources, memory_type, category }) => {
        try {
          const body: any = { query, topK, sources };
          if (memory_type || category) {
            body.filters = {};
            if (memory_type) body.filters.memory_type = memory_type;
            if (category) body.filters.category = category;
          }
          const response = await fetch(`${this.RAG_URL}/rag/query`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          });
          const data = await response.json() as any;
          return { content: [{ type: "text" as const, text: JSON.stringify({ query, result_count: data.results?.length || 0, stats: data.stats || {}, results: data.results || [] }, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, tool: "rag_search" }) }] };
        }
      }
    );

    // ═══ TOOL 3: log_outcome ═══
    this.server.tool(
      "log_outcome",
      "Log whether a recalled memory was helpful (success), needed correction, or was neutral. Reinforces good memories.",
      {
        memory_uid: z.string().describe("UID of the memory to reinforce"),
        outcome: z.enum(["success", "correction", "neutral"]).describe("Was the memory helpful?"),
        conversation_id: z.string().optional().describe("Conversation ID"),
        context: z.string().optional().describe("Additional context"),
      },      async ({ memory_uid, outcome, conversation_id, context }) => {
        try {
          const response = await fetch(`${this.CORTEX_URL}/outcome/log`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ memory_uid, outcome, conversation_id, context }),
          });
          const data = await response.json();
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, tool: "log_outcome" }) }] };
        }
      }
    );

    // ═══ TOOL 4: memory_store ═══
    this.server.tool(
      "memory_store",
      "Store a new memory in ECHO Memory Cortex. Auto-embedded and indexed for semantic search.",
      {
        content: z.string().describe("Memory content to store"),
        memory_type: z.enum(["decision", "episodic", "semantic", "procedural", "fact", "emotional"]).default("semantic"),
        tags: z.string().optional().describe("Comma-separated tags"),
        source: z.string().default("mcp_tool").describe("Source of the memory"),
        strength: z.number().default(3.0).describe("Initial strength 1-10"),
      },
      async ({ content, memory_type, tags, source, strength }) => {
        try {
          const response = await fetch(`${this.CORTEX_URL}/memories`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content, type: memory_type, tags: tags || "", source, strength }),
          });          const data = await response.json();
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, tool: "memory_store" }) }] };
        }
      }
    );

    // ═══ TOOL 5: memory_search ═══
    this.server.tool(
      "memory_search",
      "Vector search across 8,200+ memories using Vectorize embeddings. More accurate than keyword search.",
      {
        query: z.string().describe("Natural language search query"),
        topK: z.number().default(20).describe("Number of results"),
        memory_type: z.string().optional().describe("Filter: decision, episodic, semantic, procedural, fact, emotional"),
      },
      async ({ query, topK, memory_type }) => {
        try {
          const body: any = { query, topK };
          if (memory_type) body.filter = { type: memory_type };
          const response = await fetch(`${this.CORTEX_URL}/vectorize/search`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          });
          const data = await response.json() as any;
          return { content: [{ type: "text" as const, text: JSON.stringify({ query, count: data.count || data.results?.length || 0, results: (data.results || []).slice(0, topK) }, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, tool: "memory_search" }) }] };
        }
      }
    );
    // ═══ TOOL 6: association_walk ═══
    this.server.tool(
      "association_walk",
      "Walk associative memory chains from a starting memory. Finds related memories through semantic similarity, shared tags, causal/temporal links.",
      {
        uid: z.string().describe("Starting memory UID"),
        depth: z.number().default(2).describe("Hops to traverse (1-3)"),
        min_weight: z.number().default(0.3).describe("Min association weight 0.0-1.0"),
      },
      async ({ uid, depth, min_weight }) => {
        try {
          const response = await fetch(`${this.CORTEX_URL}/associations/walk?uid=${encodeURIComponent(uid)}&depth=${depth}&min_weight=${min_weight}`);
          const data = await response.json();
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, tool: "association_walk" }) }] };
        }
      }
    );

    // ═══ TOOL 7: knowledge_search ═══
    this.server.tool(
      "knowledge_search",
      "Search Knowledge Forge: 75,000+ doc chunks, 252 categories, 96 mastery bundles. Technical docs, guides, reference material.",
      {
        query: z.string().describe("Search query"),
        category: z.string().optional().describe("Category filter"),
        limit: z.number().default(10).describe("Max results"),
      },      async ({ query, category, limit }) => {
        try {
          const params = new URLSearchParams({ query, limit: String(limit) });
          if (category) params.set("category", category);
          const response = await fetch(`${this.FORGE_URL}/search?${params}`);
          const data = await response.json();
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, tool: "knowledge_search" }) }] };
        }
      }
    );

    // ═══ TOOL 8: knowledge_mastery ═══
    this.server.tool(
      "knowledge_mastery",
      "Get compiled mastery bundle - ALL docs on a topic merged into one briefing. 96 bundles available.",
      { topic: z.string().describe("Topic slug: e.g. 'elevenlabs', 'react', 'cloudflare-workers'") },
      async ({ topic }) => {
        try {
          const response = await fetch(`${this.FORGE_URL}/mastery/${encodeURIComponent(topic)}`);
          const data = await response.json();
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, tool: "knowledge_mastery" }) }] };
        }
      }
    );
    // ═══ TOOL 9: graph_query ═══
    this.server.tool(
      "graph_query",
      "Query knowledge graph: 28,305 nodes, 22,708 edges. Find relationships, connections, entity context.",
      { query: z.string().describe("Search query for graph nodes"), limit: z.number().default(10) },
      async ({ query, limit }) => {
        try {
          const response = await fetch(`${this.GRAPH_URL}/search`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, limit }),
          });
          const data = await response.json();
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, tool: "graph_query" }) }] };
        }
      }
    );

    // ═══ TOOL 10: ekm_query ═══
    this.server.tool(
      "ekm_query",
      "Query Entity Knowledge Map system. Detailed entity profiles, attributes, knowledge maps.",
      { query: z.string().describe("Entity or topic to search"), limit: z.number().default(10) },
      async ({ query, limit }) => {
        try {
          const response = await fetch(`${this.EKM_URL}/search`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, limit }),
          });          const data = await response.json();
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, tool: "ekm_query" }) }] };
        }
      }
    );

    // ═══ TOOL 11: system_health ═══
    this.server.tool(
      "system_health",
      "Check health of ALL ECHO OMEGA PRIME cloud systems: RAG, Memory Cortex, Knowledge Forge, Graph, EKM, Shared Brain.",
      {},
      async () => {
        try {
          const services = [
            { name: "RAG Orchestrator", url: `${this.RAG_URL}/health` },
            { name: "Memory Cortex", url: `${this.CORTEX_URL}/health` },
            { name: "Knowledge Forge", url: `${this.FORGE_URL}/health` },
            { name: "Graph Engine", url: `${this.GRAPH_URL}/health` },
            { name: "EKM Engine", url: `${this.EKM_URL}/health` },
            { name: "Shared Brain", url: `${this.BRAIN_URL}/health` },
          ];
          const results = await Promise.allSettled(
            services.map(async (svc) => {
              const start = Date.now();
              const resp = await fetch(svc.url);
              const data = await resp.json();
              return { ...svc, status: "ok", latency_ms: Date.now() - start, data };
            })
          );          const health = results.map((r, i) => {
            if (r.status === "fulfilled") return r.value;
            return { ...services[i], status: "error", error: (r.reason as Error).message };
          });
          return { content: [{ type: "text" as const, text: JSON.stringify({
            system: "ECHO OMEGA PRIME", authority: "11.0 SOVEREIGN",
            timestamp: new Date().toISOString(), services: health,
          }, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, tool: "system_health" }) }] };
        }
      }
    );

    // ═══ TOOL 12: rag_ask ═══
    this.server.tool(
      "rag_ask",
      "Ask a question and get AI-generated answer using full RAG context from all ECHO systems. Workers AI synthesizes answer from docs + memories.",
      { question: z.string().describe("The question to answer") },
      async ({ question }) => {
        try {
          const response = await fetch(`${this.RAG_URL}/rag/ask`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question }),
          });
          const data = await response.json();
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, tool: "rag_ask" }) }] };
        }
      }
    );
    // ═══ TOOL 13: brain_broadcast ═══
    this.server.tool(
      "brain_broadcast",
      "Send broadcast to ALL AI instances via Shared Brain. Coordination across CLAUDE_PRIMARY, CLAUDE_SECONDARY, Claude Code agents.",
      { message: z.string().describe("Message to broadcast") },
      async ({ message }) => {
        try {
          const response = await fetch(`${this.BRAIN_URL}/broadcast`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: message }),
          });
          const data = await response.json();
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: error.message, tool: "brain_broadcast" }) }] };
        }
      }
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// Worker fetch handler - Routes SSE + Streamable HTTP + health
// ═══════════════════════════════════════════════════════════════

// Security headers
const SEC_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};
function withSecHeaders(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(SEC_HEADERS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // Health endpoint
    if (url.pathname === "/health" || url.pathname === "/") {
      return Response.json({
        service: "echo-mcp-preload",
        version: "2.0.0",
        status: "operational",
        authority: "11.0 SOVEREIGN",
        description: "ECHO OMEGA PRIME - Cloud MCP Server",
        transport: { sse: "/sse", streamable_http: "/sse" },
        tools: [
          "preload_context", "rag_search", "log_outcome", "memory_store",
          "memory_search", "association_walk", "knowledge_search", "knowledge_mastery",
          "graph_query", "ekm_query", "system_health", "rag_ask", "brain_broadcast",
        ],
        backends: [
          "echo-rag-orchestrator", "echo-memory-cortex", "echo-knowledge-forge",
          "graph-query-engine", "ekm-query-engine", "echo-shared-brain",
        ],
        timestamp: new Date().toISOString(),
      });
    }

    // MCP transport via McpAgent.mount() - handles both SSE and Streamable HTTP
    const mcpHandler = EchoMCP.mount("/sse", { binding: "MCP" });
    const mcpResponse = await mcpHandler.fetch(request, env as any, ctx);
    if (mcpResponse) return mcpResponse;

    return Response.json(
      { error: "Not found", endpoints: ["/health", "/sse", "/mcp"] },
      { status: 404 }
    );
  },
};