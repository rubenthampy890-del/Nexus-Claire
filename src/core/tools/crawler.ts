/**
 * ╔══════════════════════════════════════════════════════╗
 * ║       NEXUS CLAIRE — DEEP RECURSIVE CRAWLER v1.0     ║
 * ║       Phase 58: Digital Sovereign                     ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * Unlike web.read (which fetches a single page), web.crawl
 * follows interesting links up to N levels deep, extracting
 * text, metadata, and file references from each page.
 * This allows Nexus to autonomously traverse entire websites.
 */

import { toolRegistry, type ToolDefinition } from "../tool-registry";

interface CrawlResult {
    url: string;
    title: string;
    text: string;
    links: string[];
    depth: number;
}

/**
 * Recursively crawl a URL, following interesting links up to maxDepth levels.
 */
async function crawlDeep(
    startUrl: string,
    maxDepth: number = 2,
    maxPages: number = 10,
    keywords: string[] = []
): Promise<CrawlResult[]> {
    const visited = new Set<string>();
    const results: CrawlResult[] = [];
    const queue: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }];

    while (queue.length > 0 && results.length < maxPages) {
        const current = queue.shift();
        if (!current || !current.url) break;

        const normalizedUrl = current.url.split('#')[0]?.split('?')[0] || current.url;
        if (visited.has(normalizedUrl)) continue;
        visited.add(normalizedUrl);

        try {
            console.log(`[CRAWLER] Depth ${current.depth}/${maxDepth} → ${current.url}`);

            const response = await fetch(current.url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9'
                },
                signal: AbortSignal.timeout(15000),
                redirect: 'follow'
            });

            if (!response.ok) continue;
            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('text/html') && !contentType.includes('text/plain')) continue;

            const html = await response.text();

            // Extract title
            const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            const title = titleMatch?.[1]?.trim() || 'Untitled';

            // Extract clean text
            const text = html
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
                .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
                .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 15000);

            // Extract all links
            const linkRegex = /href=["'](https?:\/\/[^"']+)["']/gi;
            const extractedLinks: string[] = [];
            let linkMatch: RegExpExecArray | null;
            while ((linkMatch = linkRegex.exec(html)) !== null) {
                if (linkMatch[1]) extractedLinks.push(linkMatch[1]);
            }

            // Also extract relative links and resolve them
            const relLinkRegex = /href=["'](\/[^"']+)["']/gi;
            const baseUrl = new URL(current.url);
            while ((linkMatch = relLinkRegex.exec(html)) !== null) {
                try {
                    if (linkMatch[1]) extractedLinks.push(new URL(linkMatch[1], baseUrl.origin).toString());
                } catch { }
            }

            // Deduplicate
            const uniqueLinks = [...new Set(extractedLinks)];

            results.push({
                url: current.url,
                title,
                text,
                links: uniqueLinks.slice(0, 20),
                depth: current.depth
            });

            // Queue deeper links if within depth limit
            if (current.depth < maxDepth) {
                // Prioritize links matching keywords or same-domain links
                const scoredLinks = uniqueLinks
                    .filter(link => {
                        // Skip common junk
                        if (link.includes('login') || link.includes('signup') || link.includes('ads')) return false;
                        if (link.endsWith('.css') || link.endsWith('.js') || link.endsWith('.png') || link.endsWith('.jpg')) return false;
                        return true;
                    })
                    .map(link => {
                        let score = 0;
                        // Same domain = higher priority
                        try { if (new URL(link).hostname === baseUrl.hostname) score += 3; } catch { }
                        // Keyword match = highest priority
                        if (keywords.length > 0) {
                            const linkLower = link.toLowerCase();
                            for (const kw of keywords) {
                                if (linkLower.includes(kw.toLowerCase())) score += 5;
                            }
                        }
                        // Interesting file types
                        if (link.endsWith('.pdf') || link.endsWith('.csv') || link.endsWith('.json')) score += 4;
                        // Deep paths are often more valuable
                        if ((link.match(/\//g) || []).length > 4) score += 2;
                        return { link, score };
                    })
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 5); // Follow top 5 most interesting links per page

                for (const { link } of scoredLinks) {
                    if (!visited.has((link.split('#')[0]?.split('?')[0]) || link)) {
                        queue.push({ url: link, depth: current.depth + 1 });
                    }
                }
            }
        } catch (err: any) {
            console.warn(`[CRAWLER] Failed to fetch ${current.url}: ${err.message}`);
        }
    }

    return results;
}

const crawlerTools: ToolDefinition[] = [
    {
        name: 'web.crawl',
        description: 'Deep-crawl a website recursively, following interesting links up to N levels. Unlike web.read, this tool traverses entire site structures to harvest deep data.',
        category: 'intelligence',
        parameters: {
            url: { type: 'string', description: 'The starting URL to crawl from', required: true },
            depth: { type: 'number', description: 'Max crawl depth (default: 2, max: 3)', required: false },
            max_pages: { type: 'number', description: 'Max pages to crawl (default: 10, max: 25)', required: false },
            keywords: { type: 'string', description: 'Comma-separated keywords to prioritize relevant links', required: false }
        },
        execute: async (params) => {
            const { url, depth, max_pages, keywords } = params as any;
            const maxDepth = Math.min(depth || 2, 3);
            const maxPages = Math.min(max_pages || 10, 25);
            const keywordList = keywords ? keywords.split(',').map((k: string) => k.trim()) : [];

            console.log(`[CRAWLER] 🕷️ Initiating deep crawl: ${url} (depth=${maxDepth}, max=${maxPages})`);
            const results = await crawlDeep(url, maxDepth, maxPages, keywordList);

            if (results.length === 0) {
                return `No pages could be crawled from ${url}.`;
            }

            const output = results.map((r, i) =>
                `## Page ${i + 1} (Depth ${r.depth})\n**URL**: ${r.url}\n**Title**: ${r.title}\n**Content** (${r.text.length} chars):\n${r.text.substring(0, 3000)}\n**Linked Pages**: ${r.links.slice(0, 5).join(', ')}`
            ).join('\n\n---\n\n');

            return `# Crawl Results: ${results.length} pages harvested from ${url}\n\n${output}`;
        }
    }
];

export function registerCrawlerTools() {
    crawlerTools.forEach(tool => toolRegistry.register(tool));
    console.log('[CRAWLER] 🕷️ Deep recursive crawler registered.');
}
