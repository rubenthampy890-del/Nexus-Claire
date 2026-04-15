/**
 * Nexus Claire: Web Search Tool
 * 
 * Gives Nexus "Digital Eyes" on the live web.
 * Uses DuckDuckGo Instant Answer API (free, no key required)
 * + direct URL content extraction via fetch.
 */

import { toolRegistry, type ToolDefinition } from "../tool-registry";

interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

interface WebSearchResponse {
    results: SearchResult[];
    answer?: string;
    query: string;
}

/**
 * Search the web using DuckDuckGo Instant Answer API
 */
async function searchWeb(query: string): Promise<WebSearchResponse> {
    const encodedQuery = encodeURIComponent(query);
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`;

    try {
        const response = await fetch(ddgUrl, {
            headers: { 'User-Agent': 'NexusClaire/4.0 (Autonomous Agent)' },
            signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) throw new Error(`DDG HTTP ${response.status}`);
        const data: any = await response.json();

        const results: SearchResult[] = [];

        if (data.RelatedTopics) {
            for (const topic of data.RelatedTopics.slice(0, 5)) {
                if (topic.Text && topic.FirstURL) {
                    results.push({ title: topic.Text.substring(0, 80), url: topic.FirstURL, snippet: topic.Text });
                }
                if (topic.Topics) {
                    for (const sub of topic.Topics.slice(0, 2)) {
                        if (sub.Text && sub.FirstURL) {
                            results.push({ title: sub.Text.substring(0, 80), url: sub.FirstURL, snippet: sub.Text });
                        }
                    }
                }
            }
        }

        return { results, answer: data.AbstractText || data.Answer || undefined, query };
    } catch (err: any) {
        console.error('[WEB] DuckDuckGo search failed:', err.message);
        return { results: [], query };
    }
}

/**
 * Fetch and extract text content from a URL
 */
async function fetchURL(url: string): Promise<string> {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();

        const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        return text.substring(0, 3000);
    } catch (err: any) {
        return `Error fetching URL: ${err.message}`;
    }
}

const webTools: ToolDefinition[] = [
    {
        name: 'web.search',
        description: 'Search the web for real-time information. Returns titles and snippets.',
        category: 'intelligence',
        parameters: {
            query: { type: 'string', description: 'The search query', required: true }
        },
        execute: async (params) => {
            const query = (params as any).query || String(params);
            console.log(`[WEB] Searching: "${query}"`);
            const results = await searchWeb(query);

            if (results.answer) {
                return `**Answer**: ${results.answer}\n\n**Sources**:\n${results.results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`).join('\n')}`;
            }
            if (results.results.length === 0) {
                return `No results found for "${query}". Try rephrasing.`;
            }
            return `**Search Results for "${query}"**:\n${results.results.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.url}`).join('\n\n')}`;
        }
    },
    {
        name: 'web.read',
        description: 'Fetch and read the text content of a web page URL.',
        category: 'intelligence',
        parameters: {
            url: { type: 'string', description: 'The URL to read', required: true }
        },
        execute: async (params) => {
            const url = (params as any).url || String(params);
            console.log(`[WEB] Reading: ${url}`);
            return await fetchURL(url) || 'No content extracted.';
        }
    }
];

export function registerWebTools() {
    webTools.forEach(tool => toolRegistry.register(tool));
    console.log('[WEB] Web Search & Reader tools registered.');
}

export { searchWeb, fetchURL };
