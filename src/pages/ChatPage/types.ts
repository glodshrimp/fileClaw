export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  timestamp: number;
  status: 'pending' | 'sent' | 'error';
  files?: Array<{ name: string; type: 'image' | 'text'; preview?: string }>;
}

export interface AttachedFile {
  name: string;
  path: string;
  type: 'image' | 'text';
  data: string;
  mimeType?: string;
  preview?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
}
