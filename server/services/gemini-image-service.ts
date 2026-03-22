import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

// ── Types ──────────────────────────────────────────────────────

export interface ImageGenerationRequest {
  prompt: string;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:5';
  style?: string;
  brandContext?: string;
  outputDir?: string;
}

export interface ImageGenerationResult {
  filePath: string;
  fileName: string;
  mimeType: string;
  prompt: string;
  aspectRatio: string;
}

export interface AdCreativeRequest {
  headline: string;
  body: string;
  cta: string;
  style: 'professional' | 'luxury' | 'modern' | 'editorial' | 'data-driven';
  format: 'feed_square' | 'feed_landscape' | 'story_vertical';
  includeText?: boolean;
}

// ── GPC Brand Constants ────────────────────────────────────────

const GPC_BRAND = {
  colors: {
    navy: '#0C1C54',
    gold: '#C4B49C',
    lightBlue: '#A4B6F2',
    white: '#FFFFFF',
    ctaOrange: '#FE9A00',
    ctaGold: '#FFB900',
  },
  fonts: {
    heading: 'Raleway',
    body: 'Avenir',
    display: 'Fjalla One',
  },
  name: 'Granite Park Capital',
  tagline: 'Vertically Integrated Real Estate Private Equity',
  disclaimer506c: 'This offering is available only to verified accredited investors under Rule 506(c) of Regulation D. Past performance is not indicative of future results.',
};

// ── Format specs ───────────────────────────────────────────────

const FORMAT_SPECS: Record<string, { width: number; height: number; ratio: string }> = {
  feed_square: { width: 1080, height: 1080, ratio: '1:1' },
  feed_landscape: { width: 1200, height: 628, ratio: '16:9' },
  story_vertical: { width: 1080, height: 1920, ratio: '9:16' },
};

class GeminiImageService {
  private ai: GoogleGenAI | null = null;

  get available(): boolean {
    return !!config.geminiApiKey;
  }

  private getClient(): GoogleGenAI {
    if (!this.ai) {
      if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY not configured');
      this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    }
    return this.ai;
  }

  // ── Generate a single image ─────────────────────────────────

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const ai = this.getClient();
    const aspectRatio = request.aspectRatio || '1:1';

    // Build enhanced prompt with brand context
    let enhancedPrompt = request.prompt;
    if (request.brandContext) {
      enhancedPrompt = `${request.brandContext}\n\n${request.prompt}`;
    }
    if (request.style) {
      enhancedPrompt += `\n\nStyle: ${request.style}`;
    }

    const response = await ai.models.generateContent({
      model: 'nano-banana-pro-preview',
      contents: enhancedPrompt,
      config: {
        responseModalities: ['IMAGE', 'TEXT'],
      },
    });

    // Extract image from response
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));

    if (!imagePart?.inlineData) {
      throw new Error('No image generated. The model may have refused the prompt.');
    }

    // Save to file
    const outputDir = request.outputDir || path.join(process.cwd(), 'data', 'generated-ads');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const ext = imagePart.inlineData.mimeType === 'image/png' ? 'png' : 'jpg';
    const fileName = `ad_${Date.now()}_${aspectRatio.replace(':', 'x')}.${ext}`;
    const filePath = path.join(outputDir, fileName);

    const buffer = Buffer.from(imagePart.inlineData.data!, 'base64');
    fs.writeFileSync(filePath, buffer);

    return {
      filePath,
      fileName,
      mimeType: imagePart.inlineData.mimeType!,
      prompt: enhancedPrompt,
      aspectRatio,
    };
  }

  // ── Generate ad creative image ──────────────────────────────

  async generateAdCreative(request: AdCreativeRequest): Promise<ImageGenerationResult> {
    const format = FORMAT_SPECS[request.format] || FORMAT_SPECS.feed_square;

    const styleGuides: Record<string, string> = {
      professional: `Clean, corporate design with deep navy (${GPC_BRAND.colors.navy}) backgrounds and gold (${GPC_BRAND.colors.gold}) accents. Professional real estate photography style. Modern sans-serif typography.`,
      luxury: `Luxury, high-end feel with dark backgrounds, gold and white text. Elegant composition with ample white space. Premium real estate imagery — aerial property photos, luxury multifamily buildings.`,
      modern: `Contemporary, bold design with vibrant gradients. Clean lines, modern typography. Tech-forward real estate investment feel. Blue and orange accents.`,
      editorial: `Magazine-style editorial layout. Large impactful hero image with overlaid text. Clean, minimal design with strong hierarchy. Think Wall Street Journal or Barron's aesthetic.`,
      'data-driven': `Data visualization focus. Charts, graphs, performance metrics prominently displayed. Clean infographic style with navy and gold color scheme. Numbers and statistics front and center.`,
    };

    const prompt = `Create a professional Facebook/Instagram ad image for ${GPC_BRAND.name}, a real estate private equity fund.

BRAND COLORS: Navy ${GPC_BRAND.colors.navy}, Gold ${GPC_BRAND.colors.gold}, White ${GPC_BRAND.colors.white}
ASPECT RATIO: ${format.ratio} (${format.width}x${format.height})

STYLE: ${styleGuides[request.style] || styleGuides.professional}

${request.includeText ? `TEXT TO INCLUDE:
- Headline: "${request.headline}"
- Body: "${request.body}"
- CTA Button: "${request.cta}"` : 'Do NOT include any text in the image. This will be a background/hero image for an ad overlay.'}

The image should convey trust, stability, and premium investment opportunity in affordable housing real estate. Avoid stock photo clichés. Make it look like a top-tier investment fund advertisement.`;

    return this.generateImage({
      prompt,
      aspectRatio: format.ratio as any,
      brandContext: `Brand: ${GPC_BRAND.name} — ${GPC_BRAND.tagline}`,
    });
  }

  // ── Generate multiple ad variants ───────────────────────────

  async generateAdVariants(
    baseRequest: AdCreativeRequest,
    variants: { headline: string; body: string }[],
    formats: string[] = ['feed_square']
  ): Promise<ImageGenerationResult[]> {
    const results: ImageGenerationResult[] = [];

    for (const variant of variants) {
      for (const format of formats) {
        try {
          const result = await this.generateAdCreative({
            ...baseRequest,
            headline: variant.headline,
            body: variant.body,
            format: format as any,
          });
          results.push(result);
        } catch (err: any) {
          console.error(`[GeminiImage] Failed to generate variant: ${err.message}`);
        }
      }
    }

    return results;
  }

  // ── List generated images ───────────────────────────────────

  listGeneratedImages(): { fileName: string; filePath: string; size: number; created: Date }[] {
    const dir = path.join(process.cwd(), 'data', 'generated-ads');
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir)
      .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .map(f => {
        const filePath = path.join(dir, f);
        const stats = fs.statSync(filePath);
        return { fileName: f, filePath, size: stats.size, created: stats.birthtime };
      })
      .sort((a, b) => b.created.getTime() - a.created.getTime());
  }

  // ── Get brand constants for frontend ────────────────────────

  getBrandConfig() {
    return GPC_BRAND;
  }
}

export const geminiImageService = new GeminiImageService();
