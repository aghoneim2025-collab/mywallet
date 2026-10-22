'use client';
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export function getIcon(name: string): LucideIcon {
  return (LucideIcons as any)[name] || LucideIcons.Tag;
}

// Pre-resolved common icons for use in lists (prevents lint warnings)
export const ICONS: Record<string, LucideIcon> = {
  wallet: LucideIcons.Wallet,
  credit_card: LucideIcons.CreditCard,
  landmark: LucideIcons.Landmark,
  smartphone: LucideIcons.Smartphone,
  'piggy-bank': LucideIcons.PiggyBank,
  banknote: LucideIcons.Banknote,
  'trending-up': LucideIcons.TrendingUp,
  gem: LucideIcons.Gem,
  bitcoin: LucideIcons.Bitcoin,
  diamond: LucideIcons.Diamond,
  home: LucideIcons.Home,
  car: LucideIcons.Car,
  plane: LucideIcons.Plane,
  gift: LucideIcons.Gift,
  shield: LucideIcons.Shield,
  briefcase: LucideIcons.Briefcase,
  'building-2': LucideIcons.Building2,
  coin: LucideIcons.Coin,
  'dollar-sign': LucideIcons.DollarSign,
  euro: LucideIcons.Euro,
  'pound-sterling': LucideIcons.PoundSterling,
  tag: LucideIcons.Tag,
  'shopping-cart': LucideIcons.ShoppingCart,
  'heart-pulse': LucideIcons.HeartPulse,
  'graduation-cap': LucideIcons.GraduationCap,
  fuel: LucideIcons.Fuel,
  utensils: LucideIcons.Utensils,
  pizza: LucideIcons.Pizza,
  coffee: LucideIcons.Coffee,
  tv: LucideIcons.Tv,
  music: LucideIcons.Music,
  book: LucideIcons.Book,
  dumbbell: LucideIcons.Dumbbell,
  pill: LucideIcons.Pill,
  wrench: LucideIcons.Wrench,
  zap: LucideIcons.Zap,
  droplet: LucideIcons.Droplet,
  tshirt: LucideIcons.Tshirt,
  baby: LucideIcons.Baby,
  dog: LucideIcons.Dog,
  bus: LucideIcons.Bus,
  taxi: LucideIcons.Taxi,
  train: LucideIcons.Train,
  'arrow-right-left': LucideIcons.ArrowRightLeft,
  award: LucideIcons.Award,
  'hand-coins': LucideIcons.HandCoins,
  sparkles: LucideIcons.Sparkles,
  'external-link': LucideIcons.ExternalLink,
  heart: LucideIcons.Heart,
};

/**
 * Dynamic icon component - resolves an icon name string to a Lucide icon component.
 */
export function DynamicIcon({
  name,
  className,
  size,
}: {
  name: string;
  className?: string;
  size?: number;
}) {
  // Use pre-resolved ICONS map first, fall back to dynamic getIcon
  const Icon = ICONS[name] || (LucideIcons as any)[name] || LucideIcons.Tag;
  return <Icon className={className} size={size} />;
}
