import { apifyService } from './apify-service';

// Instagram service orchestrates Apify scrapers for IG automation
// Covers profile analysis, hashtag research, post scraping, and competitor monitoring

const ACTORS = {
  profileScraper: 'apify/instagram-profile-scraper',
  hashtagScraper: 'apify/instagram-hashtag-scraper',
  postScraper: 'apify/instagram-post-scraper',
  commentScraper: 'apify/instagram-comment-scraper',
  reelScraper: 'rozbehsharahi/instagram-reel-scraper',
};

class InstagramService {
  // ── Profile Scraping ───────────────────────────────────────

  async scrapeProfiles(usernames: string[], maxPosts = 12): Promise<any> {
    return apifyService.runActorSync(ACTORS.profileScraper, {
      usernames,
      resultsLimit: maxPosts,
    }, { timeout: 120 });
  }

  async scrapeProfilesAsync(usernames: string[], maxPosts = 12): Promise<any> {
    return apifyService.runActor(ACTORS.profileScraper, {
      usernames,
      resultsLimit: maxPosts,
    });
  }

  // ── Hashtag Research ───────────────────────────────────────

  async scrapeHashtag(hashtags: string[], maxPosts = 50): Promise<any> {
    return apifyService.runActorSync(ACTORS.hashtagScraper, {
      hashtags,
      resultsLimit: maxPosts,
    }, { timeout: 180 });
  }

  async scrapeHashtagAsync(hashtags: string[], maxPosts = 50): Promise<any> {
    return apifyService.runActor(ACTORS.hashtagScraper, {
      hashtags,
      resultsLimit: maxPosts,
    });
  }

  // ── Post Scraping (by URL) ─────────────────────────────────

  async scrapePosts(urls: string[]): Promise<any> {
    return apifyService.runActorSync(ACTORS.postScraper, {
      directUrls: urls,
    }, { timeout: 120 });
  }

  async scrapePostsAsync(urls: string[]): Promise<any> {
    return apifyService.runActor(ACTORS.postScraper, {
      directUrls: urls,
    });
  }

  // ── Comment Scraping ───────────────────────────────────────

  async scrapeComments(postUrl: string, maxComments = 100): Promise<any> {
    return apifyService.runActorSync(ACTORS.commentScraper, {
      directUrls: [postUrl],
      resultsLimit: maxComments,
    }, { timeout: 120 });
  }

  // ── Reel Scraping ─────────────────────────────────────────

  async scrapeReels(username: string, maxReels = 20): Promise<any> {
    return apifyService.runActorSync(ACTORS.reelScraper, {
      username,
      resultsLimit: maxReels,
    }, { timeout: 120 });
  }

  // ── Competitor Analysis ────────────────────────────────────
  // Scrapes multiple competitor profiles and returns comparative data

  formatProfileComparison(profiles: any[]): Array<{
    username: string;
    fullName: string;
    bio: string;
    followers: number;
    following: number;
    posts: number;
    engagementRate: number;
    isVerified: boolean;
    profilePicUrl: string;
    externalUrl: string;
  }> {
    return profiles.map((p: any) => {
      const followers = p.followersCount || p.followers || 0;
      const avgLikes = p.latestPosts?.reduce((sum: number, post: any) =>
        sum + (post.likesCount || post.likes || 0), 0) / (p.latestPosts?.length || 1) || 0;
      const engagementRate = followers > 0 ? (avgLikes / followers) * 100 : 0;

      return {
        username: p.username || '',
        fullName: p.fullName || p.full_name || '',
        bio: p.biography || p.bio || '',
        followers,
        following: p.followingCount || p.following || 0,
        posts: p.postsCount || p.mediaCount || 0,
        engagementRate: Math.round(engagementRate * 100) / 100,
        isVerified: p.verified || p.isVerified || false,
        profilePicUrl: p.profilePicUrl || p.profilePicUrlHD || '',
        externalUrl: p.externalUrl || p.website || '',
      };
    });
  }

  // ── Hashtag Insights ───────────────────────────────────────
  // Takes scraped hashtag posts and returns aggregate stats

  analyzeHashtagPosts(posts: any[]): {
    totalPosts: number;
    avgLikes: number;
    avgComments: number;
    topPosts: any[];
    mediaTypes: Record<string, number>;
  } {
    const totalPosts = posts.length;
    const totalLikes = posts.reduce((sum, p) => sum + (p.likesCount || p.likes || 0), 0);
    const totalComments = posts.reduce((sum, p) => sum + (p.commentsCount || p.comments || 0), 0);

    const mediaTypes: Record<string, number> = {};
    posts.forEach(p => {
      const type = p.type || p.mediaType || 'unknown';
      mediaTypes[type] = (mediaTypes[type] || 0) + 1;
    });

    const topPosts = [...posts]
      .sort((a, b) => (b.likesCount || b.likes || 0) - (a.likesCount || a.likes || 0))
      .slice(0, 10);

    return {
      totalPosts,
      avgLikes: totalPosts > 0 ? Math.round(totalLikes / totalPosts) : 0,
      avgComments: totalPosts > 0 ? Math.round(totalComments / totalPosts) : 0,
      topPosts,
      mediaTypes,
    };
  }
}

export const instagramService = new InstagramService();
