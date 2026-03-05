"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";

function extractUrl(text: string): string | null {
  const urlRegex = /https?:\/\/[^\s]+/i;
  const match = text.match(urlRegex);
  return match ? match[0] : null;
}

function ShareHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const url = searchParams.get("url");
    const text = searchParams.get("text");
    const title = searchParams.get("title");

    let sharedUrl = url || extractUrl(text || "") || extractUrl(title || "") || text || title || "";

    if (sharedUrl) {
      router.replace(`/?shared_url=${encodeURIComponent(sharedUrl)}`);
    } else {
      router.replace("/");
    }
  }, [searchParams, router]);

  return (
    <div className="min-h-screen min-h-dvh flex items-center justify-center">
      <div className="text-center animate-fade-in">
        <div className="loader-ring mx-auto mb-4" />
        <p className="text-sm text-white/50">Opening analysis...</p>
      </div>
    </div>
  );
}

export default function SharePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen min-h-dvh flex items-center justify-center">
          <div className="loader-ring" />
        </div>
      }
    >
      <ShareHandler />
    </Suspense>
  );
}
