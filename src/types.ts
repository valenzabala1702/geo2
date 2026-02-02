export type ContentType = 'on-page' | 'off-page' | 'gmb';

export interface SEOAnalysis {
  score: number;
  suggestions: string[];
  keywordDensity: { [key: string]: number };
  readability: string;
}

export interface Section {
  id: string;
  title: string;
  content: string;
  keywords: string[];
}

export interface Article {
  title: string;
  metaDescription: string;
  primaryKeywords: string[];
  secondaryKeywords: string[];
  sections: Section[];
  contentType: ContentType;
  competitorUrls?: string[];
  featuredImage?: {
    prompt: string;
    size: string;
    altText: string;
    base64?: string;
  };
}

export enum AppStep {
  AUTH = 'auth',
  ACCOUNT = 'account',
  KEYWORDS = 'keywords',
  OUTLINE = 'outline',
  WRITING = 'writing'
}