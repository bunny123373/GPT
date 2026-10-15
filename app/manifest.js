/* The PWA manifest is a fixed document — it never depends on a request.
   Declaring it static is required for `output: "export"` (used by the Android
   APK build) and is a no-op for the normal server build. */
export const dynamic = "force-static";

export default function manifest() {
  return {
    name: "GPT — AI Chat & Images",
    short_name: "GPT",
    description:
      "A private AI assistant for writing, answering questions, coding and creating images.",
    start_url: "/",
    display: "standalone",
    background_color: "#1f1e1d",
    theme_color: "#1f1e1d",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}