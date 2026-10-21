'use client';
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export function getIcon(name: string): LucideIcon {
  return (LucideIcons as any)[name] || LucideIcons.Tag;
}
