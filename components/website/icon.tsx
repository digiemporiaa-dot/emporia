import * as React from "react";
import {
  Award,
  BarChart3,
  Calendar,
  Check,
  Clock,
  Code2,
  Globe,
  Handshake,
  IndianRupee,
  Layout,
  Lightbulb,
  LineChart,
  Mail,
  MapPin,
  Megaphone,
  MessageCircle,
  PenTool,
  Phone,
  Rocket,
  Search,
  Shield,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import type { IconName } from "@/lib/content/icons";

/**
 * Renders one of the curated block icons.
 *
 * Always `aria-hidden`: every icon in a block sits beside a heading that
 * carries the meaning, so announcing it would only add noise for a screen
 * reader (CLAUDE.md 12).
 */

const ICONS: Record<IconName, React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
  search: Search,
  megaphone: Megaphone,
  target: Target,
  "trending-up": TrendingUp,
  "bar-chart": BarChart3,
  "line-chart": LineChart,
  globe: Globe,
  "map-pin": MapPin,
  users: Users,
  handshake: Handshake,
  "message-circle": MessageCircle,
  mail: Mail,
  phone: Phone,
  calendar: Calendar,
  clock: Clock,
  check: Check,
  shield: Shield,
  zap: Zap,
  sparkles: Sparkles,
  lightbulb: Lightbulb,
  layout: Layout,
  "pen-tool": PenTool,
  code: Code2,
  smartphone: Smartphone,
  "shopping-cart": ShoppingCart,
  rupee: IndianRupee,
  award: Award,
  rocket: Rocket,
};

export function BlockIcon({
  name,
  size = 22,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const Component = ICONS[name];
  return (
    <span aria-hidden="true" className={className}>
      <Component size={size} strokeWidth={1.6} />
    </span>
  );
}
