import { Button } from "@/components/ui/button";
import { type LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  /** Gradient accent color for the icon background glow */
  iconColor?: string;
  title: string;
  description: string;
  /** Optional CTA button */
  actionLabel?: string;
  onAction?: () => void;
  /** Optional secondary action */
  secondaryLabel?: string;
  onSecondary?: () => void;
}

/**
 * Reusable empty-state component with glowing icon, title, description, and CTA.
 * Renders a centered card with a soft radial gradient behind the icon.
 */
export function EmptyState({
  icon: Icon,
  iconColor = "text-primary",
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {/* Glowing icon container */}
      <div className="relative mb-6">
        <div className="absolute inset-0 rounded-full bg-primary/10 blur-2xl scale-150" />
        <div className="relative flex items-center justify-center w-20 h-20 rounded-2xl bg-card border border-border/50 shadow-lg">
          <Icon className={`h-9 w-9 ${iconColor}`} />
        </div>
      </div>

      <h3 className="font-display text-xl font-semibold text-foreground mb-2">
        {title}
      </h3>
      <p className="text-sm text-muted-foreground max-w-sm leading-relaxed mb-6">
        {description}
      </p>

      <div className="flex items-center gap-3">
        {actionLabel && onAction && (
          <Button onClick={onAction} size="sm">
            {actionLabel}
          </Button>
        )}
        {secondaryLabel && onSecondary && (
          <Button onClick={onSecondary} variant="ghost" size="sm">
            {secondaryLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
