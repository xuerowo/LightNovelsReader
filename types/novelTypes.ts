export interface Chapter {
  id: number;
  title: string;
  url: string;
  lastUpdated: string;
}

export interface Novel {
  title: string;
  author: string;
  cover: string;
  description: string;
  originalUrl: string;
  chapters: Chapter[];
  tags: string[];
  lastUpdated: string;
  totalWordCount: number;
}
