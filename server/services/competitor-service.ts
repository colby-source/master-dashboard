import axios from 'axios';
import crypto from 'crypto';

export interface CompetitorSnapshot {
  url: string;
  title: string;
  description: string;
  contentHash: string;
  statusCode: number;
  fetchedAt: string;
}

class CompetitorService {
  async fetchSnapshot(url: string): Promise<CompetitorSnapshot | null> {
    try {
      const { data, status } = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DashboardBot/1.0)' },
        maxRedirects: 3,
      });

      const html = typeof data === 'string' ? data : JSON.stringify(data);
      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["'](.*?)["']/i);

      // Hash the main content to detect changes (strip whitespace/scripts for stability)
      const stripped = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      const contentHash = crypto.createHash('md5').update(stripped).digest('hex');

      return {
        url,
        title: titleMatch?.[1]?.trim() || url,
        description: descMatch?.[1]?.trim() || '',
        contentHash,
        statusCode: status,
        fetchedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      console.error(`[Competitor] Failed to fetch ${url}:`, err.message);
      return null;
    }
  }
}

export const competitorService = new CompetitorService();
