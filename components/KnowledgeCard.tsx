"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface KnowledgeCardProps {
  title: string;
  description: string;
  imageUrl?: string;
  category?: string;
  tags?: string[];
  isHighlighted?: boolean;
  onClose?: () => void;
  compact?: boolean;
}

export default function KnowledgeCard({
  title,
  description,
  imageUrl,
  category,
  tags = [],
  isHighlighted = false,
  onClose,
  compact = false,
}: KnowledgeCardProps) {
  const [imageError, setImageError] = useState(false);

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-white transition-all duration-300 card-shadow ${
        isHighlighted
          ? "border-[#2DB6A3]/50 ring-2 ring-[#DDF5EF]"
          : "border-[#E6ECEF]"
      }`}
    >
      {onClose && (
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-[#667085] shadow-sm transition hover:bg-[#F7FAF9] hover:text-[#1F2933]"
          aria-label="Close"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      )}

      {imageUrl && !compact && (
        <div className="relative h-36 overflow-hidden bg-[#F6F2EE]">
          {!imageError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={title}
              className="h-full w-full object-cover"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-[#EAF4FF]">
              <PlaceholderToothIcon />
            </div>
          )}
        </div>
      )}

      <div className={compact ? "p-3" : "p-4"}>
        {category && (
          <span className="mb-2 inline-block rounded-full bg-[#EAF4FF] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#4A90E2]">
            {category}
          </span>
        )}
        <h3
          className={`font-semibold text-[#1F2933] ${compact ? "text-sm" : "text-base"}`}
        >
          {title}
        </h3>
        <p
          className={`mt-1.5 leading-relaxed text-[#667085] ${compact ? "text-xs" : "text-sm"}`}
        >
          {description}
        </p>

        {tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-[#F7FAF9] px-2 py-0.5 text-xs text-[#667085]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlaceholderToothIcon() {
  return (
    <svg
      className="h-16 w-16 text-[#4A90E2]/30"
      viewBox="0 0 64 64"
      fill="currentColor"
    >
      <path d="M32 4C22 4 14 10 12 20c-1 6-2 14 4 22 3 4 6 10 8 14 2-4 5-10 8-14 6-8 5-16 4-22C50 10 42 4 32 4z" />
    </svg>
  );
}
