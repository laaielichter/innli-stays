/**
 * robots.txt evaluation following RFC 9309: the most specific matching group
 * applies (falling back to "*"), and within it the longest matching rule wins,
 * with Allow winning ties.
 */

interface Rule {
  allow: boolean;
  pattern: string;
}

interface Group {
  agents: string[];
  rules: Rule[];
}

export interface Robots {
  groups: Group[];
  sitemaps: string[];
}

export function parseRobots(text: string): Robots {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === 'allow' || field === 'disallow') {
      lastWasAgent = false;
      if (!current) continue;
      // An empty Disallow means "allow everything".
      if (value === '') continue;
      current.rules.push({ allow: field === 'allow', pattern: value });
    } else if (field === 'sitemap') {
      sitemaps.push(value);
    } else {
      lastWasAgent = false;
    }
  }
  return { groups, sitemaps };
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

function groupFor(robots: Robots, userAgent: string): Group | null {
  const ua = userAgent.toLowerCase();
  const specific = robots.groups.filter((g) => g.agents.includes(ua));
  if (specific.length) return { agents: [ua], rules: specific.flatMap((g) => g.rules) };
  const star = robots.groups.filter((g) => g.agents.includes('*'));
  return star.length ? { agents: ['*'], rules: star.flatMap((g) => g.rules) } : null;
}

export function isAllowed(robots: Robots, userAgent: string, path: string): { allowed: boolean; matchedGroup: string | null; rule?: string } {
  const group = groupFor(robots, userAgent);
  if (!group) return { allowed: true, matchedGroup: null };
  let best: Rule | null = null;
  for (const rule of group.rules) {
    if (!patternToRegex(rule.pattern).test(path)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
  }
  return { allowed: best ? best.allow : true, matchedGroup: group.agents[0], rule: best ? `${best.allow ? 'Allow' : 'Disallow'}: ${best.pattern}` : undefined };
}

export interface CrawlerInfo {
  userAgent: string;
  operator: string;
  purpose: 'search' | 'user_request' | 'training';
  explanation: string;
}

/**
 * AI-related crawlers, split by purpose. Blocking a training crawler is a
 * legitimate choice and does not affect search visibility; blocking a search
 * crawler makes the property invisible in that assistant's search answers.
 */
const EXPLANATION_EN: Record<string, string> = {
  Googlebot: 'Google Search, including AI Overviews and AI Mode',
  Bingbot: 'Bing and Copilot; several AI assistants use Bing results',
  'OAI-SearchBot': 'Search results in ChatGPT Search',
  'ChatGPT-User': 'Pages ChatGPT opens at the request of a user',
  'Claude-SearchBot': 'Search results in Claude',
  'Claude-User': 'Pages Claude opens at the request of a user',
  PerplexityBot: 'Search results in Perplexity',
  GPTBot: 'Training of OpenAI models (separate from ChatGPT Search)',
  ClaudeBot: 'Training of Anthropic models',
  'Google-Extended': 'Use for Gemini training; does not affect Google Search',
  CCBot: 'Open web archive often used for model training',
};

export const crawlerExplanation = (c: CrawlerInfo, lang: string) => (lang === 'nl' ? c.explanation : (EXPLANATION_EN[c.userAgent] ?? c.explanation));

export const AI_CRAWLERS: CrawlerInfo[] = [
  { userAgent: 'Googlebot', operator: 'Google', purpose: 'search', explanation: 'Google Zoeken, inclusief AI Overviews en AI Mode' },
  { userAgent: 'Bingbot', operator: 'Microsoft', purpose: 'search', explanation: 'Bing en Copilot; diverse AI-assistenten gebruiken Bing-resultaten' },
  { userAgent: 'OAI-SearchBot', operator: 'OpenAI', purpose: 'search', explanation: 'Zoekresultaten in ChatGPT Search' },
  { userAgent: 'ChatGPT-User', operator: 'OpenAI', purpose: 'user_request', explanation: 'Pagina\'s die ChatGPT opent op verzoek van een gebruiker' },
  { userAgent: 'Claude-SearchBot', operator: 'Anthropic', purpose: 'search', explanation: 'Zoekresultaten in Claude' },
  { userAgent: 'Claude-User', operator: 'Anthropic', purpose: 'user_request', explanation: 'Pagina\'s die Claude opent op verzoek van een gebruiker' },
  { userAgent: 'PerplexityBot', operator: 'Perplexity', purpose: 'search', explanation: 'Zoekresultaten in Perplexity' },
  { userAgent: 'GPTBot', operator: 'OpenAI', purpose: 'training', explanation: 'Training van OpenAI-modellen (los van ChatGPT Search)' },
  { userAgent: 'ClaudeBot', operator: 'Anthropic', purpose: 'training', explanation: 'Training van Anthropic-modellen' },
  { userAgent: 'Google-Extended', operator: 'Google', purpose: 'training', explanation: 'Gebruik voor Gemini-training; heeft geen invloed op Google Zoeken' },
  { userAgent: 'CCBot', operator: 'Common Crawl', purpose: 'training', explanation: 'Open webarchief dat vaak voor modeltraining wordt gebruikt' },
];
