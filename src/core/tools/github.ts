/**
 * Nexus Claire: GitHub Integration Tool
 * 
 * Uses the GitHub REST API directly (no external dependencies).
 */

import { toolRegistry, type ToolDefinition } from "../tool-registry";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_API = "https://api.github.com";

async function githubFetch(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = endpoint.startsWith('http') ? endpoint : `${GITHUB_API}${endpoint}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            'Authorization': GITHUB_TOKEN ? `Bearer ${GITHUB_TOKEN}` : '',
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'NexusClaire/4.0',
            ...options.headers
        }
    });
    if (!response.ok) {
        const err = await response.text();
        throw new Error(`GitHub API ${response.status}: ${err.substring(0, 200)}`);
    }
    return response.json();
}

const githubTools: ToolDefinition[] = [
    {
        name: 'github.repos',
        description: 'List your GitHub repositories. Returns name, description, and language.',
        category: 'intelligence',
        parameters: {
            sort: { type: 'string', description: 'Sort by: updated, created, pushed, full_name', required: false }
        },
        execute: async (params) => {
            const sort = (params as any)?.sort || 'updated';
            const repos = await githubFetch(`/user/repos?sort=${sort}&per_page=10`);
            return repos.map((r: any) =>
                `• **${r.full_name}** (${r.language || 'N/A'}) — ${r.description || 'No description'}\n  ⭐ ${r.stargazers_count} | Updated: ${new Date(r.updated_at).toLocaleDateString()}`
            ).join('\n\n');
        }
    },
    {
        name: 'github.search_code',
        description: 'Search for code across GitHub repositories.',
        category: 'intelligence',
        parameters: {
            query: { type: 'string', description: 'Code search query', required: true },
            repo: { type: 'string', description: 'Optional: limit to a specific repo (owner/name)', required: false }
        },
        execute: async (params) => {
            const p = params as any;
            const q = p.repo ? `${p.query}+repo:${p.repo}` : p.query;
            const data = await githubFetch(`/search/code?q=${encodeURIComponent(q)}&per_page=5`);
            if (!data.items?.length) return 'No code matches found.';
            return data.items.map((item: any) =>
                `• **${item.repository.full_name}** — \`${item.path}\`\n  ${item.html_url}`
            ).join('\n\n');
        }
    },
    {
        name: 'github.create_issue',
        description: 'Create a new issue in a GitHub repository.',
        category: 'intelligence',
        parameters: {
            repo: { type: 'string', description: 'Repository in owner/name format', required: true },
            title: { type: 'string', description: 'Issue title', required: true },
            body: { type: 'string', description: 'Issue body/description', required: false }
        },
        execute: async (params) => {
            const p = params as any;
            const data = await githubFetch(`/repos/${p.repo}/issues`, {
                method: 'POST',
                body: JSON.stringify({ title: p.title, body: p.body || '' })
            });
            return `✅ Issue #${data.number} created: ${data.html_url}`;
        }
    },
    {
        name: 'github.prs',
        description: 'List open pull requests for a repository.',
        category: 'intelligence',
        parameters: {
            repo: { type: 'string', description: 'Repository in owner/name format', required: true }
        },
        execute: async (params) => {
            const p = params as any;
            const prs = await githubFetch(`/repos/${p.repo}/pulls?state=open&per_page=10`);
            if (!prs.length) return 'No open pull requests.';
            return prs.map((pr: any) =>
                `• **#${pr.number}**: ${pr.title}\n  By: ${pr.user.login} | ${pr.html_url}`
            ).join('\n\n');
        }
    }
];

export function registerGitHubTools() {
    if (!GITHUB_TOKEN) {
        console.log('[GITHUB] No GITHUB_TOKEN found. GitHub tools disabled.');
        return;
    }
    githubTools.forEach(tool => toolRegistry.register(tool));
    console.log('[GITHUB] GitHub tools registered (repos, search, issues, PRs).');
}
